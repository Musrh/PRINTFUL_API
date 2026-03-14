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
  "printfulApp" // nom unique pour éviter conflit
);
const dbPrintful = appPrintful.firestore();

// 🔹 Racine
app.get("/", (req, res) => res.send("Printful backend is running 🚀"));

// 🔹 Import produits Printful
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

      // 🔹 Image : d'abord item.files, sinon variant.files
      let thumbnail = null;
      if (item.files?.length) thumbnail = item.files[0].preview_url;
      else if (item.variants?.length) {
        const v = item.variants.find(v => v.files?.length);
        if (v) thumbnail = v.files[0].preview_url;
      }

      // 🔹 Prix : premier variant avec retail_price > 0
      let price = 0;
      if (item.variants?.length) {
        const validVariant = item.variants.find(v => v.retail_price && parseFloat(v.retail_price) > 0);
        if (validVariant) price = parseFloat(validVariant.retail_price);
      }

      // 🔹 Description : description ou concat des variant_name
      let description = item.description || "";
      if (!description && item.variants?.length) {
        description = item.variants.map(v => v.variant_name).filter(Boolean).join(", ");
      }
      if (!description) description = "Description non disponible";

      batch.set(ref, {
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
    const products = snapshot.docs.map(doc => doc.data());
    res.json({ products });
  } catch (err) {
    console.error("Erreur fetching Printful products:", err.message);
    res.status(500).json({ products: [] });
  }
});

app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
