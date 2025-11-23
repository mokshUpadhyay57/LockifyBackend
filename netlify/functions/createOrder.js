// netlify/functions/createOrder.js
const https = require("https");
const axios = require("axios");

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://lockify.co.in";

// ⭐ Keep-alive agent for fast repeated HTTPS calls
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20, // Perfect for small/medium traffic
  maxFreeSockets: 10,
  timeout: 10000, // Close sockets after 10s idle
});

// ⭐ Axios instance using keep-alive
const client = axios.create({
  httpsAgent: keepAliveAgent,
  timeout: 10000, // API timeout
});

// ⭐ CORS Headers
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
};

function generateOrderId() {
  return `ORD_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

exports.handler = async (event, context) => {
  // Preflight (browser OPTIONS)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // Only POST allowed
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: "Method Not Allowed",
    };
  }

  const start = Date.now();

  try {
    const reqBody = event.body ? JSON.parse(event.body) : {};
    const orderAmount = reqBody.amount || 1000;

    // Input validation
    if (orderAmount <= 0) {
      return { statusCode: 400, headers: corsHeaders, body: "Invalid amount" };
    }

    // Environment
    const baseUrl = process.env.CF_BASE_URL;
    const clientId = process.env.CF_API_KEY;
    const clientSecret = process.env.CF_API_SECRET;

    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error("Cashfree env vars missing");
    }

    // Prepare payload
    const payload = {
      order_id: generateOrderId(),
      order_amount: orderAmount,
      order_currency: "INR",
      customer_details: {
        customer_id: reqBody.customer_id || "CUST001",
        customer_name: reqBody.customer_name || "User",
        customer_phone: reqBody.customer_phone || "9999999999",
        customer_email: reqBody.customer_email || "test@example.com",
      },
    };

    const url = `${baseUrl.replace(/\/$/, "")}/orders`;

    // ⭐ API Call (keep-alive + timed)
    const t1 = Date.now();
    const resp = await client.post(url, payload, {
      headers: {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
    });
    const apiTime = Date.now() - t1;

    const data = resp.data;

    if (!data || !data.order_id || !data.payment_session_id) {
      throw new Error("Invalid response from provider");
    }

    console.log("createOrder total:", Date.now() - start, "ms");
    console.log("provider API time:", apiTime, "ms");

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        order_id: data.order_id,
        payment_session_id: data.payment_session_id,
        provider_time_ms: apiTime,
      }),
    };
  } catch (err) {
    console.error("createOrder error:", err.message || err);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: err.message || "Unknown error",
      }),
    };
  }
};
