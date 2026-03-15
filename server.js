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

// 🔹 IMPORT PRODUITS PRINTFUL
app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

    const response = await axios.get(
      "https://api.printful.com/store/products",
      { headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` } }
    );

    const products = response.data.result || [];
    const batch = db.batch();

    for (const item of products) {

      const details = await axios.get(
        `https://api.printful.com/store/products/${item.id}`,
        { headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` } }
      );

      const product = details.data.result;

      // 🔹 Création variantes
      const variants = (product.sync_variants || []).map((v) => {

        let size = "";
        let color = "N/A";

        // 1️⃣ options Printful
        const options = v.options || [];

        const sizeOption = options.find(o =>
          o.name?.toLowerCase().includes("size")
        );

        const colorOption = options.find(o =>
          o.name?.toLowerCase().includes("color")
        );

        if (sizeOption) size = sizeOption.value || "";
        if (colorOption) color = colorOption.value || "N/A";

        // 2️⃣ fallback direct
        if (!size && v.size) size = v.size;
        if (v.color) color = v.color;

        // 3️⃣ fallback depuis le nom
        if ((!size || size === "") && v.name) {
          const parts = v.name.split(" / ");

          if (parts.length >= 2) size = parts[1];
          if (parts.length >= 3) color = parts[2];
        }

        // 🔹 image mockup avec design
        const thumbnail =
          v.files?.find(f => f.type === "preview")?.preview_url ||
          v.files?.[0]?.preview_url ||
          product.sync_product?.thumbnail_url ||
          null;

        return {
          id: v.id,
          size,
          color,
          price: v.retail_price ? parseFloat(v.retail_price) : 0,
          thumbnail
        };
      });

      // 🔹 tailles uniques
      const availableSizes = [
        ...new Set(
          variants
            .map(v => v.size)
            .filter(s => s && s !== "")
        )
      ].sort();

      // 🔹 couleurs uniques
      const availableColors = [
        ...new Set(
          variants
            .map(v => v.color)
            .filter(c => c && c !== "N/A")
        )
      ];

      // 🔹 prix global
      const price = variants[0]?.price || 0;

      // 🔹 image principale
      const thumbnail = variants[0]?.thumbnail || null;

      const description =
        product.sync_product?.description ||
        "Description non disponible";

      const productData = {
        id: item.id,
        name: item.name,
        description,
        price,
        thumbnail,
        variants,
        availableSizes,
        availableColors,
        source: "Printful",
        syncDate: admin.firestore.FieldValue.serverTimestamp()
      };

      const ref = db
        .collection("PrintfulProducts")
        .doc(item.id.toString());

      batch.set(ref, productData);
    }

    await batch.commit();

    res.json({
      status: "ok",
      message: `${products.length} produits importés`
    });

  } catch (err) {

    console.error("Erreur import Printful:", err.message);

    res.status(500).json({
      status: "error",
      message: err.message
    });

  }
});

// 🔹 API produits pour frontend
app.get("/printful/products", async (req, res) => {

  try {

    const snapshot = await db
      .collection("PrintfulProducts")
      .get();

    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
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
