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

// PRODUCTION GRADE: Restrict CORS to your domains
const ALLOWED_ORIGINS = ["https://lockify.co.in", "https://zipind-57.web.app"];

exports.handler = async (event) => {
  const origin = event.headers.origin;
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  try {
    const { order_id } = JSON.parse(event.body || "{}");
    if (!order_id) return { statusCode: 400, headers: corsHeaders, body: "Missing order_id" };

    // 1. Verify with Cashfree
    const resp = await axios.get(`${process.env.CF_BASE_URL.replace(/\/$/, "")}/orders/${order_id}`, {
      headers: {
        "x-client-id": process.env.CF_API_KEY,
        "x-client-secret": process.env.CF_API_SECRET,
        "x-api-version": "2025-01-01",
      },
    });

    const data = resp.data;

    // 2. PRODUCTION GRADE: Use a Transaction for financial integrity
    if (data.order_status === "PAID") {
      const lockedMessageId = data.order_tags?.lockedMessageId;
      const buyerPhone = data.customer_details?.customer_phone;
      const amount = parseFloat(data.order_amount);

      await db.runTransaction(async (transaction) => {
        const orderRef = db.collection("orders").doc(order_id);
        const purchaseRef = db.collection("purchases").doc(`${buyerPhone}_${lockedMessageId}`);
        
        // Fetch message to find creator
        const msgRef = db.collection("lockedMessages").doc(lockedMessageId);
        const msgSnap = await transaction.get(msgRef);
        
        if (!msgSnap.exists) throw new Error("Message not found");
        const creatorId = msgSnap.data().creatorId;
        const walletRef = db.collection("wallets").doc(creatorId);

        // Update Order
        transaction.set(orderRef, {
          status: "PAID",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          creatorId
        }, { merge: true });

        // Update Purchase (Idempotent)
        transaction.set(purchaseRef, {
          lockedMessageId,
          buyerPhone,
          orderId: order_id,
          grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Update Creator Wallet
        transaction.set(walletRef, {
          balance: admin.firestore.FieldValue.increment(amount),
          totalEarned: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      console.log(`[verifyPayment] ✅ Success: Order ${order_id} processed & Wallet updated.`);
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) };

  } catch (err) {
    console.error("[verifyPayment] ❌ Error:", err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};