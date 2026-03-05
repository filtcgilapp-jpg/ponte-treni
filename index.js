const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

// ── CONFIGURAZIONE ────────────────────────────────────────────────────────────
const VT = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.viaggiatreno.it/',
  'Origin': 'https://www.viaggiatreno.it',
};

const SDB = 'https://www.thesportsdb.com/api/v1/json/123';
// Ergast dismesso → api.jolpi.ca
const ERGAST = 'https://api.jolpi.ca/ergast/f1';

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
  console.log(`[SDB] ${path}`);
  const r = await axios.get(`${SDB}${path}`, { timeout: 12000 });
  setCache(path, r.data, ttlMs);
  return r.data;
}
async function ergastGet(path, ttlMs = 60 * 60 * 1000) {
  const k = `ergast:${path}`;
  const cached = getCache(k);
  if (cached) return cached;
  console.log(`[ERGAST] ${path}`);
  const r = await axios.get(`${ERGAST}${path}.json`, { timeout: 15000 });
  setCache(k, r.data, ttlMs);
  return r.data;
}

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Proxy OK - ' + new Date().toISOString()));

// ── PROXY IMMAGINI (risolve CORS di TheSportsDB) ──────────────────────────────
app.get('/img', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  try {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    const ct = r.headers['content-type'] || 'image/jpeg';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(r.data);
  } catch (err) {
    res.status(404).send('Image not found');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// TRENI
// ══════════════════════════════════════════════════════════════════════════════
app.get('/treno/:numero', async (req, res) => {
  const numero = req.params.numero;
  try {
    const autoUrl = `${VT}/cercaNumeroTrenoTrenoAutocomplete/${numero}`;
    const autoRes = await axios.get(autoUrl, { headers: VT_HEADERS, timeout: 12000, responseType: 'text' });
    const body1 = (autoRes.data || '').toString().trim();
    if (!body1 || !body1.includes('|')) return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    const firstLine = body1.split('\n')[0];
    const pipe = firstLine.indexOf('|');
    if (pipe < 0) return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    const token = firstLine.substring(pipe + 1).trim();
    const parts = token.split('-');
    if (parts.length < 2) return res.status(404).json({ error: 'Formato autocomplete non riconosciuto.' });
    const numeroTreno = parts[0];
    const codOrigine = parts[1];
    const dataPartenza = parts[2] || null;
    const ts = dataPartenza || Date.now().toString();
    const andUrl = `${VT}/andamentoTreno/${codOrigine}/${numeroTreno}/${ts}`;
    const andRes = await axios.get(andUrl, { headers: VT_HEADERS, timeout: 12000, responseType: 'text' });
    const body2 = (andRes.data || '').toString().trim();
    if (!body2 || body2.startsWith('<')) return res.status(404).json({ error: `Dati non disponibili per il treno ${numero}.` });
    let parsed;
    try { parsed = JSON.parse(body2); } catch (e) { return res.status(404).json({ error: `Treno ${numero} non attivo.` }); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return res.status(404).json({ error: `Dati non validi.` });
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RICERCA
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/search/team', async (req, res) => {
  try { res.json(await sdbGet(`/searchteams.php?t=${encodeURIComponent(req.query.q || '')}`, 15 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/search/player', async (req, res) => {
  try { res.json(await sdbGet(`/searchplayers.php?p=${encodeURIComponent(req.query.q || '')}`, 15 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SQUADRA
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/team/:id', async (req, res) => {
  try { res.json(await sdbGet(`/lookupteam.php?id=${req.params.id}`, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Ultime 15 partite
app.get('/sport/team/:id/last', async (req, res) => {
  try { res.json(await sdbGet(`/eventslast.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Prossime 15 partite
app.get('/sport/team/:id/next', async (req, res) => {
  try { res.json(await sdbGet(`/eventsnext.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Rosa
app.get('/sport/team/:id/players', async (req, res) => {
  try { res.json(await sdbGet(`/lookup_all_players.php?id=${req.params.id}`, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Tutte le partite della stagione (per avere tutte le competizioni)
app.get('/sport/team/:id/season', async (req, res) => {
  try {
    const season = req.query.s || new Date().getFullYear().toString();
    res.json(await sdbGet(`/eventsseason.php?id=${req.params.id}&s=${season}`, 60 * 60 * 1000));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Leghe di una squadra (per rilevare automaticamente la classifica)
app.get('/sport/team/:id/leagues', async (req, res) => {
  try {
    // TheSportsDB non ha un endpoint diretto "leghe per squadra",
    // quindi carichiamo le squadre della lega e inferiremo dalla ricerca
    // Alternativa: usiamo lookupteam che ha idLeague
    const data = await sdbGet(`/lookupteam.php?id=${req.params.id}`, 24 * 60 * 60 * 1000);
    const team = data?.teams?.[0];
    if (!team) return res.json({ leagues: [] });
    // La squadra ha idLeague principale
    const leagues = [];
    if (team.idLeague) leagues.push({ idLeague: team.idLeague, strLeague: team.strLeague || '' });
    if (team.idLeague2) leagues.push({ idLeague: team.idLeague2, strLeague: team.strLeague2 || '' });
    if (team.idLeague3) leagues.push({ idLeague: team.idLeague3, strLeague: team.strLeague3 || '' });
    if (team.idLeague4) leagues.push({ idLeague: team.idLeague4, strLeague: team.strLeague4 || '' });
    if (team.idLeague5) leagues.push({ idLeague: team.idLeague5, strLeague: team.strLeague5 || '' });
    if (team.idLeague6) leagues.push({ idLeague: team.idLeague6, strLeague: team.strLeague6 || '' });
    res.json({ leagues: leagues.filter(l => l.idLeague && l.strLeague) });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// LEGHE
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/league/:id/table', async (req, res) => {
  try {
    const season = req.query.season || new Date().getFullYear().toString();
    res.json(await sdbGet(`/lookuptable.php?l=${req.params.id}&s=${season}`, 60 * 60 * 1000));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/league/:id/last', async (req, res) => {
  try { res.json(await sdbGet(`/eventspastleague.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/league/:id/next', async (req, res) => {
  try { res.json(await sdbGet(`/eventsnextleague.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GIOCATORE (Tennis, F1, MotoGP)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/player/:id', async (req, res) => {
  try { res.json(await sdbGet(`/lookupplayer.php?id=${req.params.id}`, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/player/:id/last', async (req, res) => {
  try { res.json(await sdbGet(`/eventslast.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/player/:id/next', async (req, res) => {
  try { res.json(await sdbGet(`/eventsnext.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F1 — Ergast via api.jolpi.ca
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/f1/calendar', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    res.json(await ergastGet(`/${season}`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/drivers', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    res.json(await ergastGet(`/${season}/driverStandings`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/constructors', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    res.json(await ergastGet(`/${season}/constructorStandings`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/last', async (req, res) => {
  try { res.json(await ergastGet('/current/last/results', 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/next', async (req, res) => {
  try {
    const season = new Date().getFullYear();
    const data = await ergastGet(`/${season}`, 60 * 60 * 1000);
    const races = data?.MRData?.RaceTable?.Races || [];
    const now = new Date();
    const next = races.find(r => new Date(r.date + 'T' + (r.time || '12:00:00Z')) > now);
    res.json({ MRData: { RaceTable: { Races: next ? [next] : [] } } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP — TheSportsDB league 4399
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/motogp/calendar', async (req, res) => {
  try {
    const [next, past] = await Promise.all([
      sdbGet('/eventsnextleague.php?id=4399', 60 * 60 * 1000),
      sdbGet('/eventspastleague.php?id=4399', 60 * 60 * 1000),
    ]);
    res.json({
      next: next?.events || [],
      past: past?.events || [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/motogp/table', async (req, res) => {
  try {
    const season = req.query.season || new Date().getFullYear().toString();
    const data = await sdbGet(`/lookuptable.php?l=4399&s=${season}`, 60 * 60 * 1000);
    // TheSportsDB restituisce { table: [...] } o null
    res.json({ table: data?.table || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy attivo sulla porta ${PORT}`));
