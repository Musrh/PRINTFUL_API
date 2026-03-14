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

// 🔹 Firebase Printful
const serviceAccountPrintful = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_Printful);

const appPrintful = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccountPrintful) },
  "printfulApp" // nom unique pour éviter conflit avec autre backend
);
const dbPrintful = appPrintful.firestore();

// 🔹 Racine
app.get("/", (req, res) => res.send("Printful backend is running 🚀"));

// 🔹 Import produits Printful et stockage dans Firestore
app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = dbPrintful.batch();

    products.forEach((item) => {
      const ref = dbPrintful.collection("PrintfulProducts").doc(item.id.toString());

      // 🔹 Récupérer l'image preview correctement
      const thumbnail =
        item.files?.find((f) => f.type === "preview")?.preview_url || null;

      // 🔹 Récupérer le prix du premier variant
      const price =
        item.variants && item.variants.length > 0
          ? parseFloat(item.variants[0].retail_price)
          : 0;

      // 🔹 Description fallback
      const description = item.description || "Description non disponible";

      batch.set(ref, {
        id: item.id,
        name: item.name || "Nom non disponible",
        description,
        price,
        thumbnail,
        source: "Printful",
      });
    });

    await batch.commit();

    res.send({ status: "ok", message: `${products.length} produits importés` });
  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).send({ status: "error", message: err.message });
  }
});

// 🔹 Récupérer produits pour le front
app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await dbPrintful.collection("PrintfulProducts").get();
    const products = snapshot.docs.map((doc) => doc.data());
    res.json({ products }); // front-end attend "products"
  } catch (err) {
    console.error("Erreur fetching Printful products:", err.message);
    res.status(500).json({ products: [] });
  }
});

// 🔹 Start server
app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
