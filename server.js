// server.js
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

// ----------------------------
// Middlewares
app.use(express.json());

// ⚠️ CORS pour front uniquement
app.use(
  cors({
    origin: ["https://wellshoppings.com"], // ton front
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
// Racine simple pour navigateur
app.get("/", (req, res) => res.send("Stripe & PayPal backend is running 🚀"));

// ----------------------------
// Stripe lazy init
let stripe;
app.post("/create-stripe-session", async (req, res) => {
  if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { items, email, adresseLivraison } = req.body || [];

  if (!items || !items.length) return res.status(400).json({ error: "Panier vide" });

  try {
    const line_items = items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: i.nom,
          images: [i.image || "/placeholder.png"],
          metadata: {
            taille: i.taille || "",
            couleur: i.couleur || "",
          },
        },
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

    // Enregistrer la commande Firestore en statut "en attente"
    await db.collection("commandes").add({
      stripeSessionId: session.id,
      email,
      adresseLivraison,
      items,
      statut: "en attente",
      date: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// PayPal lazy init
let paypalClient;
app.post("/create-paypal-order", async (req, res) => {
  if (!paypalClient) {
    const env =
      process.env.PAYPAL_ENV === "live"
        ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
        : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
    paypalClient = new paypal.core.PayPalHttpClient(env);
  }

  const { items, email, adresseLivraison } = req.body || [];

  if (!items || !items.length) return res.status(400).json({ error: "Panier vide" });

  const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { currency_code: "EUR", value: total },
      },
    ],
  });

  try {
    const order = await paypalClient.execute(request);

    // Enregistrer la commande Firestore en statut "en attente"
    await db.collection("commandes").add({
      paypalOrderId: order.result.id,
      email,
      adresseLivraison,
      items,
      statut: "en attente",
      date: admin.firestore.FieldValue.serverTimestamp(),
    });

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

    // Mettre à jour la commande Firestore avec le statut "payé"
    const commandesRef = db.collection("commandes");
    const snapshot = await commandesRef.where("paypalOrderId", "==", orderId).get();
    snapshot.forEach((doc) =>
      doc.ref.update({
        statut: "payé",
        montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
        devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      })
    );

    res.json({ capture });
    console.log("✅ Commande PayPal enregistrée et capturée dans Firestore");
  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// Start server
app.listen(PORT, () =>
  console.log(`🚀 Backend Stripe & PayPal running on port ${PORT}`)
);
