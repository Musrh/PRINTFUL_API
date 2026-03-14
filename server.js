app.get("/printful/import-products", async (req, res) => {
  try {
    const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
    const response = await axios.get("https://api.printful.com/store/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const products = response.data.result || [];
    const batch = dbPrintful.batch();

    products.forEach((item) => {
      const ref = dbPrintful.collection("PrintfulProducts").doc(item.id.toString());

      // Nom
      const name = item.name || "Nom non disponible";

      // Description : prendre description du premier variant si existant
      const description =
        item.variants && item.variants.length > 0
          ? item.variants[0].product?.description || "Description non disponible"
          : "Description non disponible";

      // Thumbnail : chercher preview_url
      let thumbnail = null;
      if (item.files && item.files.length > 0) {
        const previewFile = item.files.find((f) => f.type === "preview") || item.files[0];
        thumbnail = previewFile.preview_url || null;
      }

      // Prix : convertir en float
      const price =
        item.variants && item.variants.length > 0
          ? parseFloat(item.variants[0].retail_price || 0)
          : 0;

      batch.set(ref, {
        name,
        description,
        price,
        thumbnail,
        source: "Printful",
      });
    });

    await batch.commit();
    res.send({ status: "ok", message: `${products.length} produits importés` });
  } catch (err) {
    console.error("Erreur import Printful:", err.message);
    res.status(500).send({ status: "error", message: err.message });
  }
});
