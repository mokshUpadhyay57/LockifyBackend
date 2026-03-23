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
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  const rawBody = event.body;
  const ts = event.headers["x-webhook-timestamp"];
  const signature = event.headers["x-webhook-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.CF_API_SECRET)
    .update(ts + rawBody)
    .digest("base64");

  if (expected !== signature) {
    console.error("❌ Signature Mismatch!");
    return { statusCode: 401, body: "Invalid signature" };
  }

  const { data } = JSON.parse(rawBody || "{}");
  const { order, customer_details, payment } = data || {};

  if (order?.order_status === "PAID") {
    const orderId = order.order_id;
    const lockedMessageId = order.order_tags?.lockedMessageId;
    const buyerPhone = customer_details?.customer_phone;
    const amount = parseFloat(order.order_amount);

    try {
      if (!orderId) throw new Error("Missing orderId in webhook payload");
      if (!lockedMessageId)
        throw new Error(`Missing lockedMessageId in order [${orderId}] tags`);
      if (!buyerPhone)
        throw new Error(`Missing customer_phone in order [${orderId}]`);

      await db.runTransaction(async (transaction) => {
        const orderRef = db.collection("orders").doc(orderId);
        const orderSnap = await transaction.get(orderRef);
        if (orderSnap.exists && orderSnap.data().status === "PAID") return;

        const msgRef = db.collection("lockedMessages").doc(lockedMessageId);
        const msgSnap = await transaction.get(msgRef);
        if (!msgSnap.exists)
          throw new Error(`LockedMessage [${lockedMessageId}] not found`);

        const creatorId = msgSnap.data().createdBy;
        if (!creatorId)
          throw new Error(
            `CRITICAL: createdBy missing on message [${lockedMessageId}]`,
          );

        const purchaseId = `${buyerPhone}_${lockedMessageId}`;
        const purchaseRef = db.collection("purchases").doc(purchaseId);
        const walletRef = db.collection("wallets").doc(creatorId);

        transaction.set(
          orderRef,
          {
            status: "PAID",
            cfOrderId: order.cf_order_id,
            cfPaymentId: payment?.cf_payment_id,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            creatorId,
            amount,
          },
          { merge: true },
        );
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
      });

      console.log(`[Webhook] ✅ SUCCESS: Order ${orderId} finalized.`);
    } catch (err) {
      console.error("[Webhook] ❌ PATH ERROR PINPOINTED:", err.message);
      return { statusCode: 500, body: err.message };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
