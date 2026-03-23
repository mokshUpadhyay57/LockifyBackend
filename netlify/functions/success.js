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

  console.log("Full Webhook Payload received:", JSON.stringify(payload, null, 2));

  if (order?.order_status === "PAID") {
    const orderId = order.order_id;
    // Fallback: Check tags, then check notes, then default to "unknown"
    const lockedMessageId = order.order_tags?.lockedMessageId || "unknown";
    const buyerPhone = payload.data?.customer_details?.customer_phone || "9999999999";

    console.log("Confirmed PAID order. Updating Firestore...", { orderId, lockedMessageId, buyerPhone });

    try {
      const orderRef = db.collection("orders").doc(orderId);
      const purchaseRef = db.collection("purchases").doc(orderId);

      const batch = db.batch();

      batch.set(orderRef, {
        status: "PAID",
        cfOrderId: order.cf_order_id,
        cfPaymentId: payment?.cf_payment_id,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        // Include these in case the 'CREATED' step was skipped
        lockedMessageId,
        buyerPhone,
        amount: order.order_amount,
      }, { merge: true });

      batch.set(purchaseRef, {
        lockedMessageId,
        buyerPhone,
        orderId,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      console.log("✅ Firestore updated to PAID for order:", orderId);
    } catch (dbErr) {
      console.error("❌ Firestore update failed:", dbErr);
      return { statusCode: 500, body: "Database Error" };
    }
  } else {
    console.log("⚠️ Order status is not PAID:", order?.order_status);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
