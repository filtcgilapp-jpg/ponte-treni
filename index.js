const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

// ── CONFIG ────────────────────────────────────────────────────────────────────
const VT = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.viaggiatreno.it/',
  'Origin': 'https://www.viaggiatreno.it',
};
const SDB = 'https://www.thesportsdb.com/api/v1/json/123';

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
async function sdbGet(path, ttlMs = 10 * 60 * 1000) {
  const cached = getCache(path);
  if (cached) return cached;
  const r = await axios.get(`${SDB}${path}`, { timeout: 15000 });
  setCache(path, r.data, ttlMs);
  return r.data;
}

// Ergast via jolpi.ca (ergast.com dismesso)
async function ergastGet(path, ttlMs = 60 * 60 * 1000) {
  const k = `ergast:${path}`;
  const cached = getCache(k);
  if (cached) return cached;
  // Prova prima jolpi.ca, fallback su api.jolpi.ca
  const url = `https://api.jolpi.ca/ergast/f1${path}.json`;
  console.log(`[ERGAST] ${url}`);
  const r = await axios.get(url, { timeout: 15000 });
  setCache(k, r.data, ttlMs);
  return r.data;
}

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Proxy OK - ' + new Date().toISOString()));

// ── PROXY IMMAGINI ────────────────────────────────────────────────────────────
app.get('/img', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  try {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    res.set('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(r.data);
  } catch { res.status(404).send('Not found'); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TRENI
// ══════════════════════════════════════════════════════════════════════════════
app.get('/treno/:numero', async (req, res) => {
  const numero = req.params.numero;
  try {
    const autoRes = await axios.get(
      `${VT}/cercaNumeroTrenoTrenoAutocomplete/${numero}`,
      { headers: VT_HEADERS, timeout: 12000, responseType: 'text' }
    );
    const body1 = (autoRes.data || '').toString().trim();
    if (!body1 || !body1.includes('|'))
      return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    const firstLine = body1.split('\n')[0];
    const pipe = firstLine.indexOf('|');
    if (pipe < 0) return res.status(404).json({ error: `Treno ${numero} non trovato.` });
    const token = firstLine.substring(pipe + 1).trim();
    const parts = token.split('-');
    if (parts.length < 2) return res.status(404).json({ error: 'Formato non riconosciuto.' });
    const ts = parts[2] || Date.now().toString();
    const andRes = await axios.get(
      `${VT}/andamentoTreno/${parts[1]}/${parts[0]}/${ts}`,
      { headers: VT_HEADERS, timeout: 12000, responseType: 'text' }
    );
    const body2 = (andRes.data || '').toString().trim();
    if (!body2 || body2.startsWith('<'))
      return res.status(404).json({ error: `Dati non disponibili per il treno ${numero}.` });
    let parsed;
    try { parsed = JSON.parse(body2); }
    catch { return res.status(404).json({ error: `Treno ${numero} non attivo.` }); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return res.status(404).json({ error: `Dati non validi.` });
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

// Partite stagione corrente — prova 2024-2025 e 2024
app.get('/sport/team/:id/season', async (req, res) => {
  try {
    const id = req.params.id;
    // Calcolo stagione: se siamo dopo luglio, stagione è "YYYY-YYYY+1" o solo "YYYY"
    const now = new Date();
    const year = now.getFullYear();
    // Prova prima stagione calcistica (es. 2024-2025)
    const seasonA = `${year - 1}-${year}`;
    const seasonB = `${year}`;
    const seasonC = `${year}-${year + 1}`;

    let result = null;
    for (const s of [seasonA, seasonC, seasonB]) {
      try {
        const d = await sdbGet(`/eventsseason.php?id=${id}&s=${s}`, 2 * 60 * 60 * 1000);
        if (d?.events && d.events.length > 0) { result = d; break; }
      } catch {}
    }
    res.json(result || { events: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ultime 5 partite
app.get('/sport/team/:id/last', async (req, res) => {
  try { res.json(await sdbGet(`/eventslast.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Prossime 5 partite
app.get('/sport/team/:id/next', async (req, res) => {
  try { res.json(await sdbGet(`/eventsnext.php?id=${req.params.id}`, 30 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Rosa completa
app.get('/sport/team/:id/players', async (req, res) => {
  try { res.json(await sdbGet(`/lookup_all_players.php?id=${req.params.id}`, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Leghe della squadra — legge direttamente da lookupteam
app.get('/sport/team/:id/leagues', async (req, res) => {
  try {
    const data = await sdbGet(`/lookupteam.php?id=${req.params.id}`, 24 * 60 * 60 * 1000);
    const team = data?.teams?.[0];
    if (!team) return res.json({ leagues: [] });
    
    const teamCountry = (team.strCountry || '').toLowerCase();
    const leagues = [];
    
    // TheSportsDB ha fino a 7 campi idLeague/strLeague
    for (let i = 1; i <= 7; i++) {
      const key = i === 1 ? '' : String(i);
      const lid = team[`idLeague${key}`];
      const lname = team[`strLeague${key}`];
      if (lid && lname) leagues.push({ idLeague: lid, strLeague: lname });
    }
    
    // Se la squadra ha un paese, filtra le leghe per evitare leghe di altri paesi
    // (bug TheSportsDB: Juventus ha idLeague=4328 Premier League)
    // Lookup ogni lega per verificare il paese
    const verified = [];
    for (const l of leagues) {
      try {
        const ld = await sdbGet(`/lookupleague.php?id=${l.idLeague}`, 24 * 60 * 60 * 1000);
        const league = ld?.leagues?.[0];
        if (!league) continue;
        const leagueCountry = (league.strCountry || '').toLowerCase();
        const leagueSport = (league.strSport || '').toLowerCase();
        // Includi se stesso sport e (stesso paese OPPURE lega internazionale)
        const isIntl = ['champions', 'europa', 'international', 'world', 'uefa', 'fifa', 'conmebol'].some(k => l.strLeague.toLowerCase().includes(k));
        if (isIntl || !teamCountry || !leagueCountry || leagueCountry === teamCountry) {
          verified.push({ idLeague: l.idLeague, strLeague: l.strLeague });
        }
      } catch {}
    }
    
    res.json({ leagues: verified.length > 0 ? verified : leagues });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// LEGHE
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/league/:id/table', async (req, res) => {
  try {
    const id = req.params.id;
    // Prova stagioni multiple
    const now = new Date();
    const y = now.getFullYear();
    const seasons = [`${y - 1}-${y}`, `${y}`, `${y}-${y + 1}`];
    let result = null;
    for (const s of seasons) {
      try {
        const d = await sdbGet(`/lookuptable.php?l=${id}&s=${s}`, 60 * 60 * 1000);
        if (d?.table && d.table.length > 0) { result = d; break; }
      } catch {}
    }
    res.json(result || { table: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
// GIOCATORE / PILOTA / TENNISTA
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/player/:id', async (req, res) => {
  try { res.json(await sdbGet(`/lookupplayer.php?id=${req.params.id}`, 24 * 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Ultime partite giocatore — TheSportsDB restituisce { results: [...] } o null
app.get('/sport/player/:id/last', async (req, res) => {
  try {
    const d = await sdbGet(`/eventslast.php?id=${req.params.id}`, 30 * 60 * 1000);
    // Normalizza: può essere results, events o null
    const events = d?.results || d?.events || [];
    res.json({ events: Array.isArray(events) ? events : [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Prossime partite giocatore
app.get('/sport/player/:id/next', async (req, res) => {
  try {
    const d = await sdbGet(`/eventsnext.php?id=${req.params.id}`, 30 * 60 * 1000);
    const events = d?.events || d?.results || [];
    res.json({ events: Array.isArray(events) ? events : [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stagione completa giocatore (tennis)
app.get('/sport/player/:id/season', async (req, res) => {
  try {
    const id = req.params.id;
    const now = new Date();
    const y = now.getFullYear();
    let result = null;
    for (const s of [`${y}`, `${y - 1}-${y}`, `${y}-${y + 1}`]) {
      try {
        const d = await sdbGet(`/eventsseason.php?id=${id}&s=${s}`, 2 * 60 * 60 * 1000);
        if (d?.events?.length > 0) { result = d; break; }
      } catch {}
    }
    const events = result?.events || [];
    res.json({ events: Array.isArray(events) ? events : [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TENNIS — ranking ATP/WTA via TheSportsDB
// ══════════════════════════════════════════════════════════════════════════════
// TheSportsDB non ha ranking ATP/WTA live, usiamo la lega ATP (id 4289) e WTA (4290)
app.get('/sport/tennis/ranking/:type', async (req, res) => {
  try {
    const leagueId = req.params.type === 'wta' ? '4290' : '4289';
    const d = await sdbGet(`/lookuptable.php?l=${leagueId}&s=${new Date().getFullYear()}`, 24 * 60 * 60 * 1000);
    res.json({ ranking: d?.table || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F1 — Ergast via api.jolpi.ca
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/f1/calendar', async (req, res) => {
  try { res.json(await ergastGet(`/${new Date().getFullYear()}`)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/drivers', async (req, res) => {
  try { res.json(await ergastGet(`/${new Date().getFullYear()}/driverStandings`)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/constructors', async (req, res) => {
  try { res.json(await ergastGet(`/${new Date().getFullYear()}/constructorStandings`)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/f1/last', async (req, res) => {
  try { res.json(await ergastGet('/current/last/results', 60 * 60 * 1000)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP — TheSportsDB lega 4399
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/motogp/calendar', async (req, res) => {
  try {
    const [past, next] = await Promise.all([
      sdbGet('/eventspastleague.php?id=4399', 60 * 60 * 1000),
      sdbGet('/eventsnextleague.php?id=4399', 60 * 60 * 1000),
    ]);
    // Filtra solo eventi che contengono "Moto" nel nome lega o sport
    const filterMoto = (arr) => (arr || []).filter(e =>
      (e.strLeague || '').toLowerCase().includes('moto') ||
      (e.strSport || '').toLowerCase().includes('moto') ||
      (e.strLeague || '').includes('GP')
    );
    res.json({
      past: filterMoto(past?.events),
      next: filterMoto(next?.events),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sport/motogp/table', async (req, res) => {
  try {
    const y = new Date().getFullYear();
    let result = null;
    for (const s of [`${y}`, `${y - 1}`]) {
      try {
        const d = await sdbGet(`/lookuptable.php?l=4399&s=${s}`, 60 * 60 * 1000);
        if (d?.table?.length > 0) { result = d; break; }
      } catch {}
    }
    res.json({ table: result?.table || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy attivo sulla porta ${PORT}`));
