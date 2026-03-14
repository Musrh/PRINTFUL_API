// server.js
import express from "express";
import fetch from "node-fetch"; // ou 'undici' si Node 18+
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors()); // pour que Vue puisse faire fetch

// Route pour récupérer les produits Printful
app.get("/printful/products", async (req, res) => {
  try {
    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      },
    });
    const data = await response.json();
    res.json(data); // renvoie le JSON complet à ton frontend
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Lancement du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
