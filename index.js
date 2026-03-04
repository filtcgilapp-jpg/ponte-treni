const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const VT = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.viaggiatreno.it/',
  'Origin': 'https://www.viaggiatreno.it',
};

// ── ROUTE PRINCIPALE ──────────────────────────────────────────────────────────
// Cerca il treno e restituisce i dati di andamento in un'unica chiamata.
// Esempio: GET /treno/9604
// ─────────────────────────────────────────────────────────────────────────────
app.get('/treno/:numero', async (req, res) => {
  const numero = req.params.numero;

  try {
    // Step 1: ottieni codOrigine dal numero treno
    const autoUrl = `${VT}/cercaNumeroTrenoTrenoAutocomplete/${numero}`;
    const autoRes = await axios.get(autoUrl, { headers: HEADERS, timeout: 10000, responseType: 'text' });
    const body1 = autoRes.data ? autoRes.data.toString().trim() : '';

    if (!body1) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    // Risposta: "Treno 9604 - MILANO CENTRALE|9604-S01700\n..."
    const firstLine = body1.split('\n')[0];
    const parts = firstLine.split('|');
    if (parts.length < 2) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    const token = parts[1].trim(); // "9604-S01700"
    const dashIdx = token.indexOf('-');
    if (dashIdx < 0) {
      return res.status(404).json({ error: 'Codice origine non trovato.' });
    }

    const numeroTreno = token.substring(0, dashIdx);
    const codOrigine = token.substring(dashIdx + 1);

    // Step 2: dati andamento in tempo reale
    const ts = Date.now();
    const andamentoUrl = `${VT}/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
    const andamentoRes = await axios.get(andamentoUrl, { headers: HEADERS, timeout: 10000 });

    res.json(andamentoRes.data);

  } catch (err) {
    console.error(`[/treno/${numero}] Errore:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('VT Proxy OK');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
