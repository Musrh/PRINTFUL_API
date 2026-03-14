import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔹 Route pour récupérer les produits Printful
app.get("/printful/products", async (req, res) => {
  try {

    const response = await fetch("https://api.printful.com/store/products", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`
      }
    });

    const data = await response.json();

    // Transformation des produits
    const products = (data.result || []).map((p) => {

      const variant = p.variants && p.variants.length > 0 ? p.variants[0] : {};

      return {
        id: p.id,
        name: p.name,

        // image
        thumbnail_url:
          p.thumbnail_url ||
          (variant.files && variant.files[0]
            ? variant.files[0].preview_url
            : ""),

        // description
        description:
          p.description ||
          "Produit premium imprimé à la demande",

        // prix
        retail_price:
          variant.retail_price ||
          variant.price ||
          "0"
      };

    });

    res.json({ result: products });

  } catch (error) {

    console.error("Erreur Printful:", error);
    res.status(500).json({
      error: "Impossible de récupérer les produits Printful"
    });

  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur port ${PORT}`);
});
