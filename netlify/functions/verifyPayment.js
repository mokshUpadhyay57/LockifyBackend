// netlify/functions/verifyPayment.js
const axios = require("axios");
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
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGIN;

exports.handler = async (event) => {
  const origin = event.headers.origin;
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  try {
    const { order_id } = JSON.parse(event.body || "{}");
    if (!order_id) return { statusCode: 400, headers: corsHeaders, body: "Missing order_id" };

    const resp = await axios.get(`${process.env.CF_BASE_URL.replace(/\/$/, "")}/orders/${order_id}`, {
      headers: {
        "x-client-id": process.env.CF_API_KEY,
        "x-client-secret": process.env.CF_API_SECRET,
        "x-api-version": "2025-01-01",
      },
    });

    const data = resp.data;
    console.log(`[verifyPayment] Order ${order_id} status: ${data.order_status}`);

    if (data.order_status === "PAID") {
      const lockedMessageId = data.order_tags?.lockedMessageId || "unknown";
      const buyerPhone = data.customer_details?.customer_phone || "9999999999";
      const amount = parseFloat(data.order_amount);

      await db.runTransaction(async (transaction) => {
        const orderRef = db.collection("orders").doc(order_id);
        const purchaseId = `${buyerPhone}_${lockedMessageId}`;
        const purchaseRef = db.collection("purchases").doc(purchaseId);
        
        const msgRef = db.collection("lockedMessages").doc(lockedMessageId);
        const msgSnap = await transaction.get(msgRef);
        
        if (!msgSnap.exists) throw new Error(`LockedMessage ${lockedMessageId} not found`);
        const msgData = msgSnap.data();
        const creatorId = msgData.creatorId;
        const walletRef = db.collection("wallets").doc(creatorId);

        // 1. Update Order
        transaction.set(orderRef, {
          status: "PAID",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          creatorId,
          amount: amount
        }, { merge: true });

        // 2. Update Purchase (Matches App Schema)
        transaction.set(purchaseRef, {
          lockedMessageId,
          buyerPhone,
          orderId: order_id,
          pricePaid: amount,
          purchasedAt: admin.firestore.FieldValue.serverTimestamp(), // Match App
          creatorId: creatorId
        }, { merge: true });

        // 3. Increment Message Purchased Count
        transaction.update(msgRef, {
          purchasedCount: admin.firestore.FieldValue.increment(1)
        });

        // 4. Update Creator Wallet
        transaction.set(walletRef, {
          balance: admin.firestore.FieldValue.increment(amount),
          totalEarned: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      console.log(`[verifyPayment] ✅ SUCCESS: Tables created & Wallet updated for ${order_id}`);
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) };

  } catch (err) {
    console.error("[verifyPayment] ❌ Error:", err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};