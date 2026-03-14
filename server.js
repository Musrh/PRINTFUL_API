import express from "express";
import cors from "cors";
import axios from "axios";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Endpoint sync produits Printful vers Firestore
app.get("/printful/sync", async (req, res) => {
  try {
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = db.batch();

    products.forEach((p) => {
      const docRef = db.collection("PrintfulProducts").doc(p.id.toString());
      batch.set(docRef, {
        id: p.id,
        name: p.name,
        description: p.description || "",
        retail_price: p.variants?.[0]?.retail_price || "",
        thumbnail: p.thumbnail || "",
        variants: p.variants || [],
      });
    });

    await batch.commit();
    res.json({ success: true, count: products.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint pour récupérer produits depuis Firestore
app.get("/printful/products", async (req, res) => {
  try {
    const snapshot = await db.collection("PrintfulProducts").get();
    const products = snapshot.docs.map((doc) => doc.data());
    res.json({ result: products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Printful backend running on port ${PORT}`));
