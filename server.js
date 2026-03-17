import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Firebase
if (!process.env.FIREBASE_SERVICE_ACCOUNT_Printful) {
  throw new Error("❌ La variable FIREBASE_SERVICE_ACCOUNT_Printful n'est pas définie !");
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_Printful);

const firebaseApp = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccount) },
  "printfulApp"
);

const db = firebaseApp.firestore();

// 🔹 Import Printful
app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = db.batch();

    for (const product of products) {
      // récupérer les détails du produit (variantes, couleurs)
      const detailsRes = await axios.get(
        `https://api.printful.com/store/products/${product.id}`,
        { headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` } }
      );
      const fullProduct = detailsRes.data.result;

      const variants = fullProduct.sync_variants || [];
      const availableSizes = [...new Set(variants.map(v => v.size).filter(Boolean))];
      const availableColors = [...new Set(variants.map(v => v.color).filter(Boolean))];

      const productData = {
        id: product.id,
        name: product.name,
        description: fullProduct.sync_product?.description || "Description non disponible",
        price: Math.min(...variants.map(v => parseFloat(v.retail_price || 0))),
        thumbnail: fullProduct.sync_product?.thumbnail_url || variants[0]?.image || null,
        variants: variants.map(v => ({
          id: v.id,
          size: v.size,
          color: v.color,
          price: parseFloat(v.retail_price || 0),
          sku: v.sku,
        })),
        availableSizes,
        availableColors,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = db.collection("PrintfulProducts").doc(product.id.toString());
      batch.set(ref, productData);
    }

    await batch.commit();
    res.json({ status: "ok", message: `${products.length} produits importés avec variantes et couleurs.` });
  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 🔹 Liste des produits pour frontend
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

// 🔹 Lancer serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
