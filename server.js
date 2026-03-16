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
// Security
app.use(helmet());

// ----------------------------
// CORS (autoriser ton domaine)
app.use(
  cors({
    origin: ["https://wellshoppings.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// ----------------------------
// 🔥 FIREBASE (UNE SEULE INIT)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ----------------------------
// ROOT
app.get("/", (req, res) => {
  res.send("🚀 Backend Stripe + PayPal + Printful running");
});

///////////////////////////////////////////////////////////
//////////////////// STRIPE ///////////////////////////////
///////////////////////////////////////////////////////////

let stripe;

app.post("/create-stripe-session", async (req, res) => {
  if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { items, user, shippingAddress } = req.body;

  try {
    const line_items = items.map((i) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: `${i.nom} (${i.size || ""} ${i.color || ""})`,
          images: [i.image || "/placeholder.png"],
        },
        unit_amount: Math.round(i.prix * 100),
      },
      quantity: i.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      success_url: "https://wellshoppings.com/#/success",
      cancel_url: "https://wellshoppings.com/#/cancel",
      metadata: {
        userEmail: user?.email || "",
        shippingAddress: JSON.stringify(shippingAddress),
        items: JSON.stringify(items),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

///////////////////////////////////////////////////////////
//////////////////// PAYPAL ///////////////////////////////
///////////////////////////////////////////////////////////

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

app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items } = req.body;

    const total = items
      .reduce((sum, i) => sum + i.prix * i.quantity, 0)
      .toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");

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

    const order = await getPaypalClient().execute(request);

    res.json({ id: order.result.id });
  } catch (err) {
    console.error("PayPal create error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId, user, items, shippingAddress } = req.body;

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await getPaypalClient().execute(request);

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user?.email || "",
      montant:
        capture.result.purchase_units[0].payments.captures[0].amount.value,
      devise:
        capture.result.purchase_units[0].payments.captures[0].amount.currency_code,
      statut: "payé",
      items,
      shippingAddress,
      date: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("✅ Commande PayPal enregistrée");

    res.json({ success: true });
  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});

///////////////////////////////////////////////////////////
//////////////////// PRINTFUL /////////////////////////////
///////////////////////////////////////////////////////////

app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

    const response = await axios.get(
      "https://api.printful.com/store/products",
      {
        headers: {
          Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        },
      }
    );

    const products = response.data.result || [];
    const batch = db.batch();

    for (const item of products) {
      const details = await axios.get(
        `https://api.printful.com/store/products/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${PRINTFUL_API_KEY}`,
          },
        }
      );

      const product = details.data.result;

      const variants = (product.sync_variants || []).map((v) => ({
        id: v.id,
        size: v.size || "",
        color: v.color || "N/A",
        price: v.retail_price ? parseFloat(v.retail_price) : 0,
        thumbnail:
          v.files?.[0]?.preview_url ||
          product.sync_product?.thumbnail_url ||
          null,
      }));

      const productData = {
        id: item.id,
        name: item.name,
        description:
          product.sync_product?.description || "Description non disponible",
        price: variants[0]?.price || 0,
        thumbnail: variants[0]?.thumbnail || null,
        variants,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = db.collection("PrintfulProducts").doc(item.id.toString());
      batch.set(ref, productData);
    }

    await batch.commit();

    res.json({ status: "ok", message: "Produits importés" });
  } catch (err) {
    console.error("Printful error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await db.collection("PrintfulProducts").get();

    const products = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ products });
  } catch (err) {
    res.status(500).json({ products: [] });
  }
});

///////////////////////////////////////////////////////////
//////////////////// START SERVER /////////////////////////
///////////////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
