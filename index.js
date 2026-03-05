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

// TheSportsDB free key — no registration, 30 req/min
const SDB = 'https://www.thesportsdb.com/api/v1/json/123';

// Ergast F1 — completamente gratuito, nessuna key
const ERGAST = 'https://ergast.com/api/f1';

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

async function sdbGet(path, ttlMs = 10 * 60 * 1000) {
  const cached = getCache(path);
  if (cached) { console.log(`[CACHE] ${path}`); return cached; }
  console.log(`[SDB] ${SDB}${path}`);
  const r = await axios.get(`${SDB}${path}`, { timeout: 12000 });
  setCache(path, r.data, ttlMs);
  return r.data;
}

async function ergastGet(path, ttlMs = 60 * 60 * 1000) {
  const cached = getCache(`ergast:${path}`);
  if (cached) return cached;
  console.log(`[ERGAST] ${ERGAST}${path}`);
  const r = await axios.get(`${ERGAST}${path}.json`, { timeout: 12000 });
  setCache(`ergast:${path}`, r.data, ttlMs);
  return r.data;
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
    const autoRes = await axios.get(autoUrl, { headers: VT_HEADERS, timeout: 12000, responseType: 'text' });
    const body1 = (autoRes.data || '').toString().trim();
    console.log(`[${numero}] autocomplete: "${body1.split('\n')[0]}"`);
    if (!body1 || !body1.includes('|'))
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    const firstLine = body1.split('\n')[0];
    const pipe = firstLine.indexOf('|');
    if (pipe < 0)
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    const token = firstLine.substring(pipe + 1).trim();
    const parts = token.split('-');
    if (parts.length < 2)
      return res.status(404).json({ error: 'Formato autocomplete non riconosciuto.' });
    const numeroTreno = parts[0];
    const codOrigine = parts[1];
    const dataPartenza = parts[2] || null;
    console.log(`[${numero}] numeroTreno=${numeroTreno} codOrigine=${codOrigine} dataPartenza=${dataPartenza}`);
    const ts = dataPartenza || Date.now().toString();
    const andUrl = `${VT}/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
    console.log(`[${numero}] andUrl: ${andUrl}`);
    const andRes = await axios.get(andUrl, { headers: VT_HEADERS, timeout: 12000, responseType: 'text' });
    const body2 = (andRes.data || '').toString().trim();
    console.log(`[${numero}] andamento (200): "${body2.substring(0, 200)}"`);
    if (!body2 || body2.startsWith('<') || body2.startsWith('\n<'))
      return res.status(404).json({ error: `Dati non disponibili per il treno ${numero}. Potrebbe non essere ancora partito.` });
    let parsed;
    try { parsed = JSON.parse(body2); }
    catch (e) {
      console.error(`[${numero}] JSON parse error: ${e.message}`);
      return res.status(404).json({ error: `Treno ${numero} non ancora attivo o dati non disponibili.` });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return res.status(404).json({ error: `Dati non validi per il treno ${numero}.` });
    res.json(parsed);
  } catch (err) {
    console.error(`[/treno/${numero}] Errore:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SPORT — CERCA (usato da tutti gli sport)
// ══════════════════════════════════════════════════════════════════════════════

// Cerca squadra per nome (calcio, basket, ecc.)
// GET /sport/search/team?q=juventus
app.get('/sport/search/team', async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.q || '');
    res.json(await sdbGet(`/searchteams.php?t=${q}`, 15 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cerca giocatore per nome (tennis, F1, ecc.)
// GET /sport/search/player?q=sinner
app.get('/sport/search/player', async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.q || '');
    res.json(await sdbGet(`/searchplayers.php?p=${q}`, 15 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SPORT — SQUADRA (calcio, basket)
// ══════════════════════════════════════════════════════════════════════════════

// Dettagli squadra
// GET /sport/team/:id
app.get('/sport/team/:id', async (req, res) => {
  try {
    res.json(await sdbGet(`/lookupteam.php?id=${req.params.id}`, 24 * 60 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ultime 5 partite di una squadra
// GET /sport/team/:id/last
app.get('/sport/team/:id/last', async (req, res) => {
  try {
    res.json(await sdbGet(`/eventslast.php?id=${req.params.id}`, 30 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Prossime 5 partite di una squadra
// GET /sport/team/:id/next
app.get('/sport/team/:id/next', async (req, res) => {
  try {
    res.json(await sdbGet(`/eventsnext.php?id=${req.params.id}`, 30 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rosa della squadra
// GET /sport/team/:id/players
app.get('/sport/team/:id/players', async (req, res) => {
  try {
    res.json(await sdbGet(`/lookup_all_players.php?id=${req.params.id}`, 24 * 60 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Leghe di una squadra
// GET /sport/team/:id/leagues
app.get('/sport/team/:id/leagues', async (req, res) => {
  try {
    res.json(await sdbGet(`/lookupleague.php?id=${req.params.id}`, 24 * 60 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SPORT — LEGHE E CLASSIFICHE
// ══════════════════════════════════════════════════════════════════════════════

// Classifica di una lega (stagione corrente)
// GET /sport/league/:id/table
app.get('/sport/league/:id/table', async (req, res) => {
  try {
    const season = req.query.season || new Date().getFullYear().toString();
    res.json(await sdbGet(`/lookuptable.php?l=${req.params.id}&s=${season}`, 60 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ultime partite di una lega
// GET /sport/league/:id/last
app.get('/sport/league/:id/last', async (req, res) => {
  try {
    res.json(await sdbGet(`/eventspastleague.php?id=${req.params.id}`, 30 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Prossime partite di una lega
// GET /sport/league/:id/next
app.get('/sport/league/:id/next', async (req, res) => {
  try {
    res.json(await sdbGet(`/eventsnextleague.php?id=${req.params.id}`, 30 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tutte le squadre di una lega
// GET /sport/league/:id/teams
app.get('/sport/league/:id/teams', async (req, res) => {
  try {
    res.json(await sdbGet(`/lookup_all_teams.php?id=${req.params.id}`, 24 * 60 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SPORT — GIOCATORE (tennis, F1, MotoGP)
// ══════════════════════════════════════════════════════════════════════════════

// Dettagli giocatore/pilota
// GET /sport/player/:id
app.get('/sport/player/:id', async (req, res) => {
  try {
    res.json(await sdbGet(`/lookupplayer.php?id=${req.params.id}`, 24 * 60 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ultime partite/gare di un giocatore
// GET /sport/player/:id/last
app.get('/sport/player/:id/last', async (req, res) => {
  try {
    res.json(await sdbGet(`/eventslast.php?id=${req.params.id}`, 30 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Prossime partite/gare di un giocatore
// GET /sport/player/:id/next
app.get('/sport/player/:id/next', async (req, res) => {
  try {
    res.json(await sdbGet(`/eventsnext.php?id=${req.params.id}`, 30 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F1 — tramite Ergast API (gratuita, nessuna key)
// ID leghe TheSportsDB: F1 = 4370
// ══════════════════════════════════════════════════════════════════════════════

// Calendario F1 stagione corrente
// GET /sport/f1/calendar
app.get('/sport/f1/calendar', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    const data = await ergastGet(`/${season}`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Classifica piloti F1 stagione corrente
// GET /sport/f1/drivers
app.get('/sport/f1/drivers', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    const data = await ergastGet(`/${season}/driverStandings`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Classifica costruttori F1
// GET /sport/f1/constructors
app.get('/sport/f1/constructors', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    const data = await ergastGet(`/${season}/constructorStandings`);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Risultati ultima gara F1
// GET /sport/f1/last
app.get('/sport/f1/last', async (req, res) => {
  try {
    const data = await ergastGet('/current/last/results', 60 * 60 * 1000);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Prossima gara F1 (con tutti i dettagli del weekend)
// GET /sport/f1/next
app.get('/sport/f1/next', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    // Prendi tutto il calendario e trova la prossima gara
    const data = await ergastGet(`/${season}`, 60 * 60 * 1000);
    const races = data?.MRData?.RaceTable?.Races || [];
    const now = new Date();
    const next = races.find(r => new Date(r.date + 'T' + (r.time || '12:00:00Z')) > now);
    res.json({ MRData: { RaceTable: { Races: next ? [next] : [] } } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cerca pilota F1 per nome (via TheSportsDB)
// GET /sport/f1/search?q=hamilton
app.get('/sport/f1/search', async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.q || '');
    // Cerca tra giocatori nel team F1
    res.json(await sdbGet(`/searchplayers.php?p=${q}&t=Formula+1`, 15 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP — TheSportsDB (league id: 4399) + API motogp.com come fallback
// ══════════════════════════════════════════════════════════════════════════════

// Calendario MotoGP (TheSportsDB lega id 4399)
// GET /sport/motogp/calendar
app.get('/sport/motogp/calendar', async (req, res) => {
  try {
    // Prossimi eventi della lega MotoGP
    const next = await sdbGet('/eventsnextleague.php?id=4399', 60 * 60 * 1000);
    const past = await sdbGet('/eventspastleague.php?id=4399', 60 * 60 * 1000);
    res.json({ next: next?.events || [], past: past?.events || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Classifica MotoGP (stagione via TheSportsDB)
// GET /sport/motogp/table
app.get('/sport/motogp/table', async (req, res) => {
  try {
    const season = req.query.season || new Date().getFullYear().toString();
    res.json(await sdbGet(`/lookuptable.php?l=4399&s=${season}`, 60 * 60 * 1000));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// LEGHE PREDEFINITE (ID TheSportsDB)
// ══════════════════════════════════════════════════════════════════════════════
// Utile per la UI — restituisce ID noti delle principali leghe
app.get('/sport/leagues/main', (req, res) => {
  res.json({
    football: [
      { id: '4335', name: 'Serie A', country: 'Italy' },
      { id: '4328', name: 'Premier League', country: 'England' },
      { id: '4331', name: 'La Liga', country: 'Spain' },
      { id: '4332', name: 'Bundesliga', country: 'Germany' },
      { id: '4334', name: 'Ligue 1', country: 'France' },
      { id: '4480', name: 'Champions League', country: 'Europe' },
    ],
    basketball: [
      { id: '4387', name: 'NBA', country: 'USA' },
      { id: '4422', name: 'Euroleague', country: 'Europe' },
      { id: '4421', name: 'Serie A Basket', country: 'Italy' },
    ],
    tennis: [
      { id: '4289', name: 'ATP Tour', country: 'World' },
      { id: '4290', name: 'WTA Tour', country: 'World' },
    ],
  });
});

// ══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy attivo sulla porta ${PORT}`));
