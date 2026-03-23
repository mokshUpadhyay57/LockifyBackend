// netlify/functions/verifyPayment.js
const axios = require("axios");
const admin = require("firebase-admin");
const https = require("https");

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
const ALLOWED_ORIGINS = ["https://lockify.co.in", "https://zipind-57.web.app"];

// 🚀 Optimization: Keep-Alive Agent for faster API calls
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  timeout: 10000,
});

const client = axios.create({
  httpsAgent: keepAliveAgent,
  timeout: 10000,
  headers: { Connection: "keep-alive" },
});

exports.handler = async (event) => {
  const origin = event.headers.origin;
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: corsHeaders, body: "" };

  try {
    const { order_id } = JSON.parse(event.body || "{}");
    if (!order_id) {
      return { statusCode: 400, headers: corsHeaders, body: "Missing order_id" };
    }

    // 🚀 HIGH PERFORMANCE: Parallel fire of DB check and Cashfree API
    const [initialOrderSnap, cashfreeResp] = await Promise.all([
      db.collection("orders").doc(order_id).get(),
      client.get(
        `${process.env.CF_BASE_URL.replace(/\/$/, "")}/orders/${order_id}`,
        {
          headers: {
            "x-client-id": process.env.CF_API_KEY,
            "x-client-secret": process.env.CF_API_SECRET,
            "x-api-version": "2025-01-01",
          },
        }
      ).catch(err => ({ error: err }))
    ]);

    // 1. FAST PATH: If our DB already says PAID (webhook finished early)
    if (initialOrderSnap.exists && initialOrderSnap.data().status === "PAID") {
      console.log(`[verifyPayment] ⚡ Optimistic Hit: Order ${order_id}`);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ order_status: "PAID", order_id, optimistic: true }),
      };
    }

    // 2. API PATH: Return the raw Cashfree status immediately
    if (cashfreeResp.error) {
       throw new Error(`Cashfree API failed: ${cashfreeResp.error.message}`);
    }

    const data = cashfreeResp.data;
    console.log(`[verifyPayment] ⚡ Status for ${order_id}: ${data.order_status}`);

    // NOTE: The heavy db.runTransaction is removed. 
    // The success.js webhook handles wallet/purchase records in the background.
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error("[verifyPayment] ❌ Error:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
