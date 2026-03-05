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
    // Step 1: autocomplete
    // Risposta possibile A: "9604 - MILANO CENTRALE|9604-S01700"
    // Risposta possibile B: "770 - TRIESTE CENTRALE - 04/03/26|770-S03317-1772578800000"
    const autoUrl = `${VT}/cercaNumeroTrenoTrenoAutocomplete/${numero}`;
    const autoRes = await axios.get(autoUrl, {
      headers: HEADERS, timeout: 12000, responseType: 'text',
    });

    const body1 = (autoRes.data || '').toString().trim();
    console.log(`[${numero}] autocomplete: "${body1.split('\n')[0]}"`);

    if (!body1 || !body1.includes('|')) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    const firstLine = body1.split('\n')[0];
    const pipe = firstLine.indexOf('|');
    if (pipe < 0) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    // token può essere:
    //   "9604-S01700"              → numero-codOrigine
    //   "770-S03317-1772578800000" → numero-codOrigine-dataPartenza
    const token = firstLine.substring(pipe + 1).trim();
    const parts = token.split('-');
    // parts[0] = numeroTreno
    // parts[1] = codOrigine (lettera + cifre, es. S03317)
    // parts[2] = dataPartenza (timestamp ms, opzionale)

    if (parts.length < 2) {
      return res.status(404).json({ error: 'Formato autocomplete non riconosciuto.' });
    }

    const numeroTreno = parts[0];
    const codOrigine = parts[1];
    const dataPartenza = parts[2] || null; // timestamp ms oppure null

    console.log(`[${numero}] numeroTreno=${numeroTreno} codOrigine=${codOrigine} dataPartenza=${dataPartenza}`);

    // Step 2: andamento
    // Se c'è la dataPartenza usiamo: /andamentoTreno/{cod}/{num}/{data}
    // Altrimenti:                    /andamentoTreno/{cod}/{num}/{now}
    const ts = dataPartenza || Date.now().toString();
    const andUrl = `${VT}/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
    console.log(`[${numero}] andUrl: ${andUrl}`);

    const andRes = await axios.get(andUrl, {
      headers: HEADERS, timeout: 12000, responseType: 'text',
    });

    const body2 = (andRes.data || '').toString().trim();
    console.log(`[${numero}] andamento (200): "${body2.substring(0, 200)}"`);

    if (!body2 || body2.startsWith('<') || body2.startsWith('\n<')) {
      return res.status(404).json({
        error: `Dati non disponibili per il treno ${numero}. Potrebbe non essere ancora partito.`,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(body2);
    } catch (e) {
      console.error(`[${numero}] JSON parse error: ${e.message} | body: ${body2.substring(0, 200)}`);
      return res.status(404).json({
        error: `Treno ${numero} non ancora attivo o dati non disponibili.`,
      });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(404).json({ error: `Dati non validi per il treno ${numero}.` });
    }

    // Debug: logga i campi della prima fermata per capire i nomi esatti
  if (parsed.fermate && parsed.fermate.length > 0) {
    console.log('[DEBUG] Prima fermata keys:', JSON.stringify(Object.keys(parsed.fermate[0])));
    console.log('[DEBUG] Prima fermata:', JSON.stringify(parsed.fermate[0]));
  }

  res.json(parsed);

  } catch (err) {
    console.error(`[/treno/${numero}] Errore:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`VT Proxy attivo sulla porta ${PORT}`));
