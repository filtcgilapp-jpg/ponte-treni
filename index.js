const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

app.get('/treno/:numero', async (req, res) => {
    try {
        const numero = req.params.numero;
        
        // URL specifico che restituisce JSON e non HTML
        const urlRicerca = `http://www.viaggiatreno.it/infomobilita/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
        
        console.log(`Tentativo di recupero per treno: ${numero}`);

        const response = await axios.get(urlRicerca, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'http://www.viaggiatreno.it/infomobilita/index.jsp',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 10000 // 10 secondi di attesa
        });

        // Se riceviamo HTML invece di JSON, significa che siamo stati reindirizzati
        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
            console.error("Rilevato redirect HTML (blocco bot)");
            return res.status(403).json({ error: "Accesso negato dal server ferroviario. Riprova tra un istante." });
        }

        res.json(response.data);

    } catch (error) {
        console.error("Errore axios:", error.message);
        res.status(500).json({ 
            error: 'Il server ferroviario non risponde',
            details: error.message 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Proxy ponte-treni attivo sulla porta ${PORT}`);
});
