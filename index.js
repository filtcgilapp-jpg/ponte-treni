const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

app.get('/treno/:numero', async (req, res) => {
    try {
        const numero = req.params.numero;
        
        // FASE 1: Troviamo l'ID del treno e la stazione di partenza
        // Questo endpoint è solitamente più stabile e meno protetto
        const cercaTrenoUrl = `http://www.viaggiatreno.it/infomobilita/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
        
        const infoTreno = await axios.get(cercaTrenoUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        // Se infoTreno.data è una stringa vuota o HTML, il treno non esiste o siamo bloccati
        if (!infoTreno.data || typeof infoTreno.data === 'string') {
            return res.status(404).json({ error: "Treno non trovato o server occupato" });
        }

        // FASE 2: Recuperiamo il dettaglio (ID stazione e codice treno)
        // L'oggetto restituito da ViaggiaTreno contiene codOrigine e numeroTreno
        const { codOrigine, numeroTreno } = infoTreno.data;

        // FASE 3: Chiamata per l'andamento live
        const andamentoUrl = `http://www.viaggiatreno.it/infomobilita/vt_pax_internet/mobile/andamento?treno=${numeroTreno}&stazione=${codOrigine}`;
        
        const andamento = await axios.get(andamentoUrl);
        res.json(andamento.data);

    } catch (error) {
        console.error("Errore:", error.message);
        res.status(500).json({ error: "Errore nel recupero dati live" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server Open-Proxy attivo"));
