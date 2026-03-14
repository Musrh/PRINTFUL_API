// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch"; // Node 18+ supporte fetch nativement
import dotenv from "dotenv";

dotenv.config(); // récupère les variables d'environnement

const app = express();
app.use(cors());
app.use(express.json());

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

// Endpoint pour récupérer les produits
app.get("/api/products", async (req, res) => {
  try {
    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        "Authorization": `Bearer ${PRINTFUL_API_KEY}`
      }
    });

    const data = await response.json();
    res.json(data); // renvoie les produits au frontend
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Impossible de récupérer les produits Printful" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
