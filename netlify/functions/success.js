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
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const rawBody = event.body;
  const ts = event.headers["x-webhook-timestamp"];
  const signature = event.headers["x-webhook-signature"];
  const expected = crypto.createHmac("sha256", process.env.CF_API_SECRET).update(ts + rawBody).digest("base64");

  if (expected !== signature) {
    console.error("❌ Signature Mismatch! Rejecting Webhook.");
    return { statusCode: 401, body: "Invalid signature" };
  }

  const payload = JSON.parse(rawBody);
  const { order, payment, customer_details } = payload.data || {};

  if (order?.order_status === "PAID") {
    const orderId = order.order_id;
    const lockedMessageId = order.order_tags?.lockedMessageId || "unknown";
    const buyerPhone = customer_details?.customer_phone || "9999999999";
    const amount = parseFloat(order.order_amount);

    try {
      await db.runTransaction(async (transaction) => {
        const orderRef = db.collection("orders").doc(orderId);
        
        // 1. Prevent Double Credit
        const orderSnap = await transaction.get(orderRef);
        if (orderSnap.exists && orderSnap.data().status === "PAID") {
          console.log(`[Webhook] Order ${orderId} already processed. Skipping.`);
          return;
        }

        const purchaseId = `${buyerPhone}_${lockedMessageId}`;
        const purchaseRef = db.collection("purchases").doc(purchaseId);
        
        // 2. Fetch Creator Info
        const msgRef = db.collection("lockedMessages").doc(lockedMessageId);
        const msgSnap = await transaction.get(msgRef);
        if (!msgSnap.exists) throw new Error(`LockedMessage ${lockedMessageId} not found`);
        const msgData = msgSnap.data();
        const creatorId = msgData.creatorId;
        const walletRef = db.collection("wallets").doc(creatorId);

        // 3. Mark Order as PAID
        transaction.set(orderRef, {
          status: "PAID",
          cfOrderId: order.cf_order_id,
          cfPaymentId: payment?.cf_payment_id,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          creatorId
        }, { merge: true });

        // 4. Record Purchase (Match App Schema)
        transaction.set(purchaseRef, {
          lockedMessageId,
          buyerPhone,
          orderId: orderId,
          pricePaid: amount,
          purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
          creatorId: creatorId
        }, { merge: true });

        // 5. Update Stat Counter
        transaction.update(msgRef, {
          purchasedCount: admin.firestore.FieldValue.increment(1)
        });

        // 6. Credit Wallet
        transaction.set(walletRef, {
          balance: admin.firestore.FieldValue.increment(amount),
          totalEarned: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      console.log(`[Webhook] ✅ Successfully finalized Order ${orderId} & Purchse table.`);
    } catch (err) {
      console.error("[Webhook] ❌ Transaction Error:", err.message);
      return { statusCode: 500, body: "Transaction failed" };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};