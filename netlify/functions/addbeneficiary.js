const axios = require("axios");
const https = require("https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const ALLOWED_ORIGINS = ["https://lockify.co.in", "https://zipind-57.web.app"];

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  timeout: 10000,
});

const client = axios.create({
  httpsAgent: keepAliveAgent,
  headers: { Connection: "keep-alive" },
});

function buildCorsHeaders(event) {
  const origin = event.headers.origin;
  const configuredOrigin = process.env.ALLOWED_ORIGIN;
  const allowedOrigins = configuredOrigin
    ? [configuredOrigin, ...ALLOWED_ORIGINS]
    : ALLOWED_ORIGINS;

  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

function getPayoutConfig() {
  const clientId =  process.env.CF_API_KEY;
  const clientSecret = process.env.CF_API_SECRET;
  const baseUrl = process.env.CF_PAYOUT_BASE_URL || "https://sandbox.cashfree.com/payout";

  if (!clientId || !clientSecret) {
    throw new Error("Cashfree payout credentials are not configured");
  }

  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    baseUrl: baseUrl.trim(),
  };
}

async function verifyFirebaseToken(event) {
  const authHeader = event.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("No token provided");
  }

  const idToken = authHeader.replace("Bearer ", "");
  const decodedToken = await admin.auth().verifyIdToken(idToken);
  return decodedToken.uid;
}

exports.handler = async (event) => {
  const corsHeaders = buildCorsHeaders(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const config = getPayoutConfig();

    console.log("Calling Cashfree...");
    console.log("Payload:", payload);
    console.log("URL:", `${config.baseUrl}/beneficiary`);

    const response = await client.post(
      `${config.baseUrl}/beneficiary`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": config.clientId,
          "x-client-secret": config.clientSecret,
          "x-api-version": "2024-01-01",
        },
      },
    );

    console.log("addBeneficiary response:", {
      beneficiaryId: payload.beneficiary_id,
      status: response.status,
    });

    return {
      statusCode: response.status === 201 ? 200 : response.status,
      headers: corsHeaders,
      body: JSON.stringify(response.data),
    };
  } catch (err) {
    const statusCode = err.response?.status || 500;
    const errorMsg = err.response?.data?.message || err.message || "Unknown error";

    console.error("FULL ERROR:", {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      data: err.response?.data,
      headers: err.response?.headers,
      url: err.config?.url,
    });

    return {
      statusCode,
      headers: corsHeaders,
      body: JSON.stringify({ error: errorMsg }),
    };
  }
};
