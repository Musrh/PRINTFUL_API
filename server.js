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

//
// 🔹 Initialisation Firestore
//
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

//
// 🔹 1. Lire les produits depuis Printful
//
app.get("/printful/products", async (req, res) => {

  try {

    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`
      }
    });

    const data = await response.json();

    const products = (data.result || []).map(p => {

      const variant = p.variants && p.variants[0] ? p.variants[0] : {};

      return {
        id: p.id,
        name: p.name,
        image: p.thumbnail_url,
        price: variant.retail_price || variant.price || 0,
        description: `Produit ${p.name} imprimé à la demande`,
        printful_id: p.id
      };

    });

    res.json({ result: products });

  } catch (error) {

    console.error(error);
    res.status(500).json({ error: "Erreur récupération Printful" });

  }

});

//
// 🔹 2. Importer produits Printful → Firestore
//
app.get("/import-printful", async (req, res) => {

  try {

    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`
      }
    });

    const data = await response.json();

    for (const p of data.result) {

      const variant = p.variants && p.variants[0] ? p.variants[0] : {};

      await db.collection("Printfulproducts").doc(`printful_${p.id}`).set({

        name: p.name,
        image: p.thumbnail_url,
        price: variant.retail_price || variant.price || 0,
        description: `Produit ${p.name} imprimé à la demande`,
        printful_id: p.id,
        source: "printful",
        active: true

      });

    }

    res.json({
      message: "Produits importés dans Firestore",
      total: data.result.length
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Erreur import Printful"
    });

  }

});

//
// 🔹 3. Lire produits depuis Firestore (pour ton site)
//
app.get("/products", async (req, res) => {

  try {

    const snapshot = await db.collection("products").get();

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

//
// 🔹 Démarrage serveur
//
app.listen(PORT, () => {
  console.log(`Serveur démarré sur port ${PORT}`);
});
