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

app.get('/', (req, res) => res.send('VT Proxy OK - ' + new Date().toISOString()));

app.get('/treno/:numero', async (req, res) => {
  const numero = req.params.numero;

  try {
    // Step 1: autocomplete → ottieni codOrigine e numeroTreno reale
    const autoUrl = `${VT}/cercaNumeroTrenoTrenoAutocomplete/${numero}`;
    const autoRes = await axios.get(autoUrl, {
      headers: HEADERS, timeout: 12000, responseType: 'text',
    });

    const body1 = (autoRes.data || '').toString().trim();
    console.log(`[${numero}] autocomplete: "${body1.split('\n')[0]}"`);

    if (!body1 || !body1.includes('|')) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    // Formato risposta: "Treno 770 - TRIESTE CENTRALE|770-S00317"
    // oppure multipli risultati su righe diverse — prendiamo il primo
    const firstLine = body1.split('\n')[0];
    const pipe = firstLine.indexOf('|');
    if (pipe < 0) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    const token = firstLine.substring(pipe + 1).trim(); // "770-S00317"
    const dashIdx = token.indexOf('-');
    if (dashIdx < 0) {
      return res.status(404).json({ error: 'Codice origine non trovato.' });
    }

    const numeroTreno = token.substring(0, dashIdx);
    const codOrigine = token.substring(dashIdx + 1);
    console.log(`[${numero}] numeroTreno=${numeroTreno} codOrigine=${codOrigine}`);

    // Step 2: andamento in tempo reale
    const ts = Date.now();
    const andUrl = `${VT}/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
    const andRes = await axios.get(andUrl, {
      headers: HEADERS, timeout: 12000, responseType: 'text',
    });

    const body2 = (andRes.data || '').toString().trim();
    console.log(`[${numero}] andamento (150): "${body2.substring(0, 150)}"`);

    // Controlla che sia JSON e non HTML
    if (!body2 || body2.startsWith('<') || body2.startsWith('\n<')) {
      return res.status(404).json({
        error: `Dati non disponibili per il treno ${numero}. Potrebbe non essere ancora partito.`,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(body2);
    } catch (e) {
      console.error(`[${numero}] JSON parse error:`, e.message, '| body:', body2.substring(0, 200));
      return res.status(404).json({
        error: `Treno ${numero} non ancora attivo o dati non disponibili.`,
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
