// netlify/functions/createOrder.js
const axios = require("axios"); // make sure axios is in dependencies
const https = require("https");

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const base = process.env.CF_BASE_URL;
const cashfree_api_key = process.env.CF_API_KEY;
const cashfree_api_secret = process.env.CF_API_SECRET;


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

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};



function generateOrderId() {
  return `ORD_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

/* NOTE: adapt these helper URLs/headers to your payment provider */
async function createOrder(payload) {
  if (!base) throw new Error("PAYMENT_API_BASE not set");
  const url = `${base}/orders`; // ensure no trailing slash issues
  const headers = {
    "x-client-id": cashfree_api_key,
    "x-client-secret": cashfree_api_secret,
    "x-api-version": "2025-01-01",
    "Content-Type": "application/json",
  };
  return client.post(url, payload, { headers });
}

async function payOrder(paymentSessionId, paymentMethod) {
  if (!base) throw new Error("PAYMENT_API_BASE not set");
  // adapt if provider expects GET vs POST
  const url = `${base}/orders/sessions`;
  const headers = {
    "x-client-id": cashfree_api_key,
    "x-client-secret": cashfree_api_secret,
    "x-api-version": "2025-01-01",
    "Content-Type": "application/json",
  };
  return client.post(
    url,
    { payment_session_id: paymentSessionId, payment_method: paymentMethod },
    { headers }
  );
}

/* Exported handler (Netlify expects exports.handler) */
exports.handler = async (event, context) => {
  // enforce POST
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
    const orderId = generateOrderId();

    const payload = {
      order_id: orderId,
      order_amount: reqBody.amount || 1000,
      order_currency: reqBody.currency || "INR",
      customer_details: reqBody.customer_details || {
        customer_id: reqBody.customer_id || "CUST001",
        // customer_name: reqBody.customer_name || "John Doe",
        customer_phone: reqBody.customer_phone || "9999999999",
        // customer_email: reqBody.customer_email || "customer@example.com",
      },
    };

    // create order on provider
    const t1 = Date.now();
    const orderResp = await createOrder(payload);
    const apiTime = Date.now() - t1;
    const data = orderResp.data;
    console.log("Order creation response:", JSON.stringify(data));

    
    console.log("provider API time:", apiTime, "ms");

    // success check: adapt to provider fields
    if (data.order_status === "ACTIVE") {
      const session = data.payment_session_id || data.session_id || data.payment_session;
      const paymentMethod = { upi: { channel: "link" } };
      const t2 = Date.now();
      const payOrderResponse = await payOrder(session, paymentMethod);
      const secondApiTime = Date.now() - t2;
      console.log("payOrderResponse api:", secondApiTime, "ms");
      console.log("OverAll total:", Date.now() - start, "ms");
      console.log("Payment session data:", JSON.stringify(payOrderResponse.data)
      );
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          payment_session_id: data.payment_session_id || session,
          order_id: data.order_id || orderId,
          provider_response: paymentSessionResp.data,
        }),
      };
    }

    // provider returned non-success
    console.error("Provider createOrder failed:", JSON.stringify(data));
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to create payment session",
        details: data,
      }),
    };
  } catch (err) {
    // Always return CORS headers (very important)
    console.error(
      "createOrder error:",
      err && (err.stack || err.message || err)
    );
    // If axios error, log response body for debugging
    if (err && err.response) {
      console.error("Axios response:", err.response.status, err.response.data);
    }
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err && (err.message || String(err)) }),
    };
  }
};
