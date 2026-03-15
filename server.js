// server.js pour Printful complet et sécurisé avec variantes, tailles et couleurs
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

    // 1️⃣ Récupérer la liste des produits
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = db.batch();

    // 2️⃣ Récupérer les détails de chaque produit
    for (const item of products) {
      const details = await axios.get(
        `https://api.printful.com/store/products/${item.id}`,
        { headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` } }
      );

      const product = details.data.result;

      // 🔹 Créer les variantes avec tailles et couleurs
      const variants = (product.sync_variants || []).map((v) => {
        // Récupérer les options depuis Printful
        const options = v.options || [];

        // Taille et couleur
        let size = options.find((o) => o.name.toLowerCase().includes("size"))?.value || "";
        let color = options.find((o) => o.name.toLowerCase().includes("color"))?.value || "N/A";

        // Fallback depuis le nom de la variante
        if (!size || size === "") {
          const parts = v.name?.split(" / ") || [];
          if (parts.length >= 2) size = parts[1] || "";
          if (parts.length >= 3) color = parts[2] || color;
        }

        // Mockup spécifique à la variante (avec design)
        const thumbnail =
          v.files?.find((f) => f.type === "preview")?.preview_url ||
          v.files?.[0]?.preview_url ||
          product.sync_product?.thumbnail_url ||
          null;

        return {
          id: v.id,
          size,
          color,
          price: v.retail_price ? parseFloat(v.retail_price) : 0,
          thumbnail,
        };
      });

      // 🔹 Listes uniques de tailles et couleurs
      const availableSizes = [...new Set(variants.map((v) => v.size).filter((s) => s))].sort();
      const availableColors = [...new Set(variants.map((v) => v.color).filter((c) => c && c !== "N/A"))];

      // 🔹 Prix global (première variante)
      const price = variants[0]?.price || 0;

      // 🔹 Mockup principal (première variante)
      const thumbnail = variants[0]?.thumbnail || null;

      // 🔹 Description
      const description = product.sync_product?.description || "Description non disponible";

      const productData = {
        id: item.id,
        name: item.name,
        description,
        price,
        thumbnail,
        availableSizes,
        availableColors,
        variants,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = db.collection("PrintfulProducts").doc(item.id.toString());
      batch.set(ref, productData);
    }

    await batch.commit();

    res.json({
      status: "ok",
      message: `${products.length} produits importés`,
    });
  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 🔹 API PRODUITS POUR LE FRONTEND
app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await db.collection("PrintfulProducts").get();
    const products = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

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
