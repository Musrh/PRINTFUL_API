import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------
// Sécurité & Middlewares
app.use(helmet());
app.use(cors({ origin: "*" })); // Ou ton front uniquement
app.use(express.json());

// -------------------
// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// -------------------
// Racine
app.get("/", (req, res) => res.send("Printful backend running 🚀"));

// -------------------
// Import produits Printful et stock Firestore
app.get("/printful/products", async (req, res) => {
  try {
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];

    const batch = db.batch();
    products.forEach((prod) => {
      const docRef = db.collection("PrintfulProducts").doc(prod.id.toString());

      // Préparer données (image principale, nom, description, prix)
      const mainVariant = prod.variants?.[0] || {};
      const image = prod.files?.[0]?.preview_url || "";
      const description = prod.name || "";
      const retail_price = mainVariant.retail_price || 0;

      batch.set(docRef, {
        id: prod.id,
        name: prod.name,
        description,
        retail_price,
        image,
        variant_id: mainVariant.id || null,
        source: "Printful",
      });
    });

    await batch.commit();

    res.json({ status: "ok", count: products.length, products });
  } catch (err) {
    console.error("Erreur Printful:", err.response?.data || err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// -------------------
// Start serveur
app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
