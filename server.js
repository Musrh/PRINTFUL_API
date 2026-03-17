import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import dotenv from "dotenv";
import helmet from "helmet";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------
// Security headers
app.use(helmet());
app.use(express.json());
app.use(cors({ origin: ["https://wellshoppings.com"] }));

// ----------------------------
// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ----------------------------
// Racine
app.get("/", (req, res) => res.send("Printful API + Payments running 🚀"));

// ----------------------------
// Stripe
let stripe;
if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/create-stripe-session", async (req, res) => {
  const { items, email, adresseLivraison } = req.body;

  const line_items = items.map((i) => ({
    price_data: {
      currency: "eur",
      product_data: { name: i.nom, images: [i.image || "/placeholder.png"] },
      unit_amount: i.prix * 100,
    },
    quantity: i.quantity,
  }));

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: { items: JSON.stringify(items), email, adresseLivraison },
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// Stripe webhook
app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { email, adresseLivraison, items } = session.metadata
        ? JSON.parse(JSON.stringify(session.metadata))
        : {};

      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email,
        adresseLivraison,
        items: JSON.parse(items),
        montant: session.amount_total / 100,
        devise: session.currency.toUpperCase(),
        statut: "payé",
        date: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("✅ Commande Stripe enregistrée dans Firestore");
    }

    res.status(200).send();
  } catch (err) {
    console.error("Stripe webhook error:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// ----------------------------
// PayPal
let paypalClient;
app.post("/create-paypal-order", async (req, res) => {
  if (!paypalClient) {
    const env =
      process.env.PAYPAL_ENV === "live"
        ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
        : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
    paypalClient = new paypal.core.PayPalHttpClient(env);
  }

  const { items } = req.body;
  const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "EUR", value: total } }] });

  try {
    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, user, items, adresseLivraison } = req.body;
  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      items,
      adresseLivraison,
      montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ capture });
    console.log("✅ Commande PayPal enregistrée dans Firestore");
  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// Start server
app.listen(PORT, () => console.log(`🚀 Printful API + Payments running on port ${PORT}`));
