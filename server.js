const variants = (product.sync_variants || []).map((v) => {
  // Récupérer les options si elles existent
  const options = v.options || [];

  // Couleur : si absente → "N/A"
  const color =
    options.find((o) => o?.name?.toLowerCase().includes("color"))?.value ||
    "N/A";

  // Taille : si absente → on laisse vide (afficher rien)
  const size =
    options.find((o) => o?.name?.toLowerCase().includes("size"))?.value ||
    "";

  // Mockup avec design
  const thumbnail =
    v.files?.find((f) => f.type === "preview")?.preview_url ||
    v.files?.[0]?.preview_url ||
    product.sync_product?.thumbnail_url ||
    null;

  return {
    id: v.id,
    color,
    size,
    price: v.retail_price ? parseFloat(v.retail_price) : 0,
    thumbnail,
  };
});
