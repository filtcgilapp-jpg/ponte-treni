const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.viaggiatreno.it/',
  'Origin': 'https://www.viaggiatreno.it',
};

// Health check
app.get('/', (req, res) => res.send('VT Proxy OK - ' + new Date().toISOString()));

// GET /treno/:numero
// 1) prova endpoint nuovo /resteasy (intercity, frecciarossa, ecc.)
// 2) se non trova, prova endpoint vecchio /vt_pax_internet (regionali siciliani, ecc.)
app.get('/treno/:numero', async (req, res) => {
  const numero = req.params.numero;

  try {
    // ── TENTATIVO 1: endpoint nuovo (/resteasy) ───────────────────────────
    const autoUrl = `https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/cercaNumeroTrenoTrenoAutocomplete/${numero}`;
    const autoRes = await axios.get(autoUrl, {
      headers: HEADERS, timeout: 12000, responseType: 'text',
    });

    const body1 = (autoRes.data || '').toString().trim();
    console.log(`[${numero}] Autocomplete resteasy: "${body1.split('\n')[0]}"`);

    if (body1 && body1.includes('|')) {
      // Risposta: "Treno 9604 - MILANO CENTRALE|9604-S01700"
      const firstLine = body1.split('\n')[0];
      const token = firstLine.split('|')[1]?.trim();
      const dashIdx = token ? token.indexOf('-') : -1;

      if (dashIdx >= 0) {
        const numeroTreno = token.substring(0, dashIdx);
        const codOrigine = token.substring(dashIdx + 1);
        console.log(`[${numero}] resteasy → numeroTreno=${numeroTreno} codOrigine=${codOrigine}`);

        const ts = Date.now();
        const andamentoUrl = `https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
        const andRes = await axios.get(andamentoUrl, {
          headers: HEADERS, timeout: 12000, responseType: 'text',
        });

        const body2 = (andRes.data || '').toString().trim();
        console.log(`[${numero}] andamento (100): "${body2.substring(0, 100)}"`);

        try {
          const parsed = JSON.parse(body2);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return res.json(parsed);
          }
        } catch (_) {
          console.log(`[${numero}] andamento non è JSON, provo endpoint vecchio`);
        }
      }
    }

    // ── TENTATIVO 2: endpoint vecchio (/vt_pax_internet) ─────────────────
    // Usato da treni regionali (es. Sicilia/Sardegna)
    console.log(`[${numero}] Provo endpoint vecchio /vt_pax_internet`);

    const oldUrl = `https://www.viaggiatreno.it/vt_pax_internet/mobile/numero?lang=IT&treno=${numero}`;
    const oldRes = await axios.get(oldUrl, {
      headers: { ...HEADERS, Accept: 'application/json' },
      timeout: 12000,
    });

    const oldData = oldRes.data;
    console.log(`[${numero}] vt_pax_internet risposta:`, JSON.stringify(oldData).substring(0, 200));

    if (!oldData || (Array.isArray(oldData) && oldData.length === 0)) {
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    }

    // L'endpoint vecchio può restituire un array o un oggetto
    const trenoInfo = Array.isArray(oldData) ? oldData[0] : oldData;
    const codOrigineVecchio = trenoInfo.codOrigine || trenoInfo.idOrigine || trenoInfo.stazione;
    const numTrenoVecchio = trenoInfo.numeroTreno || trenoInfo.numero || numero;

    if (!codOrigineVecchio) {
      // Restituiamo i dati così come sono dall'endpoint vecchio
      return res.json(trenoInfo);
    }

    // Prova andamento con i dati dell'endpoint vecchio
    const ts2 = Date.now();
    const andUrl2 = `https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/andamentoTreno/${codOrigineVecchio}/${numTrenoVecchio}/${ts2}`;
    const andRes2 = await axios.get(andUrl2, {
      headers: HEADERS, timeout: 12000, responseType: 'text',
    });

    const body3 = (andRes2.data || '').toString().trim();
    try {
      const parsed2 = JSON.parse(body3);
      if (parsed2 && typeof parsed2 === 'object' && !Array.isArray(parsed2)) {
        return res.json(parsed2);
      }
    } catch (_) {}

    // Fallback: restituiamo i dati dell'endpoint vecchio
    res.json(trenoInfo);

  } catch (err) {
    console.error(`[/treno/${numero}] Errore:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`VT Proxy attivo sulla porta ${PORT}`));
