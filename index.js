const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

app.get('/treno/:numero', async (req, res) => {
    try {
        const numero = req.params.numero;
        // Chiamata all'API ufficiale
        const response = await axios.get(`http://www.viaggiatreno.it/viaggiatrenonew/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`);
        
        console.log("Dati ricevuti per treno:", numero, response.data);
        
        // Se i dati sono validi, inviamoli come JSON
        if (response.data) {
            res.json(response.data);
        } else {
            res.status(404).json({ error: 'Nessun dato trovato' });
        }
    } catch (error) {
        console.error("Errore API:", error.message);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});
