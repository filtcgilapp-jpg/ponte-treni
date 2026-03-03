const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();

app.use(cors());

// Rotta di test per vedere se è sveglio
app.get("/", (req, res) => {
  console.log("Ping di risveglio ricevuto!");
  res.send("Server Sveglio!");
});

app.get("/treno/:numero", async (req, res) => {
  const numero = req.params.numero;
  const url = `http://www.viaggiatreno.it/viaggiatrenonew/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
  
  try {
    const response = await axios.get(url, { timeout: 10000 });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Errore ViaggiaTreno" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Backend pronto sulla porta ${PORT}`));
