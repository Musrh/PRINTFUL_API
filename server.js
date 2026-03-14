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
  "printfulApp" // nom unique
);
const dbPrintful = appPrintful.firestore();

// 🔹 Racine
app.get("/", (req, res) => res.send("Printful backend is running 🚀"));

// 🔹 Import produits Printful et stockage Firestore
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

      // Nom
      const name = item.name || "Nom non disponible";

      // Description
      const description = item.description || "Description non disponible";

      // Image : on prend la première disponible dans files ou null
      let thumbnail = null;
      if (item.files && item.files.length > 0) {
        const file = item.files.find((f) => f.type === "preview" || f.type === "image");
        thumbnail = file ? file.preview_url || file.url : null;
      }

      // Prix : on cherche le premier variant avec retail_price > 0
      let price = 0;
      if (item.variants && item.variants.length > 0) {
        const variantWithPrice = item.variants.find((v) => v.retail_price && parseFloat(v.retail_price) > 0);
        price = variantWithPrice ? parseFloat(variantWithPrice.retail_price) : 0;
      }

      batch.set(ref, { name, description, price, thumbnail, source: "Printful" });
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
    const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ products });
  } catch (err) {
    console.error("Erreur fetching Printful products:", err.message);
    res.status(500).json({ products: [] });
  }
});

app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
