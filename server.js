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

/* ---------------- FIREBASE ---------------- */

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_Printful
);

const firebaseApp = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccount) },
  "printfulApp"
);

const db = firebaseApp.firestore();

/* ---------------- TEST SERVER ---------------- */

app.get("/", (req, res) => {
  res.send("🚀 Printful backend running");
});

/* ---------------- IMPORT PRODUITS PRINTFUL ---------------- */

app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

    const response = await axios.get(
      "https://api.printful.com/store/products",
      {
        headers: {
          Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        },
      }
    );

    const products = response.data.result || [];

    const batch = db.batch();

    for (const item of products) {

      const details = await axios.get(
        `https://api.printful.com/store/products/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${PRINTFUL_API_KEY}`,
          },
        }
      );

      const product = details.data.result;

      const variants = product.sync_variants || [];

      const formattedVariants = variants.map((variant) => {

        // mockup avec design
        const mockup =
          variant?.files?.find((f) => f.type === "preview") ||
          variant?.files?.[0];

        return {
          id: variant.id,
          name: variant.name,
          color: variant.color,
          size: variant.size,

          price: variant.retail_price
            ? parseFloat(variant.retail_price)
            : 0,

          image:
            mockup?.preview_url ||
            mockup?.url ||
            variant?.product?.image ||
            null,
        };
      });

      const mainImage =
        formattedVariants[0]?.image ||
        product?.sync_product?.thumbnail_url ||
        null;

      const mainPrice =
        formattedVariants[0]?.price || 0;

      const productData = {
        id: item.id,

        name: item.name,

        description:
          product?.sync_product?.description ||
          "Description non disponible",

        thumbnail: mainImage,

        price: mainPrice,

        variants: formattedVariants,

        variantCount: formattedVariants.length,

        source: "Printful",

        syncDate: admin.firestore.FieldValue.serverTimestamp(),
      };

      const ref = db
        .collection("PrintfulProducts")
        .doc(item.id.toString());

      batch.set(ref, productData);
    }

    await batch.commit();

    res.json({
      status: "ok",
      message: `${products.length} produits importés`,
    });

  } catch (err) {

    console.error("Erreur import Printful:", err.message);

    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

/* ---------------- API PRODUITS POUR FRONTEND ---------------- */

app.get("/printful/products", async (req, res) => {
  try {

    const snapshot = await db
      .collection("PrintfulProducts")
      .get();

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

/* ---------------- API PRODUIT UNIQUE ---------------- */

app.get("/printful/products/:id", async (req, res) => {
  try {

    const doc = await db
      .collection("PrintfulProducts")
      .doc(req.params.id)
      .get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Produit introuvable" });
    }

    res.json(doc.data());

  } catch (err) {

    console.error(err.message);

    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ---------------- LANCER SERVEUR ---------------- */

app.listen(PORT, () => {
  console.log(`🚀 Printful backend running on port ${PORT}`);
});
