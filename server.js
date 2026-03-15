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

// 🔹 Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_Printful);

const firebaseApp = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccount) },
  "printfulApp"
);

const db = firebaseApp.firestore();

// 🔹 Test serveur
app.get("/", (req, res) => {
  res.send("Printful backend running 🚀");
});

// 🔹 IMPORT PRODUITS PRINTFUL + STOCKAGE FIRESTORE
app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

    // 1️⃣ Récupérer liste produits
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = db.batch();

    for (const item of products) {
      // 2️⃣ Détails de chaque produit
      const details = await axios.get(`https://api.printful.com/store/products/${item.id}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });

      const product = details.data.result;

      // 🔹 Variantes avec couleurs, tailles, prix et mockup avec design
      const variants = product.sync_variants?.map((v) => {
        const color = v.options?.find(o => o.type === "color")?.value || "N/A";
        const size  = v.options?.find(o => o.type === "size")?.value || "N/A";

        // 🔹 Chercher mockup avec design
        const thumbnail = v.files?.find(f => f.type === "preview")?.preview_url || 
                          v.files?.[0]?.preview_url ||
                          null;

        return {
          id: v.id,
          color,
          size,
          price: v.retail_price ? parseFloat(v.retail_price) : 0,
          thumbnail,
        };
      }) || [];

      // 🔹 Produit principal
      const productData = {
        id: item.id,
        name: item.name,
        description: product.sync_product?.description || "Description non disponible",
        price: variants[0]?.price || 0,
        thumbnail: variants[0]?.thumbnail || null, // mockup principal
        variants,
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

// 🔹 API PRODUITS POUR LE FRONTEND
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

// 🔹 Lancer serveur
app.listen(PORT, () => {
  console.log(`🚀 Printful backend running on port ${PORT}`);
});
