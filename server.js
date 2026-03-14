// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";

// 🔹 Firestore
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Endpoint pour synchroniser les produits Printful vers Firestore
app.get("/printful/sync", async (req, res) => {
  try {
    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      },
    });

    const data = await response.json();
    const products = data.result || [];

    const batch = db.batch();
    products.forEach((p) => {
      const docRef = db.collection("PrintfulProducts").doc(p.id.toString());
      batch.set(docRef, {
        id: p.id,
        name: p.name,
        description: p.description || "",
        retail_price: p.retail_price || "",
        thumbnail: p.thumbnail || "",
        variants: p.variants || [],
      });
    });

    await batch.commit();

    res.json({ success: true, count: products.length });
  } catch (err) {
    console.error("Erreur sync Printful:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Endpoint pour récupérer les produits depuis Firestore
app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await db.collection("PrintfulProducts").get();
    const products = snapshot.docs.map((doc) => doc.data());
    res.json({ result: products });
  } catch (err) {
    console.error("Erreur fetch Firestore:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Printful backend running on port ${PORT}`));
