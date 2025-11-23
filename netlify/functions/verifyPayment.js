// netlify/functions/verifyPayment.js
const axios = require("axios");

exports.handler = async (event, context) => {

  // Only POST allowed
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: "Method Not Allowed",
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { order_id } = body;

    if (!order_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing order_id" }),
      };
    }

    console.log("Received payment verification for:", order_id);

    // Cashfree Provider Variables
    const baseUrl = process.env.CASHFREE_BASE_URL; // e.g. https://sandbox.cashfree.com/pg/orders
    const clientId = process.env.CASHFREE_API_KEY;
    const clientSecret = process.env.CASHFREE_API_SECRET;

    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error("Cashfree environment variables missing");
    }

    // Call Cashfree verify endpoint
    const resp = await axios.get(`${baseUrl}/orders/${order_id}`, {
      headers: {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
    });

    console.log("Verification response:", resp.data);

    return {
      statusCode: 200,
      body: JSON.stringify(resp.data),
    };
  } catch (error) {
    console.error("Payment verify error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Payment verification failed",
        details:
          error.response?.data || error.message || "Unknown error occurred",
      }),
    };
  }
};
