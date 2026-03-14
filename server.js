import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Initialiser Firebase avec la nouvelle variable
if (!process.env.FIREBASE_SERVICE_ACCOUNT_Printful) {
  throw new Error("❌ FIREBASE_SERVICE_ACCOUNT_Printful non défini !");
}

const serviceAccountPrintful = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_Printful
);

const firebaseAppPrintful = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccountPrintful) },
  "printfulApp" // nom unique si tu veux avoir plusieurs apps
);

const dbPrintful = firebaseAppPrintful.firestore();

// 🔹 Test route
app.get("/", (req, res) => {
  res.send("Printful backend is running 🚀");
});

// 🔹 Import produits Printful et stockage dans Firestore
app.get("/import-printful-products", async (req, res) => {
  try {
    const response = await axios.get("https://api.printful.com/products"); 
    const products = response.data.result; // dépend de l'API Printful

    const batch = dbPrintful.batch();

    products.forEach((item) => {
      const ref = dbPrintful.collection("PrintfulProducts").doc(item.id.toString());
      batch.set(ref, {
        nom: item.name,
        description: item.description || "",
        prix: item.retail_price || 0,
        images: item.images || [],
        source: "Printful",
      });
    });

    await batch.commit();

    res.send({ status: "ok", message: products.length + " produits importés" });
  } catch (err) {
    console.error("Import Printful error:", err.message);
    res.status(500).send({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Printful backend running on port ${PORT}`));
