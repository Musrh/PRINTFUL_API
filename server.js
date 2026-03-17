import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import dotenv from "dotenv";
import helmet from "helmet";
import axios from "axios";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------------------
// Security
app.use(helmet());
app.use(express.json());
app.use(cors());

// -----------------------------
// Firebase (UN SEUL SERVICE ACCOUNT)
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT manquant");
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const db = admin.firestore();

// -----------------------------
// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// -----------------------------
// PayPal
let paypalClient;

function getPaypalClient() {
  if (!paypalClient) {
    const env =
      process.env.PAYPAL_ENV === "live"
        ? new paypal.core.LiveEnvironment(
            process.env.PAYPAL_CLIENT_ID,
            process.env.PAYPAL_SECRET
          )
        : new paypal.core.SandboxEnvironment(
            process.env.PAYPAL_CLIENT_ID,
            process.env.PAYPAL_SECRET
          );

    paypalClient = new paypal.core.PayPalHttpClient(env);
  }

  return paypalClient;
}

// -----------------------------
// ROOT
app.get("/", (req, res) => {
  res.send("🚀 Printful API + Payments running");
});


// =========================================================
// ===================== STRIPE ============================
// =========================================================

app.post("/create-stripe-session", async (req, res) => {
  const { items, email, adresseLivraison } = req.body;

  if (!email || !adresseLivraison)
    return res.status(400).json({ error: "Infos manquantes" });

  try {
    const line_items = items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: i.nom,
          images: [i.image || "/placeholder.png"],
        },
        unit_amount: Math.round(i.prix * 100),
      },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items,
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
      metadata: {
        email,
        adresseLivraison,
        items: JSON.stringify(items),
      },
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});


// 🔥 Stripe Webhook (OBLIGATOIRE pour enregistrer la commande)

app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        await db.collection("commandes").add({
          stripeSessionId: session.id,
          email: session.metadata.email,
          adresseLivraison: session.metadata.adresseLivraison,
          items: JSON.parse(session.metadata.items),
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: "payé",
          date: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log("✅ Commande Stripe enregistrée");
      }

      res.json({ received: true });

    } catch (err) {
      console.error("Webhook error:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);


// =========================================================
// ===================== PAYPAL ============================
// =========================================================

app.post("/create-paypal-order", async (req, res) => {
  const { items } = req.body;

  const total = items
    .reduce((sum, i) => sum + i.prix * i.quantity, 0)
    .toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "EUR",
          value: total,
        },
      },
    ],
  });

  try {
    const order = await getPaypalClient().execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("PayPal create error:", err);
    res.status(500).json({ error: err.message });
  }
});


app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, user, items, adresseLivraison } = req.body;

  if (!user?.email || !adresseLivraison)
    return res.status(400).json({ error: "Infos manquantes" });

  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await getPaypalClient().execute(request);

    const montant =
      capture.result.purchase_units[0].payments.captures[0].amount.value;

    const devise =
      capture.result.purchase_units[0].payments.captures[0].amount
        .currency_code;

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      montant,
      devise,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items,
      adresseLivraison,
    });

    console.log("✅ Commande PayPal enregistrée");

    res.json({ success: true });

  } catch (err) {
    console.error("PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});


// =========================================================
// ===================== PRINTFUL ==========================
// =========================================================

app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await db.collection("PrintfulProducts").get();

    const products = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ products });

  } catch (err) {
    console.error("Printful fetch error:", err);
    res.status(500).json({ products: [] });
  }
});


// =========================================================
// START SERVER
// =========================================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
