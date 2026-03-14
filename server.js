import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// 🔹 Initialiser Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// 🔹 Express
const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Route test
app.get("/", (req, res) => res.send("Backend OK"));

// 🔹 Route pour récupérer et stocker les produits Printful
app.get("/printful/products", async (req, res) => {
  try {
    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!data.result) {
      return res.status(500).json({ error: "Erreur récupération Printful" });
    }

    const products = data.result.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnail: p.files?.[0]?.preview_url || "",
      description: p.description || "",
      retail_price: p.retail_price?.toFixed(2) || "",
      sync_variant_id: p.sync_variant_id || null,
    }));

    // 🔹 Stocker dans Firestore
    const batch = db.batch();
    const collectionRef = db.collection("PrintfulProducts");

    products.forEach((product) => {
      const docRef = collectionRef.doc(product.id.toString());
      batch.set(docRef, product, { merge: true });
    });

    await batch.commit();

    res.json({ result: products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 🔹 Lancer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
