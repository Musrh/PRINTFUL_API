import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* 🔹 Initialisation Firebase */
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* 🔹 Test serveur */
app.get("/", (req, res) => {
  res.send("Backend Printful + Firestore OK");
});

/* 🔹 Importer produits Printful → Firestore */
app.get("/import-printful", async (req, res) => {

  try {

    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`
      }
    });

    const data = await response.json();

    let imported = 0;

    for (const p of data.result) {

      const variant = p.variants && p.variants[0] ? p.variants[0] : {};

      const product = {
        name: p.name || "Produit Printful",
        description: `Produit ${p.name} imprimé à la demande`,
        price: variant.retail_price || variant.price || 0,
        image: p.thumbnail_url || "",
        printful_id: p.id,
        source: "printful",
        active: true,
        createdAt: new Date()
      };

      await db.collection("Printfulproducts")
        .doc(`printful_${p.id}`)
        .set(product);

      imported++;

    }

    res.json({
      message: "Produits importés dans Printfulproducts",
      total: imported
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Erreur import Printful"
    });

  }

});

/* 🔹 Lire produits Firestore */
app.get("/printful-products", async (req, res) => {

  try {

    const snapshot = await db.collection("Printfulproducts").get();

    const products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(products);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Erreur lecture Firestore"
    });

  }

});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur port ${PORT}`);
});
