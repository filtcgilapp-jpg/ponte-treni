const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

app.get('/treno/:numero', async (req, res) => {
    try {
        const numero = req.params.numero;
        // URL specifico per ottenere l'ID del treno e bypassare il redirect HTML
        const urlRicerca = `http://www.viaggiatreno.it/infomobilita/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
        
        console.log(`Ricerca treno: ${numero}`);

        const response = await axios.get(urlRicerca, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'http://www.viaggiatreno.it/infomobilita/'
            }
        });

        // Se la risposta è ancora HTML, inviamo un errore chiaro
        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
             return res.status(500).json({ error: "Il server ferroviario richiede una sessione browser attiva." });
        }

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Errore nel recupero dati', details: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy attivo sulla porta ${PORT}`));
