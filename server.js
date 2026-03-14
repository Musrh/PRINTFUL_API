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

// 🔹 Firebase Printful (app séparée)
const serviceAccountPrintful = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_Printful);

const appPrintful = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccountPrintful) },
  "printfulApp" // nom unique pour éviter conflit
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

      // Image
      let thumbnail = null;
      if (item.files?.length) thumbnail = item.files[0].preview_url;
      else if (item.variants?.length) {
        const v = item.variants.find(v => v.files?.length);
        if (v) thumbnail = v.files[0].preview_url;
      }

      // Prix
      let price = 0;
      if (item.variants?.length) {
        const v = item.variants.find(v => parseFloat(v.retail_price) > 0);
        if (v) price = parseFloat(v.retail_price);
      }

      // Description
      let description = item.description || "";
      if (!description && item.variants?.length) description = item.variants[0].variant_name || "";
      if (!description) description = "Description non disponible";

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
    res.json({ products });
  } catch (err) {
    console.error("Erreur fetching Printful products:", err.message);
    res.status(500).json({ products: [] });
  }
});

app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
