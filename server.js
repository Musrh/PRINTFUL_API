// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------
// CORS
app.use(
  cors({
    origin: ["*"], // tu peux mettre ton front ici
    methods: ["GET", "POST"],
  })
);

// ----------------------------
// JSON
app.use(express.json());

// ----------------------------
// Firebase
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT non défini !");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ----------------------------
// Racine
app.get("/", (req, res) => res.send("Printful Backend running 🚀"));

// ----------------------------
// Import produits Printful
app.get("/printful/products", async (req, res) => {
  const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY; // ta clé Printful
  if (!PRINTFUL_API_KEY) return res.status(500).json({ error: "Printful API key missing" });

  try {
    const response = await fetch("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const data = await response.json();

    if (!data.result) return res.status(500).json({ error: "No products found" });

    // Stocker dans Firestore
    const batch = db.batch();
    data.result.forEach((item) => {
      const ref = db.collection("PrintfulProducts").doc(item.id.toString());
      batch.set(ref, {
        id: item.id,
        name: item.name,
        description: item.sync_product?.variants?.[0]?.name || "",
        retail_price: item.retail_price,
        thumbnail: item.sync_product?.images?.[0]?.url || "",
        external_id: item.external_id || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    res.json({ status: "ok", count: data.result.length, result: data.result });
  } catch (err) {
    console.error("Erreur fetching Printful products:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// Start server
app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
