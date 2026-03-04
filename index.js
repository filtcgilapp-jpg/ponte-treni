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

// Health check
app.get('/', (req, res) => res.send('VT Proxy OK'));

// GET /treno/:numero
app.get('/treno/:numero', async (req, res) => {
  const numero = req.params.numero;

  try {
    // Step 1: autocomplete → codOrigine
    const autoUrl = `${VT}/cercaNumeroTrenoTrenoAutocomplete/${numero}`;
    const autoRes = await axios.get(autoUrl, {
      headers: HEADERS,
      timeout: 12000,
      responseType: 'text',
    });

    const body1 = (autoRes.data || '').toString().trim();
    console.log(`[${numero}] Autocomplete: "${body1.split('\n')[0]}"`);

    if (!body1) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    // "Treno 9604 - MILANO CENTRALE|9604-S01700"
    const firstLine = body1.split('\n')[0];
    const parts = firstLine.split('|');
    if (parts.length < 2) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    const token = parts[1].trim();
    const dashIdx = token.indexOf('-');
    if (dashIdx < 0) {
      return res.status(404).json({ error: 'Codice origine non trovato.' });
    }

    const numeroTreno = token.substring(0, dashIdx);
    const codOrigine = token.substring(dashIdx + 1);
    console.log(`[${numero}] numeroTreno=${numeroTreno} codOrigine=${codOrigine}`);

    // Step 2: andamento in tempo reale
    const ts = Date.now();
    const andamentoUrl = `${VT}/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
    const andamentoRes = await axios.get(andamentoUrl, {
      headers: HEADERS,
      timeout: 12000,
      responseType: 'text',
    });

    const body2 = (andamentoRes.data || '').toString().trim();
    console.log(`[${numero}] Andamento (primi 120): "${body2.substring(0, 120)}"`);

    if (!body2) {
      return res.status(404).json({ error: `Dati non disponibili per il treno ${numero}.` });
    }

    // Prova a parsare come JSON
    let parsed;
    try {
      parsed = JSON.parse(body2);
    } catch (_) {
      return res.status(404).json({
        error: `Treno ${numero} non ancora attivo o dati non disponibili.`,
        raw: body2.substring(0, 120),
      });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(404).json({ error: `Dati non validi per il treno ${numero}.` });
    }

    res.json(parsed);

  } catch (err) {
    console.error(`[/treno/${numero}] Errore:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`VT Proxy attivo sulla porta ${PORT}`));
