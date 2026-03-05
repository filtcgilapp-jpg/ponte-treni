const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

// ── CONFIGURAZIONE ────────────────────────────────────────────────────────────
const VT = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.viaggiatreno.it/',
  'Origin': 'https://www.viaggiatreno.it',
};

const SPORTS_KEY = '60d25b9d0e6e13236c74b711f521a318';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
};

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── HELPER GENERICO PER API-SPORTS ───────────────────────────────────────────
async function sportsGet(host, path, params = {}, ttlMs = 5 * 60 * 1000) {
  const qs = new URLSearchParams(params).toString();
  const cacheKey = `${host}${path}?${qs}`;
  const cached = getCache(cacheKey);
  if (cached) { console.log(`[CACHE HIT] ${cacheKey}`); return cached; }
  console.log(`[API CALL] https://${host}${path}`, params);
  const res = await axios.get(`https://${host}${path}`, {
    headers: { 'x-apisports-key': SPORTS_KEY },
    params,
    timeout: 10000,
  });
  setCache(cacheKey, res.data, ttlMs);
  return res.data;
}

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Proxy OK - ' + new Date().toISOString()));

// ══════════════════════════════════════════════════════════════════════════════
// TRENI — codice originale invariato
// ══════════════════════════════════════════════════════════════════════════════
app.get('/treno/:numero', async (req, res) => {
  const numero = req.params.numero;
  try {
    const autoUrl = `${VT}/cercaNumeroTrenoTrenoAutocomplete/${numero}`;
    const autoRes = await axios.get(autoUrl, {
      headers: VT_HEADERS, timeout: 12000, responseType: 'text',
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
    const token = firstLine.substring(pipe + 1).trim();
    const parts = token.split('-');
    if (parts.length < 2) {
      return res.status(404).json({ error: 'Formato autocomplete non riconosciuto.' });
    }
    const numeroTreno = parts[0];
    const codOrigine = parts[1];
    const dataPartenza = parts[2] || null;
    console.log(`[${numero}] numeroTreno=${numeroTreno} codOrigine=${codOrigine} dataPartenza=${dataPartenza}`);
    const ts = dataPartenza || Date.now().toString();
    const andUrl = `${VT}/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
    console.log(`[${numero}] andUrl: ${andUrl}`);
    const andRes = await axios.get(andUrl, {
      headers: VT_HEADERS, timeout: 12000, responseType: 'text',
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
    res.json(parsed);
  } catch (err) {
    console.error(`[/treno/${numero}] Errore:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// FOOTBALL  (host: v3.football.api-sports.io)
// ══════════════════════════════════════════════════════════════════════════════
const FB = 'v3.football.api-sports.io';

app.get('/sport/football/search/:name', async (req, res) => {
  try { res.json(await sportsGet(FB, '/teams', { search: req.params.name }, 10 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/football/standing', async (req, res) => {
  try { res.json(await sportsGet(FB, '/standings', { league: req.query.league, season: req.query.season }, 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/football/last/:teamId', async (req, res) => {
  try { res.json(await sportsGet(FB, '/fixtures', { team: req.params.teamId, last: 1 }, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/football/next/:teamId', async (req, res) => {
  try { res.json(await sportsGet(FB, '/fixtures', { team: req.params.teamId, next: 5 }, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/football/live/:teamId', async (req, res) => {
  try { res.json(await sportsGet(FB, '/fixtures', { team: req.params.teamId, live: 'all' }, 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/football/leagues/:teamId', async (req, res) => {
  try { res.json(await sportsGet(FB, '/leagues', { team: req.params.teamId, season: new Date().getFullYear() }, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// FORMULA 1  (host: v1.formula-1.api-sports.io)
// ══════════════════════════════════════════════════════════════════════════════
const F1 = 'v1.formula-1.api-sports.io';

app.get('/sport/f1/next', async (req, res) => {
  try { res.json(await sportsGet(F1, '/races', { season: new Date().getFullYear(), type: 'Race' }, 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/drivers-standing', async (req, res) => {
  try { res.json(await sportsGet(F1, '/rankings/drivers', { season: new Date().getFullYear() }, 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/teams-standing', async (req, res) => {
  try { res.json(await sportsGet(F1, '/rankings/teams', { season: new Date().getFullYear() }, 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// BASKETBALL  (host: v1.basketball.api-sports.io)
// ══════════════════════════════════════════════════════════════════════════════
const BB = 'v1.basketball.api-sports.io';

app.get('/sport/basketball/live', async (req, res) => {
  try { res.json(await sportsGet(BB, '/games', { live: 'all' }, 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/basketball/next', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    res.json(await sportsGet(BB, '/games', { date: today }, 30 * 60 * 1000));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TENNIS  (host: v1.tennis.api-sports.io)
// ══════════════════════════════════════════════════════════════════════════════
const TN = 'v1.tennis.api-sports.io';

app.get('/sport/tennis/live', async (req, res) => {
  try { res.json(await sportsGet(TN, '/games', { live: 'all' }, 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/tennis/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    res.json(await sportsGet(TN, '/games', { date: today }, 15 * 60 * 1000));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/tennis/ranking/atp', async (req, res) => {
  try { res.json(await sportsGet(TN, '/rankings', { type: 'ATP' }, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/tennis/ranking/wta', async (req, res) => {
  try { res.json(await sportsGet(TN, '/rankings', { type: 'WTA' }, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP — scraping da api.motogp.com (API pubblica non documentata)
// ══════════════════════════════════════════════════════════════════════════════
const MOTOGP_API = 'https://api.motogp.com/riders-api/season';

// Calendario gare MotoGP stagione corrente
app.get('/sport/motogp/calendar', async (req, res) => {
  const cacheKey = 'motogp:calendar';
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const season = new Date().getFullYear();
    const url = `${MOTOGP_API}/${season}/events?category=MotoGP&is_published=true`;
    console.log(`[MOTOGP] calendar: ${url}`);
    const response = await axios.get(url, {
      headers: BROWSER_HEADERS,
      timeout: 12000,
    });
    const events = response.data;
    if (!Array.isArray(events)) {
      return res.status(404).json({ error: 'Calendario MotoGP non disponibile.' });
    }
    // Normalizza i dati
    const result = events.map(e => ({
      id: e.id,
      name: e.name,
      shortName: e.short_name,
      country: e.country?.iso || '',
      countryName: e.country?.name || '',
      circuit: e.circuit?.name || '',
      dateStart: e.date_start,
      dateEnd: e.date_end,
      status: e.status, // 'Upcoming', 'In Progress', 'Finished'
    }));
    setCache(cacheKey, result, 60 * 60 * 1000); // 1 ora
    res.json(result);
  } catch (err) {
    console.error('[MOTOGP calendar]', err.message);
    res.status(500).json({ error: 'Errore nel recupero del calendario MotoGP: ' + err.message });
  }
});

// Classifica piloti MotoGP
app.get('/sport/motogp/standing', async (req, res) => {
  const cacheKey = 'motogp:standing';
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const season = new Date().getFullYear();
    // Prima otteniamo la lista delle categorie per trovare l'ID di MotoGP
    const catUrl = `${MOTOGP_API}/${season}/categories`;
    const catRes = await axios.get(catUrl, { headers: BROWSER_HEADERS, timeout: 10000 });
    const categories = catRes.data;
    const motoGPCat = Array.isArray(categories)
      ? categories.find(c => c.name === 'MotoGP' || c.legacy_id === 3)
      : null;

    if (!motoGPCat) {
      return res.status(404).json({ error: 'Categoria MotoGP non trovata.' });
    }

    const standUrl = `https://api.motogp.com/riders-api/season/${season}/standings?category=${motoGPCat.id}`;
    console.log(`[MOTOGP] standings: ${standUrl}`);
    const standRes = await axios.get(standUrl, { headers: BROWSER_HEADERS, timeout: 10000 });
    const standings = standRes.data;

    if (!standings || !Array.isArray(standings.classification)) {
      return res.status(404).json({ error: 'Classifica MotoGP non disponibile.' });
    }

    const result = standings.classification.map(r => ({
      position: r.position,
      points: r.points,
      rider: {
        name: `${r.rider?.name || ''} ${r.rider?.surname || ''}`.trim(),
        number: r.rider?.number || '',
        nationality: r.rider?.country?.iso || '',
        photo: r.rider?.pictures?.profile?.main || null,
      },
      team: r.team?.name || '',
      constructor: r.constructor?.name || '',
    }));

    setCache(cacheKey, result, 60 * 60 * 1000); // 1 ora
    res.json(result);
  } catch (err) {
    console.error('[MOTOGP standing]', err.message);
    res.status(500).json({ error: 'Errore nel recupero della classifica MotoGP: ' + err.message });
  }
});

// Prossimo GP (primo evento con status Upcoming)
app.get('/sport/motogp/next', async (req, res) => {
  const cacheKey = 'motogp:next';
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const season = new Date().getFullYear();
    const url = `${MOTOGP_API}/${season}/events?category=MotoGP&is_published=true`;
    const response = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 12000 });
    const events = response.data;
    if (!Array.isArray(events)) {
      return res.status(404).json({ error: 'Nessun evento trovato.' });
    }
    const now = new Date();
    const next = events.find(e => new Date(e.date_end) >= now);
    if (!next) return res.status(404).json({ error: 'Nessun prossimo GP trovato.' });

    const result = {
      id: next.id,
      name: next.name,
      shortName: next.short_name,
      country: next.country?.iso || '',
      countryName: next.country?.name || '',
      circuit: next.circuit?.name || '',
      dateStart: next.date_start,
      dateEnd: next.date_end,
      status: next.status,
    };
    setCache(cacheKey, result, 30 * 60 * 1000); // 30 min
    res.json(result);
  } catch (err) {
    console.error('[MOTOGP next]', err.message);
    res.status(500).json({ error: 'Errore: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy attivo sulla porta ${PORT}`));
