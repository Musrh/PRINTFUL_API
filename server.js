// server.js
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🔹 Middlewares
app.use(cors());
app.use(express.json());

// 🔹 Firebase Printful
const serviceAccountPrintful = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_Printful);

// 👇 Nom unique pour éviter conflit avec autre app Firebase
const appPrintful = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccountPrintful) },
  "printfulApp"
);
const dbPrintful = appPrintful.firestore();

// 🔹 Racine simple pour tester
app.get("/", (req, res) => res.send("Printful backend is running 🚀"));

// 🔹 Importer produits Printful et stocker dans Firestore
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

      // Nom du produit
      const name = item.name || "Nom non disponible";

      // Description
      const description = item.description || "Description non disponible";

      // Image : on prend la première image preview_url disponible
      let thumbnail = null;
      if (item.files && item.files.length > 0) {
        // Certaines images ont "preview_url", d'autres "thumbnail_url"
        const file = item.files[0];
        thumbnail = file.preview_url || file.thumbnail_url || null;
      }

      // Prix : on prend le prix du premier variant
      const price =
        item.variants && item.variants.length > 0
          ? parseFloat(item.variants[0].retail_price) || 0
          : 0;

      batch.set(ref, {
        id: item.id,
        name,
        description,
        price,
        thumbnail,
        source: "Printful",
        variants: item.variants || [],
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();

    res.send({ status: "ok", message: `${products.length} produits importés` });
  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).send({ status: "error", message: err.message });
  }
});

// 🔹 Récupérer tous les produits pour le front-end
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

// 🔹 Lancer le serveur
app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
