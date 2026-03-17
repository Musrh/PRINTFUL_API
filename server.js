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

// ----------------------------
// Middlewares
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
app.get("/", (req, res) =>
  res.send("Printful + Stripe + PayPal backend running 🚀")
);

// ================= PRINTFUL =================

// Import produits depuis Printful
app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = db.batch();

    for (const item of products) {
      const details = await axios.get(
        `https://api.printful.com/store/products/${item.id}`,
        { headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` } }
      );

      const product = details.data.result;

      const variants = (product.sync_variants || []).map((v) => {
        let size = "";
        let color = "N/A";

        const options = v.options || [];
        const sizeOption = options.find((o) => o.name?.toLowerCase().includes("size"));
        const colorOption = options.find((o) => o.name?.toLowerCase().includes("color"));

        if (sizeOption) size = sizeOption.value || "";
        if (colorOption) color = colorOption.value || "N/A";

        if (!size && v.size) size = v.size;
        if (v.color) color = v.color;

        if ((!size || size === "") && v.name) {
          const parts = v.name.split(" / ");
          if (parts.length >= 2) size = parts[1];
          if (parts.length >= 3) color = parts[2];
        }

        const thumbnail =
          v.files?.find((f) => f.type === "preview")?.preview_url ||
          v.files?.[0]?.preview_url ||
          product.sync_product?.thumbnail_url ||
          null;

        return {
          id: v.id,
          size,
          color,
          price: v.retail_price ? parseFloat(v.retail_price) : 0,
          thumbnail,
        };
      });

      const availableSizes = [...new Set(variants.map((v) => v.size).filter((s) => s && s !== ""))].sort();
      const availableColors = [...new Set(variants.map((v) => v.color).filter((c) => c && c !== "N/A"))];

      const price = variants[0]?.price || 0;
      const thumbnail = variants[0]?.thumbnail || null;
      const description = product.sync_product?.description || "Description non disponible";

      const productData = {
        id: item.id,
        name: item.name,
        description,
        price,
        thumbnail,
        variants,
        availableSizes,
        availableColors,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = db.collection("PrintfulProducts").doc(item.id.toString());
      batch.set(ref, productData);
    }

    await batch.commit();
    res.json({ status: "ok", message: `${products.length} produits importés` });
  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// API pour récupérer produits Printful
app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await db.collection("PrintfulProducts").get();
    const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ products });
  } catch (err) {
    console.error("Erreur récupération produits:", err.message);
    res.status(500).json({ products: [] });
  }
});

// ================= STRIPE =================
let stripe;
app.post("/create-stripe-session", async (req, res) => {
  if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { items, email, adresseLivraison } = req.body;

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

// ================= PAYPAL =================
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
      montant: capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise: capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items,
      adresseLivraison,
    });

    res.json({ capture });
    console.log("✅ Commande PayPal enregistrée dans Firestore");
  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= START SERVER =================
app.listen(PORT, () => console.log(`🚀 Backend Printful + Payments running on port ${PORT}`));
