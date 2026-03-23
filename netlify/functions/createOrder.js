// netlify/functions/createOrder.js
const axios = require("axios"); // make sure axios is in dependencies
const https = require("https");
const admin = require("firebase-admin");

// Initialize Firebase Admin (Idempotent initialization)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || "zipind-57",
      clientEmail:
        process.env.FIREBASE_CLIENT_EMAIL ||
        "firebase-adminsdk-fbsvc@zipind-57.iam.gserviceaccount.com",
      privateKey:
        process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") ||
        "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCoUWbSRxJzVKl9\ncAXC7IEzHlew6axnCohI6divMgWwKlz+tUWRyqu/YM64KWAzmsZdTnY/dMyJUupP\nqJYVgc/X7FFLh3CDoVVcJ0Thp0LtWSOC9FzUqrlzQwbDyx50XI6vxyg+dqpQ7zM2\n8o0si2rDUWXfaPG2FuqBNrVKmJdBrJ0zEs99ltqgxthPN/DsX6iCB7TsrYWghMKT\ncg1eU15pwkNjzThsVzfhz+yeNQBQqp+awl1qWhLBvJImcYsne7EocFeYOBcnfL8G\ngMFAzO+CRhIpx/L4HXJpzcRxw2MfLnSddmcJsTRnoYbNb+YDwANQ1hzZ6NBcZN8G\np5e2oWQfAgMBAAECggEACBqvRDWm1kW/yWng5SNFD0SJPVvq8KUprbUQuVLDwlkv\n1BW/TUdAYL0VBvn7B1EO9wQlnmWNyZjj7kT0QQHYk5Ft0qCpUrUsanz7jI/koY/2\nrUH9zEGSH1IdW8UGaNziA+WncuZ8ydvSj/U6xefKkq/zI0AmzzkoPmN3dCmHsuI8\nSESu87ZhH00KQC3/0/XzfWLB/axNRZWEA71VtYqp4n4oPb/CU4bsQb3iGlF7LMUE\nhozpEErviO4//RelVjMiGvAcl4mC+8/HeMbQjV3Vp2pkPJyRaRmg8gpP9NwbVOvI\nbav7nxlqZpW1SSyKNkRAZU9TM4icHCMClZH5olf7fQKBgQDXxbgNVbuKqBfZuuXZ\n5acrnJGJ+N1wAZhIrSrHhJV4r6RVoLezLDuwnM+7vjQcAhBthCwXEgAoHCV2DTV9\nf8xxEcvfTdaku8zYrNG4yjy4aSas38cZ95giMGVFTJH388yIt9DlOTa1yLXWqnci\n/pPQ3J7P1XXDTiWKxVm7uroEUwKBgQDHss2T1wawVkrWZzFvayzeym0CoyXNBTP7\nj+3+1TV8fbaslUmEfz7glAx+lFg6FGr0gaQOrLl/5JqQcv30mVPLTHQTEjDj2imR\nsEPLpJJ8MvVRfljJ8GnjauqBPZuEzcBTir/j+Qohz2LLciBcki0oTtatIAxfIysw\n/5XicsmnhQKBgHDr/sirx3xnQCQolcYVVAmU5O3qGilWDFZsmejU0EzazwwpEjpo\nucxSJL1Ca48E3YgTFef0+bQEFu7TNt05FstN3v48hEquJiR3PUKSRHjWPvFWI6LJ\nWwr5fOZpjjLPmokqed6ctK8qHU/84mCkDsPN0ic+tWTC7w7S/YUr0dIVAoGBALDH\nMMMB43LwQLmBijqGlqb2bP+bqxfN1lGH/PfMh9eXdcFbOkRnXCL0DAd1jJCFiJS/\nupoe/usfVFAw62y+2nWqTUqgnNTnSEsmzS0Vl3MIrS+h+DlzcFkYSVV1UxmCBhIu\nTmYiDH0Xl+5fLhSkdgMrn1CMgUcq2845Qta+JJL9AoGBAJeH2Hvsv/5CKrWGU4dd\ng5Oc+2nsHL3xg+OJxq16F4Y4RrRW+964MiVMPR/l7RiY5Hqtu3F3aoceugIcWneW\nTqCux/N6bS+AipQsfaKCQe9RPtbddQfGkgpwVaK+3yP4xOUbdIf+cQnaZE6vI57I\nwBJkogXdp1B8im6Jhc3EZ9a/",
    }),
  });
}

const db = admin.firestore();

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
  timeout: 15000, // API timeout
  headers: { Connection: "keep-alive" },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

function generateOrderId() {
  return `ORD_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function createOrder(payload) {
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
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
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
      customer_details: {
        customer_id: "GUEST_" + Math.random().toString(36).substring(2, 9),
        customer_phone: reqBody.buyerPhone || "9999999999",
      },
      order_meta: {
        return_url: `${reqBody.returnUrl}?order_id={order_id}`,
      },
      order_tags: {
        lockedMessageId: reqBody.lockedMessageId || "unknown"
      }
    };

    console.log("Order meta:", payload.order_meta);

    // create order on provider
    const t1 = Date.now();
    const orderResp = await createOrder(payload);
    const apiTime = Date.now() - t1;
    const { data } = orderResp;
    console.log("createOrder:", data && data.order_id, "status=", data && data.order_status, "apiMs=", apiTime);
    console.log("createOrder response:", data);
    // success check: adapt to provider fields
    if (data.order_status === "ACTIVE") {
      
      // CREATE INITIAL ORDER IN FIRESTORE
      try {
        await db.collection("orders").doc(orderId).set({
          orderId: orderId,
          amount: payload.order_amount,
          status: "CREATED",
          lockedMessageId: reqBody.lockedMessageId || "unknown",
          buyerPhone: payload.customer_details.customer_phone,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("Firestore order created:", orderId);
      } catch (dbErr) {
        console.error("Firestore initial write failed:", dbErr);
        // We continue anyway so the user can still pay
      }

      const session = data.payment_session_id;
      // for now , we only have upi payments, using compoenents so dont use this payOrder API
      // const paymentMethod = { upi: { channel: "qrcode" } };
      // const t2 = Date.now();
      // // Order Pay API
      // const payOrderResponse = await payOrder(session, paymentMethod);
      // const secondApiTime = Date.now() - t2;
      // console.log("payOrderResponse api:", secondApiTime, "ms");
      // console.log("OverAll total:", Date.now() - start, "ms");
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          payment_session_id: data.payment_session_id,
          order_id: data.order_id,
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
