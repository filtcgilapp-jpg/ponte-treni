const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

app.get('/treno/:numero', async (req, res) => {
    try {
        const numero = req.params.numero;
        // Usiamo l'endpoint mobile che è meno protetto dai firewall
        const urlRicerca = `http://www.viaggiatreno.it/infomobilita/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
        
        const response = await axios.get(urlRicerca, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'http://www.viaggiatreno.it/infomobilita/index.jsp',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        // Se il server risponde con HTML (redirect), inviamo un errore gestibile
        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
            return res.status(403).json({ error: "Accesso temporaneamente limitato dal fornitore dati." });
        }

        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Errore server ferroviario', details: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy attivo sulla porta ${PORT}`));
