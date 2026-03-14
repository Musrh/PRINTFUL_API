import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------
// Middlewares
app.use(cors());
app.use(express.json());

// ----------------------------
// Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
console.log("✅ Firebase initialized, project:", serviceAccount.project_id);

// ----------------------------
// Racine simple
app.get("/", (req, res) => res.send("Printful backend running 🚀"));

// ----------------------------
// Endpoint pour récupérer les produits Printful
app.get("/printful/products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
    if (!PRINTFUL_API_KEY) throw new Error("PRINTFUL_API_KEY not set");

    // 🔹 Appel à l'API Printful
    const response = await fetch("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const data = await response.json();

    if (!data || !data.result) return res.json({ result: [] });

    // 🔹 Stockage dans Firestore
    const batch = db.batch();

    data.result.forEach((product) => {
      const docRef = db.collection("Printfulproducts").doc(product.id.toString());

      // Printful stocke souvent prix et description dans variants
      const firstVariant = product.variants?.[0] || {};

      batch.set(docRef, {
        id: product.id,
        name: product.name || "",
        description: firstVariant.description || "",
        retail_price: firstVariant.retail_price || "",
        thumbnail: product.thumbnail || "",
        source: "Printful",
      });
    });

    await batch.commit();
    console.log(`✅ ${data.result.length} produits Printful stockés`);

    // 🔹 Renvoi au frontend
    res.json({ result: data.result.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.variants?.[0]?.description || "",
      retail_price: p.variants?.[0]?.retail_price || "",
      thumbnail: p.thumbnail,
    })) });
  } catch (err) {
    console.error("Erreur Printful:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// Lancement du serveur
app.listen(PORT, () => console.log(`🚀 Backend Printful running on port ${PORT}`));
