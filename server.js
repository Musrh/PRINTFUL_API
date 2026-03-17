app.post("/capture-paypal-order", async (req, res) => {
  const { orderId, user, items, adresseLivraison } = req.body;

  if (!user?.email || !adresseLivraison) {
    return res.status(400).json({ error: "Informations manquantes" });
  }

  try {
    // Capture le paiement
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    // 🔹 Enregistrement dans Firestore
    const montant = capture.result.purchase_units[0].payments.captures[0].amount.value;
    const devise = capture.result.purchase_units[0].payments.captures[0].amount.currency_code;

    await db.collection("commandes").add({
      paypalOrderId: orderId,
      email: user.email,
      montant,
      devise,
      statut: "payé",
      date: admin.firestore.FieldValue.serverTimestamp(),
      items,
      adresseLivraison
    });

    res.json({ capture, message: "Commande PayPal enregistrée ✅" });

  } catch (err) {
    console.error("Capture PayPal error:", err);
    res.status(500).json({ error: err.message });
  }
});
