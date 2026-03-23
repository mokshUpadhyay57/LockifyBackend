// netlify/functions/verifyPayment.js
const axios = require("axios");
const admin = require("firebase-admin");

// Initialize Firebase Admin (Idempotent initialization)
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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://lockify.co.in";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Credentials": "true",
};

exports.handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { order_id } = body;

    if (!order_id) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing order_id" }) };
    }

    const baseUrl = process.env.CF_BASE_URL;
    const clientId = process.env.CF_API_KEY;
    const clientSecret = process.env.CF_API_SECRET;

    const url = `${baseUrl.replace(/\/$/, "")}/orders/${encodeURIComponent(order_id)}`;
    
    const resp = await axios.get(url, {
      headers: {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const data = resp.data;
    console.log("[verifyPayment] Cashfree Status:", data.order_status);

    // 🔥 IF PAID, UPDATE FIRESTORE IMMEDIATELY
    if (data.order_status === "PAID") {
      try {
        const orderRef = db.collection("orders").doc(order_id);
        const purchaseRef = db.collection("purchases").doc(order_id);
        
        // Use a batch for atomicity
        const batch = db.batch();
        
        const lockedMessageId = data.order_tags?.lockedMessageId || "unknown";
        const buyerPhone = data.customer_details?.customer_phone || "9999999999";

        batch.set(orderRef, {
          status: "PAID",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          amount: data.order_amount,
          buyerPhone,
          lockedMessageId
        }, { merge: true });

        batch.set(purchaseRef, {
          lockedMessageId,
          buyerPhone,
          orderId: order_id,
          grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        await batch.commit();
        console.log("[verifyPayment] ✅ Firestore updated successfully");
      } catch (dbErr) {
        console.error("[verifyPayment] ❌ Firestore update failed:", dbErr);
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(data),
    };

  } catch (err) {
    console.error("[verifyPayment] Error:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Verification failed", details: err.message }),
    };
  }
};