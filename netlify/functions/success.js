// netlify/functions/cf-webhook.js

const crypto = require("crypto");

// Note: Netlify Functions get event + context arguments
exports.handler = async (event) => {
  console.log("webhook called")
  console.log("Received event:", event);
  // Only accept POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Get raw body as string
  const rawBody = event.body;

  const ts = event.headers["x-webhook-timestamp"];
  const signature = event.headers["x-webhook-signature"];

  // Replace with your actual Cashfree secret
  const CASHFREE_SECRET = process.env.CF_API_SECRET;

  // Compute expected signature
  const expected = crypto
    .createHmac("sha256", CASHFREE_SECRET)
    .update(ts + rawBody)
    .digest("base64");

  if (expected !== signature) {
    console.error("Invalid Cashfree webhook signature");
    return {
      statusCode: 401,
      body: "Invalid signature",
    };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("Invalid JSON in webhook body:", err);
    return { statusCode: 400, body: "Bad request" };
  }

  // Now you have verified webhook
  console.log("Cashfree webhook payload:", payload);

  const order = payload.data?.order;
  const payment = payload.data?.payment;

  if (order?.order_status === "PAID") {
    const orderId = order.order_id;
    const cfOrderId = order.cf_order_id;
    const cfPaymentId = payment?.cf_payment_id;

    // TODO: update your database: mark order paid, store cf IDs/amounts, unlock product etc.
    console.log("Order paid:", { orderId, cfOrderId, cfPaymentId });
  }

  // Respond 200 so Cashfree knows you received the webhook
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
