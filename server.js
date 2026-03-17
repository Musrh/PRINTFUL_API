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
// Sécurité et middlewares
app.use(helmet());

// ⚠️ Pour Stripe webhook, express.raw est utilisé plus bas
app.use(
  cors({
    origin: ["https://wellshoppings.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());

// ----------------------------
// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ----------------------------
// Racine simple
app.get("/", (req, res) => res.send("Printful API + Payments running 🚀"));

// ----------------------------
// Import produits Printful
app.get("/printful/import-products", async (req, res) => {
  try {
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = db.batch();

    for (const p of products) {
      const variantsArray = Array.isArray(p.variants) ? p.variants : [];
      const processedVariants = variantsArray.map((v) => ({
        id: v.id,
        size: v.size || "",
        color: v.color || "",
        price: v.retail_price || 0,
        thumbnail: v.files?.[0]?.preview_url || null,
      }));

      const availableSizes = [...new Set(processedVariants.map(v => v.size).filter(s => s))];
      const availableColors = [...new Set(processedVariants.map(v => v.color).filter(c => c))];

      const ref = db.collection("PrintfulProducts").doc(p.id.toString());
      batch.set(ref, {
        id: p.id,
        name: p.name,
        description: p.description || "Description non disponible",
        price: p.retail_price || 0,
        thumbnail: p.files?.[0]?.preview_url || null,
        variants: processedVariants,
        availableSizes,
        availableColors,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    res.json({ status: "ok", message: `${products.length} produits importés` });
  } catch (err) {
    console.error("Erreur Printful:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ----------------------------
// Récupérer produits
app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await db.collection("PrintfulProducts").get();
    const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ products });
  } catch (err) {
    console.error("Erreur récupération produits:", err.message);
    res.status(500).json({ products: [] });
  }
});

// ----------------------------
// Stripe
let stripe;
app.post("/create-stripe-session", async (req, res) => {
  if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { items, email, adresseLivraison } = req.body;

  try {
    const line_items = items.map(i => ({
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
        adresseLivraison
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
// Stripe webhook pour enregistrer la commande
app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const items = JSON.parse(session.metadata.items || "[]");
    const email = session.metadata.email || "";
    const adresseLivraison = session.metadata.adresseLivraison || "";

    try {
      await db.collection("commandes").add({
        stripeSessionId: session.id,
        email,
        adresseLivraison,
        items,
        montant: session.amount_total / 100,
        devise: session.currency.toUpperCase(),
        statut: "payé",
        date: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("✅ Commande Stripe enregistrée dans Firestore");
    } catch (err) {
      console.error("Erreur enregistrement Stripe:", err.message);
    }
  }

  res.json({ received: true });
});

// ----------------------------
// PayPal
let paypalClient;
app.post("/create-paypal-order", async (req, res) => {
  if (!paypalClient) {
    const env = process.env.PAYPAL_ENV === "live"
      ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
      : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
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
  if (!user?.email || !adresseLivraison) return res.status(400).json({ error: "Informations manquantes" });

  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    const montant = capture.result.purchase_units[0].payments.captures[0].amount.value;
    const devise = capture.result.purchase_units[0].payments.captures[0].amount.currency_code;

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      montant,
      devise,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items,
      adresseLivraison
    });

    res.json({ capture, message: "Commande PayPal enregistrée ✅" });
  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// Start server
app.listen(PORT, () => console.log(`🚀 Printful API + Payments running on port ${PORT}`));
