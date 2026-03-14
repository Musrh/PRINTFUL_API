import fetch from "node-fetch"; // si tu es sur Node 18+ tu peux utiliser fetch directement

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

// Exemple : récupérer tous les produits de la boutique
async function getProducts() {
  const res = await fetch("https://api.printful.com/store/products", {
    headers: {
      "Authorization": `Bearer ${PRINTFUL_API_KEY}`
    }
  });

  const data = await res.json();
  console.log(data);
}

getProducts();
