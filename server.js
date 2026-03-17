
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------
// Firestore
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ----------------------------
// Middleware
app.use(cors({ origin: "https://wellshoppings.com" }));
app.use(express.json());

// ----------------------------
// Test serveur
app.get("/", (req, res) => res.send("Printful API backend running 🚀"));

// ----------------------------
// Importer produits Printful
app.get("/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const products = response.data.result || [];

    const batch = db.batch();

    for (const item of products) {
      const details = await axios.get(`https://api.printful.com/store/products/${item.id}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });
      const product = details.data.result;
      const variant = product.sync_variants?.[0];
      const price = variant?.retail_price ? parseFloat(variant.retail_price) : 0;
      const thumbnail = variant?.product?.image || product?.sync_product?.thumbnail_url || null;

      const productData = {
        id: item.id,
        name: item.name,
        description: product?.sync_product?.description || "Description non disponible",
        price,
        thumbnail,
        variants: product.sync_variants?.length || 0,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = db.collection("PrintfulProducts").doc(item.id.toString());
      batch.set(ref, productData);
    }

    await batch.commit();
    res.json({ status: "ok", message: `${products.length} produits importés` });
    console.log(`✅ ${products.length} produits Printful importés`);
  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ----------------------------
// Récupérer les produits pour le front
app.get("/products", async (req, res) => {
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
// Lancer le serveur
app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
