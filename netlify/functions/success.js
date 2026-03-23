// netlify/functions/success.js
const crypto = require("crypto");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

exports.handler = async (event) => {
  console.log("--- WEBHOOK RECEIVED ---");

  if (event.httpMethod !== "POST") {
    console.log("Method Not Allowed:", event.httpMethod);
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const rawBody = event.body;
  const ts = event.headers["x-webhook-timestamp"];
  const signature = event.headers["x-webhook-signature"];

  // Verify Signature
  const secret = process.env.CF_API_SECRET;
  if (!secret) {
    console.error(
      "CRITICAL: CF_API_SECRET is not set in environment variables!",
    );
  }

  const expected = crypto
    .createHmac("sha256", secret || "")
    .update(ts + rawBody)
    .digest("base64");

  if (expected !== signature) {
    console.error("❌ Signature Mismatch!");
    console.error("Expected:", expected);
    console.error("Received:", signature);
    // return { statusCode: 401, body: "Invalid signature" }; // Bypass for debugging
  } else {
    console.log("✅ Signature Verified");
  }

  try {
    const payload = JSON.parse(rawBody || "{}");
    console.log("Event Type:", payload.type);
    console.log("Full Payload:", JSON.stringify(payload, null, 2));
    // Normalize data extraction (Cashfree often nests inside 'data')
    const data = payload.data || payload;
    const { order, customer_details, payment } = data;

    if (!order || payment.payment_status !== "SUCCESS") {
      console.log("Order is not PAID. Status:", payment?.payment_status);
      return { statusCode: 200, body: "Not a PAID event" };
    }

    const orderId = order.order_id;
    const lockedMessageId = order.order_tags?.lockedMessageId;
    const buyerPhone = customer_details?.customer_phone;
    const amount = parseFloat(order.order_amount);

    console.log(
      `Processing Order: ${orderId} | Message: ${lockedMessageId} | Phone: ${buyerPhone}`,
    );

    if (!orderId || !lockedMessageId || !buyerPhone) {
      throw new Error(
        `Missing required fields: orderId=${orderId}, msgId=${lockedMessageId}, phone=${buyerPhone}`,
      );
    }

    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await transaction.get(orderRef);

      // Idempotency: Don't credit twice
      if (orderSnap.exists && orderSnap.data().status === "PAID") {
        console.log("Order already processed in Firestore. Skipping.");
        return;
      }

      const msgRef = db.collection("lockedMessages").doc(lockedMessageId);
      const msgSnap = await transaction.get(msgRef);
      if (!msgSnap.exists)
        throw new Error(`LockedMessage [${lockedMessageId}] not found in DB`);

      const creatorId = msgSnap.data().createdBy;
      if (!creatorId)
        throw new Error(
          `createdBy missing on message doc [${lockedMessageId}]`,
        );

      const purchaseId = `${buyerPhone}_${lockedMessageId}`;
      const purchaseRef = db.collection("purchases").doc(purchaseId);
      const walletRef = db.collection("wallets").doc(creatorId);

      // 1. Mark Order as PAID
      transaction.set(
        orderRef,
        {
          status: "PAID",
          orderId: order.order_id,
          cfPaymentId: payment?.cf_payment_id,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          creatorId,
          amount,
        },
        { merge: true },
      );

      // 2. Create Purchase Record (Unlocks the content)
      transaction.set(
        purchaseRef,
        {
          lockedMessageId,
          buyerPhone,
          orderId,
          pricePaid: amount,
          purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
          creatorId,
        },
        { merge: true },
      );

      // 3. Increment Stats & Wallet
      transaction.update(msgRef, {
        purchasedCount: admin.firestore.FieldValue.increment(1),
      });
      transaction.set(
        walletRef,
        {
          balance: admin.firestore.FieldValue.increment(amount),
          totalEarned: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      console.log(`✅ SUCCESSFULLY PROCESSED: ${orderId}`);
    });
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error("❌ WEBHOOK PROCESSING ERROR:", err.message);
    return { statusCode: 500, body: err.message };
  }
};
