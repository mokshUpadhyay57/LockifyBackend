const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { default: axios } = require("axios");

// Load environment variables from .env file
const PORT = process.env.PORT;

const cashfree_api_key = process.env.CF_API_KEY;
const cashfree_api_secret = process.env.CF_API_SECRET;
const cashfree_base_url = process.env.CF_BASE;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const generateOrderId = () => {
  const uniqueId = crypto.randomBytes(8).toString("hex");
  const hash = crypto.createHash("sha256").update(uniqueId);
  const orderId = hash.digest("hex");
  return orderId.substring(0, 10);
};

const createOrder = (payload) => {
  const response = axios.post(`${cashfree_base_url}/orders`, payload, {
    headers: {
      "x-client-id": cashfree_api_key,
      "x-client-secret": cashfree_api_secret,
      "x-api-version": "2025-01-01",
      "Content-Type": "application/json",
    },
  });
  return response;
};

// get order by payment session id
const getOrder = (paymentSessionId, paymentMethod) => {
  const response = axios.post(
    `${cashfree_base_url}/orders/sessions`,
    { payment_session_id: paymentSessionId, payment_method: paymentMethod },
    {
      headers: {
        "x-client-id": cashfree_api_key,
        "x-client-secret": cashfree_api_secret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
    }
  );
  return response;
};

// create payment session
app.post("/payments", async (req, res) => {
  const payload = {
    order_id: generateOrderId(),
    order_amount: 1000, // Replace with actual amount
    order_currency: "INR",
    customer_details: {
      customer_id: "CUST001",
      customer_name: "John Doe",
      customer_phone: "9999999999",
      customer_email: "customer@example.com",
    },
  };
  try {
    const amount = 1000; // Replace with actual amount
    const orderResponse = await createOrder(payload);
    const data = orderResponse.data;
    console.log("Order creation response:", data);
    // Check if the order was created successfully
    if (data.order_status === "ACTIVE") {
      console.log("Cashfree order created successfully:", data);
      const session = data.payment_session_id;
      // Simulate payment processing
      console.log("Processing payment for order ID:", data.order_id);
      paymentMethod = {
        upi: {
          channel: "link",
        },
      };
      const paymentSessionId = await getOrder(session, paymentMethod);
      console.log("Payment session data:", paymentSessionId.data);
      return res.send({
        payment_session_id: data.payment_session_id,
        order_id: data.order_id,
      });
    } else {
      console.error("Failed to create Cashfree order");
      return res.status(500).send("Failed to create payment session");
    }
  } catch (error) {
    console.error("Error getting payment session:", error);
    res.status(404).send("Resource not found");
  }
});

// verify payment
app.post("/verifyPayment", async (req, res) => {
  console.log("Received payment verification request", req.body);
  const { order_id } = req.body;
  console.log("Verifying payment for order ID:", order_id);
  try {
    const resp = await axios.get(`${cashfree_base_url}/orders/${order_id}`, {
      headers: {
        "x-client-id": cashfree_api_key,
        "x-client-secret": cashfree_api_secret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
    });
    const data = resp.data;
    console.log("Payment verification data:", data);
    res.send(data);
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(400).send("Payment verification failed");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
