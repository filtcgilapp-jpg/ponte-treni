const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

// Abilita CORS per permettere a Flutter Web di comunicare con questo server
app.use(cors());

app.get('/treno/:numero', async (req, res) => {
    try {
        const numero = req.params.numero;
        
        // URL AGGIORNATO: ViaggiaTreno ha spostato le API sotto /infomobilita/
        const urlRicerca = `http://www.viaggiatreno.it/infomobilita/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
        
        console.log(`Ricerca treno numero: ${numero}`);

        const response = await axios.get(urlRicerca, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'http://www.viaggiatreno.it/'
            },
            timeout: 10000 // 10 secondi di attesa per la risposta da ViaggiaTreno
        });

        // Se riceviamo HTML invece di JSON (Redirect), lanciamo un errore
        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
            console.log("Rilevato redirect HTML invece di JSON");
            return res.status(500).json({ error: 'Il server ferroviario ha risposto con un redirect. Riprova tra poco.' });
        }

        // Restituisci i dati JSON puri a Flutter
        res.json(response.data);

    } catch (error) {
        console.error("Errore durante la chiamata API:", error.message);
        res.status(500).json({ 
            error: 'Errore nel recupero dati dal server ferroviario',
            details: error.message 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server ponte attivo sulla porta ${PORT}`);
});
