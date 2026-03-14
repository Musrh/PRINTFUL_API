import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Backend Printful fonctionne !");
});

app.get("/printful/products", async (req, res) => {

  try {

    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`
      }
    });

    const data = await response.json();

    res.json(data);

  } catch (error) {

    console.error(error);
    res.status(500).json({ error: "Erreur Printful API" });

  }

});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur port ${PORT}`);
});
