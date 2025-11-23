// netlify/functions/create-payment.js
const axios = require("axios");

/**
 * Minimal generateOrderId helper
 */
function generateOrderId() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `ORD_${ts}_${rand}`;
}

const base = process.env.CF_BASE;
const cashfree_api_key = process.env.CF_API_KEY;
const cashfree_api_secret = process.env.CF_API_SECRET;

async function createOrder(payload) {
  if (!base) throw new Error("base is not set");

  // Example URL: change to provider's "create order" endpoint
  const url = `${base}/orders`;

  const headers = {
      "x-client-id": cashfree_api_key,
      "x-client-secret": cashfree_api_secret,
      "x-api-version": "2025-01-01",
      "Content-Type": "application/json",
    }

  const resp = await axios.post(url, payload, { headers });
  return resp;
}

async function getOrder(paymentSessionId, paymentMethod) {
  if (!base) throw new Error("base is not set");

  // Example URL: change to provider's "get payment session" endpoint
  const url = `${base}/payment-sessions/${paymentSessionId}`;

  const headers =  {
        "x-client-id": cashfree_api_key,
        "x-client-secret": cashfree_api_secret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      }

  // If the provider expects a POST to generate a checkout link, change method accordingly
  const resp = await axios.post(
    url,
    { payment_method: paymentMethod },
    { headers }
  );
  return resp;
}

exports.payments = async (event, context) => {
  // Allow only POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const reqBody = event.body ? JSON.parse(event.body) : {};
    // You can accept amount/orderId from client or compute server-side:
    const orderId = generateOrderId();

    const payload = {
      order_id: orderId,
      order_amount: reqBody.amount || 1000, // fallback if not provided
      order_currency: reqBody.currency || "INR",
      customer_details: {
        customer_id: reqBody.customer_id || "CUST001",
        customer_name: reqBody.customer_name || "John Doe",
        customer_phone: reqBody.customer_phone || "9999999999",
        customer_email: reqBody.customer_email || "customer@example.com",
      },
    };

    // 1) Create order on provider
    const orderResponse = await createOrder(payload);
    const data = orderResponse.data;
    console.log("Order creation response:", data);

    // Adapt this check to the provider's success flag
    if (
      data.order_status === "ACTIVE" ||
      data.status === "OK" ||
      data.success
    ) {
      const session =
        data.payment_session_id || data.session_id || data.payment_session;

      // choose the payment method you want to simulate / pass on
      const paymentMethod = {
        upi: {
          channel: "link",
        },
      };

      // 2) Get payment session / checkout data
      const paymentSessionResp = await getOrder(session, paymentMethod);
      console.log("Payment session data:", paymentSessionResp.data);

      return {
        statusCode: 200,
        body: JSON.stringify({
          payment_session_id: data.payment_session_id || session,
          order_id: data.order_id || orderId,
          provider_response: paymentSessionResp.data,
        }),
      };
    } else {
      console.error("Failed to create payment order", data);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to create payment session",
          details: data,
        }),
      };
    }
  } catch (err) {
    console.error(
      "create-payment error:",
      err && err.response
        ? err.response.data || err.message
        : err.message || err
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
