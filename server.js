// server.js
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import admin from "firebase-admin";
import paypal from "@paypal/checkout-server-sdk";
import axios from "axios";
import dotenv from "dotenv";
import helmet from "helmet";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------
// Security headers
app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: ["https://wellshoppings.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// ----------------------------
// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ----------------------------
// Racine simple
app.get("/", (req, res) => res.send("Printful API + Payments running 🚀"));

// ----------------------------
// ----------------------------
// 🔹 PRINTFUL : Liste produits
app.get("/printful/products", async (req, res) => {
  try {
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}` },
    });

    const products = (response.data.result || []).map((p) => ({
      id: p.id,
      nom: p.name,
      description: p.description || "Description non disponible",
      price: p.retail_price || 0,
      thumbnail: p.files?.[0]?.preview_url || null,
      variants: (p.variants || []).map((v) => ({
        id: v.id,
        size: v.size,
        color: v.color,
        price: v.retail_price,
        thumbnail: v.files?.[0]?.preview_url || null,
      })),
      availableSizes: p.available_sizes || [],
      availableColors: p.available_colors || [],
      source: "Printful",
    }));

    res.json({ products });
  } catch (err) {
    console.error("Erreur Printful:", err.message);
    res.status(500).json({ products: [] });
  }
});

// ----------------------------
// ----------------------------
// 🔹 STRIPE
let stripe;
app.post("/create-stripe-session", async (req, res) => {
  if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { items, email, adresseLivraison } = req.body;

  if (!email || !adresseLivraison)
    return res.status(400).json({ error: "Email ou adresse manquante" });

  try {
    const line_items = items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: { name: i.nom, images: [i.image || "/placeholder.png"] },
        unit_amount: i.prix * 100,
      },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      metadata: {
        items: JSON.stringify(items),
        email,
        adresseLivraison,
      },
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
// 🔹 STRIPE WEBHOOK pour enregistrer commandes
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const items = JSON.parse(session.metadata.items || "[]");
      const email = session.metadata.email;
      const adresseLivraison = session.metadata.adresseLivraison;

      try {
        await db.collection("commandes").add({
          stripeSessionId: session.id,
          email,
          items,
          adresseLivraison,
          montant: session.amount_total / 100,
          devise: session.currency,
          statut: "payé",
          date: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log("✅ Commande Stripe enregistrée dans Firestore");
      } catch (err) {
        console.error("Erreur enregistrement Stripe:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// ----------------------------
// ----------------------------
// 🔹 PAYPAL
let paypalClient;
app.post("/create-paypal-order", async (req, res) => {
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

  const { items } = req.body;
  const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "EUR", value: total } }],
  });

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

  if (!user?.email || !adresseLivraison)
    return res.status(400).json({ error: "Informations manquantes" });

  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    const montant =
      capture.result.purchase_units[0].payments.captures[0].amount.value;
    const devise =
      capture.result.purchase_units[0].payments.captures[0].amount.currency_code;

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

    res.json({ capture, message: "Commande PayPal enregistrée ✅" });
  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// Lancer serveur
app.listen(PORT, () =>
  console.log(`🚀 Printful API + Payments running on port ${PORT}`)
);
