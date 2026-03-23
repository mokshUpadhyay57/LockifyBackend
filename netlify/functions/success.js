// netlify/functions/success.js
const crypto = require("crypto");
const admin = require("firebase-admin");

// Initialize Firebase Admin (Idempotent initialization)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Handle newline characters in private key from env var
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

exports.handler = async (event) => {
  console.log("Webhook called");

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const rawBody = event.body;
  const ts = event.headers["x-webhook-timestamp"];
  const signature = event.headers["x-webhook-signature"];
  const CASHFREE_SECRET = process.env.CF_API_SECRET;

  const expected = crypto
    .createHmac("sha256", CASHFREE_SECRET)
    .update(ts + rawBody)
    .digest("base64");

  if (expected !== signature) {
    console.error("Invalid Cashfree webhook signature");
    return { statusCode: 401, body: "Invalid signature" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("Invalid JSON:", err);
    return { statusCode: 400, body: "Bad request" };
  }

  const order = payload.data?.order;
  const payment = payload.data?.payment;

  if (order?.order_status === "PAID") {
    const orderId = order.order_id;
    const lockedMessageId = order.order_tags?.lockedMessageId;
    const buyerPhone = payload.data?.customer_details?.customer_phone;

    console.log("Processing PAID order:", { orderId, lockedMessageId, buyerPhone });

    try {
      // Idempotent write: Use orderId as Document ID
      const orderRef = db.collection("orders").doc(orderId);
      const purchaseRef = db.collection("purchases").doc(orderId);

      const batch = db.batch();

      // 1. Record the order
      batch.set(orderRef, {
        orderId,
        cfOrderId: order.cf_order_id,
        cfPaymentId: payment?.cf_payment_id,
        amount: order.order_amount,
        status: "PAID",
        lockedMessageId,
        buyerPhone,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // 2. Grant access (Purchases collection)
      batch.set(purchaseRef, {
        lockedMessageId,
        buyerPhone,
        orderId,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      console.log("Database updated successfully for order:", orderId);
    } catch (dbErr) {
      console.error("Firestore update failed:", dbErr);
      // Return 500 so Cashfree retries the webhook
      return { statusCode: 500, body: "Database Error" };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
