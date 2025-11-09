const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

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

// create payment session
app.post("/payments", async (req, res) => {
  const orderId = generateOrderId();
  const userData = {
    id: "CUST001",
    name: "John Doe",
    phone: "9999999999",
    email: "customer@example.com",
  };
  try {
    const amount = 1000; // Replace with actual amount
    // Create Order
    const resp = await fetch(`${cashfree_base_url}/orders`, {
      method: "POST",
      headers: {
        "x-client-id": cashfree_api_key,
        "x-client-secret": cashfree_api_secret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: generateOrderId(),
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: userData.id,
          customer_name: userData.name,
          customer_phone: userData.phone,
          customer_email: userData.email,
        },
      }),
    });
    console.log(
      "Order request sent to Cashfree, response status:",
      resp.status
    );
    const data = await resp.json();

    // Check if the order was created successfully
    if (data.order_status === "ACTIVE") {
      console.log("Cashfree order created successfully:", data);

      // Simulate payment processing
      console.log("Processing payment for order ID:", orderId);
      res.send(data);
    } else {
      console.error("Failed to create Cashfree order");
      return res.status(500).send("Failed to create payment session");
    }

  } catch (error) {
    console.error("Error creating payment session:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
