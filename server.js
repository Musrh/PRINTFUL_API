import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

app.get("/", (req, res) => res.send("Backend running 🚀"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
