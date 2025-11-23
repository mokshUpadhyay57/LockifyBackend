// netlify/functions/verifyPayment.js
const axios = require("axios");

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://lockify.co.in";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Credentials": "true",
};

exports.handler = async (event, context) => {
  try {
    // Handle preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    // Only allow POST
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: "Method Not Allowed",
      };
    }

    // Parse body
    const body = event.body ? JSON.parse(event.body) : {};
    const { order_id } = body;
    if (!order_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing order_id" }),
      };
    }

    console.log("[verifyPayment] order_id:", order_id);

    // Env / provider config
    const baseUrl = process.env.CF_BASE; // should be like https://sandbox.cashfree.com/pg
    const clientId = process.env.CF_API_KEY;
    const clientSecret = process.env.CF_API_SECRET;

    if (!baseUrl || !clientId || !clientSecret) {
      console.error("[verifyPayment] Missing Cashfree env vars:", {
        baseUrlExists: !!baseUrl,
        clientIdExists: !!clientId,
        clientSecretExists: !!clientSecret,
      });
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Server misconfigured: missing Cashfree env vars",
        }),
      };
    }

    // Call Cashfree
    const url = `${baseUrl.replace(/\/$/, "")}/orders/${encodeURIComponent(
      order_id
    )}`;
    console.log("[verifyPayment] calling Cashfree:", url);

    const resp = await axios.get(url, {
      headers: {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    console.log("[verifyPayment] Cashfree response status:", resp.status);
    // Return the provider response to client (with CORS headers)
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(resp.data),
    };
  } catch (err) {
    console.error(
      "[verifyPayment] error:",
      err && (err.stack || err.message || err)
    );
    if (err.response) {
      console.error(
        "[verifyPayment] axios response data:",
        err.response.status,
        err.response.data
      );
    }
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Payment verification failed",
        details: err.response?.data || err.message || String(err),
      }),
    };
  }
};
