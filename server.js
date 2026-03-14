// server.js
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_Printful);
const firebaseApp = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccount) },
  "printfulApp"
);
const db = firebaseApp.firestore();

// Test serveur
app.get("/", (req, res) => res.send("Printful backend running 🚀"));

// Import produits Printful + stocker Firestore
app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const products = response.data.result;
    const batch = db.batch();

    for (const item of products) {
      const details = await axios.get(`https://api.printful.com/store/products/${item.id}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });

      const product = details.data.result;
      const variant = product.sync_variants?.[0];

      // prix
      const price = variant?.retail_price ? parseFloat(variant.retail_price) : 0;

      // image mockup principale
      const thumbnail = variant?.files?.find(f => f.type === "preview")?.preview_url
                        || variant?.files?.[0]?.preview_url
                        || null;

      // description
      const description = product.sync_product?.description || "Description non disponible";

      const productData = {
        id: item.id,
        name: item.name,
        description,
        price,
        thumbnail,
        variants: product.sync_variants?.length || 0,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      batch.set(db.collection("PrintfulProducts").doc(item.id.toString()), productData);
    }

    await batch.commit();
    res.json({ status: "ok", message: `${products.length} produits importés` });

  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// API produits pour le frontend
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

app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
