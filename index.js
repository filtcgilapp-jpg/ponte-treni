const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();

// Abilita CORS per permettere a Flutter Web (anche su Cloud Workstations) di leggere i dati
app.use(cors());

app.get("/", (req, res) => res.send("Proxy Treni Online!"));

app.get("/treno/:numero", async (req, res) => {
  const numero = req.params.numero;
  // Chiamata al server di Trenitalia
  const url = `http://www.viaggiatreno.it/viaggiatrenonew/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
  
  try {
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Errore nel recupero dati" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
