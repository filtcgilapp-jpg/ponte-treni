const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
function getC(k) {
  const e = cache.get(k);
  if (!e || Date.now() > e.exp) { cache.delete(k); return null; }
  return e.data;
}
function setC(k, data, ms) { cache.set(k, { data, exp: Date.now() + ms }); }

async function get(url, ttl = 300000, headers = {}) {
  const c = getC(url); if (c) return c;
  const r = await axios.get(url, { timeout: 20000, headers });
  setC(url, r.data, ttl);
  return r.data;
}

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const ESPN   = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_W = 'https://site.web.api.espn.com/apis/v2/sports';
const VT     = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_H   = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.viaggiatreno.it/', 'Origin': 'https://www.viaggiatreno.it' };
const SDB    = 'https://www.thesportsdb.com/api/v1/json/123';

// ESPN league codes
const ESPN_SOCCER = { 'ita.1':'Serie A','esp.1':'La Liga','eng.1':'Premier League','ger.1':'Bundesliga','fra.1':'Ligue 1','uefa.champions':'Champions League','ita.coppa_italia':'Coppa Italia' };
const ESPN_BBALL  = { 'nba':'NBA','ita.lba':'Serie A Basket','esp.1':'Liga ACB','euroleague':'EuroLeague' };

async function sdb(path, ttl = 600000) {
  const c = getC(path); if (c) return c;
  const r = await axios.get(`${SDB}${path}`, { timeout: 20000 });
  setC(path, r.data, ttl);
  return r.data;
}

async function ergast(path, ttl = 3600000) {
  const k = `erg:${path}`; const c = getC(k); if (c) return c;
  const r = await axios.get(`https://api.jolpi.ca/ergast/f1${path}.json`, { timeout: 15000 });
  setC(k, r.data, ttl);
  return r.data;
}

// ── HEALTH ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('OK ' + new Date().toISOString()));

app.get('/img', async (req, res) => {
  try {
    const r = await axios.get(req.query.url, { responseType: 'arraybuffer', timeout: 10000 });
    res.set('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(r.data);
  } catch { res.status(404).send('Not found'); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TRENI
// ══════════════════════════════════════════════════════════════════════════════
app.get('/treno/:numero', async (req, res) => {
  try {
    const n = req.params.numero;
    const a = await axios.get(`${VT}/cercaNumeroTrenoTrenoAutocomplete/${n}`, { headers: VT_H, timeout: 12000, responseType: 'text' });
    const b1 = (a.data || '').toString().trim();
    if (!b1 || !b1.includes('|')) return res.status(404).json({ error: `Treno ${n} non trovato.` });
    const parts = b1.split('\n')[0].split('|')[1].trim().split('-');
    if (parts.length < 2) return res.status(404).json({ error: 'Formato non riconosciuto.' });
    const r2 = await axios.get(`${VT}/andamentoTreno/${parts[1]}/${parts[0]}/${parts[2] || Date.now()}`, { headers: VT_H, timeout: 12000, responseType: 'text' });
    const b2 = (r2.data || '').toString().trim();
    if (!b2 || b2.startsWith('<')) return res.status(404).json({ error: 'Dati non disponibili.' });
    let p; try { p = JSON.parse(b2); } catch { return res.status(404).json({ error: `Treno ${n} non attivo.` }); }
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CALCIO — ESPN
// ══════════════════════════════════════════════════════════════════════════════

// Cerca squadra su ESPN: cerca in tutte le leghe italiane+europee
app.get('/sport/soccer/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    const leagues = Object.keys(ESPN_SOCCER);
    const results = [];
    await Promise.all(leagues.map(async (lg) => {
      try {
        const d = await get(`${ESPN}/soccer/${lg}/teams`, 86400000);
        const teams = d?.sports?.[0]?.leagues?.[0]?.teams || [];
        for (const t of teams) {
          const team = t.team;
          if (team.displayName.toLowerCase().includes(q) || team.shortDisplayName?.toLowerCase().includes(q)) {
            results.push({ id: team.id, name: team.displayName, league: ESPN_SOCCER[lg], leagueSlug: lg, logo: team.logos?.[0]?.href });
          }
        }
      } catch {}
    }));
    res.json({ teams: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tutte le partite (passate+future) di una squadra in TUTTE le competizioni
app.get('/sport/soccer/team/:id/schedule', async (req, res) => {
  try {
    const id = req.params.id;
    const [past, future] = await Promise.all([
      get(`${ESPN}/soccer/all/teams/${id}/schedule`, 1800000).catch(() => null),
      get(`${ESPN}/soccer/all/teams/${id}/schedule?fixture=true`, 1800000).catch(() => null),
    ]);
    const evPast   = past?.events   || [];
    const evFuture = future?.events || [];
    // Rimuovi duplicati (stesso id)
    const seen = new Set();
    const all = [...evPast, ...evFuture].filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    res.json({ events: all });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Live + scoreboard di oggi
app.get('/sport/soccer/:league/live', async (req, res) => {
  try {
    const d = await get(`${ESPN}/soccer/${req.params.league}/scoreboard`, 30000);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Classifica lega
app.get('/sport/soccer/:league/standings', async (req, res) => {
  try {
    const d = await get(`${ESPN_W}/soccer/${req.params.league}/standings?season=${new Date().getFullYear()}`, 3600000);
    res.json(d);
  } catch (e) {
    try {
      const d2 = await get(`${ESPN}/soccer/${req.params.league}/standings`, 3600000);
      res.json(d2);
    } catch (e2) { res.status(500).json({ error: e2.message }); }
  }
});

// Rosa squadra (ESPN non ha roster per soccer, usa TheSportsDB come fallback)
app.get('/sport/soccer/team/:espnId/roster', async (req, res) => {
  try {
    // Cerca l'ID TheSportsDB tramite nome
    const name = req.query.name || '';
    if (!name) return res.json({ player: [] });
    const d = await sdb(`/searchteams.php?t=${encodeURIComponent(name)}`, 3600000);
    const teams = (d?.teams || []).filter(t => (t.strSport || '').toLowerCase().includes('soccer') || (t.strSport || '').toLowerCase().includes('football'));
    if (!teams.length) return res.json({ player: [] });
    const p = await sdb(`/lookup_all_players.php?id=${teams[0].idTeam}`, 86400000);
    res.json({ player: p?.player || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Leghe di una squadra (da ESPN schedule)
app.get('/sport/soccer/team/:id/leagues', async (req, res) => {
  try {
    const id = req.params.id;
    const d = await get(`${ESPN}/soccer/all/teams/${id}/schedule`, 3600000).catch(() => null);
    const events = d?.events || [];
    const map = new Map();
    for (const e of events) {
      const slug = e.league?.slug || e.league?.abbreviation || '';
      const name = e.league?.name || e.league?.shortName || '';
      if (slug && name && !map.has(slug)) map.set(slug, { slug, name });
    }
    res.json({ leagues: [...map.values()] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// BASKET — ESPN
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/basketball/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    const leagues = Object.keys(ESPN_BBALL);
    const results = [];
    await Promise.all(leagues.map(async (lg) => {
      try {
        const sport = lg === 'nba' || lg === 'ita.lba' || lg === 'esp.1' || lg === 'euroleague' ? 'basketball' : 'basketball';
        const d = await get(`${ESPN}/${sport}/${lg}/teams`, 86400000);
        const teams = d?.sports?.[0]?.leagues?.[0]?.teams || [];
        for (const t of teams) {
          const team = t.team;
          if (team.displayName.toLowerCase().includes(q)) {
            results.push({ id: team.id, name: team.displayName, league: ESPN_BBALL[lg], leagueSlug: lg });
          }
        }
      } catch {}
    }));
    res.json({ teams: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/basketball/team/:league/:id/schedule', async (req, res) => {
  try {
    const { league, id } = req.params;
    const [past, future] = await Promise.all([
      get(`${ESPN}/basketball/${league}/teams/${id}/schedule`, 1800000).catch(() => null),
      get(`${ESPN}/basketball/${league}/teams/${id}/schedule?season=${new Date().getFullYear()}`, 1800000).catch(() => null),
    ]);
    const seen = new Set();
    const all = [...(past?.events || []), ...(future?.events || [])].filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    res.json({ events: all });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/basketball/:league/standings', async (req, res) => {
  try {
    const d = await get(`${ESPN}/basketball/${req.params.league}/standings`, 3600000);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/basketball/:league/live', async (req, res) => {
  try {
    const d = await get(`${ESPN}/basketball/${req.params.league}/scoreboard`, 30000);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TENNIS — TheSportsDB (ESPN non ha tennis)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/tennis/search', async (req, res) => {
  try {
    const d = await sdb(`/searchplayers.php?p=${encodeURIComponent(req.query.q || '')}`, 900000);
    const players = ((d?.player || [])).filter(p => (p.strSport || '').toLowerCase() === 'tennis');
    res.json({ players });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/tennis/player/:id/events', async (req, res) => {
  try {
    const id = req.params.id;
    const [last, next] = await Promise.all([
      sdb(`/eventslast.php?id=${id}`, 1800000).catch(() => null),
      sdb(`/eventsnext.php?id=${id}`, 1800000).catch(() => null),
    ]);
    const toArr = d => { const v = d?.results || d?.events || []; return Array.isArray(v) ? v : []; };
    res.json({ past: toArr(last), upcoming: toArr(next) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/tennis/player/:id/info', async (req, res) => {
  try {
    const d = await sdb(`/lookupplayer.php?id=${req.params.id}`, 86400000);
    res.json({ player: d?.players?.[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/tennis/ranking/:type', async (req, res) => {
  try {
    const lid = req.params.type === 'wta' ? '4290' : '4289';
    const y = new Date().getFullYear();
    for (const s of [`${y}`, `${y-1}`]) {
      try {
        const d = await sdb(`/lookuptable.php?l=${lid}&s=${s}`, 86400000);
        if (d?.table?.length > 0) return res.json({ ranking: d.table });
      } catch {}
    }
    res.json({ ranking: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F1 — Ergast via jolpi.ca
// ══════════════════════════════════════════════════════════════════════════════
const F1Y = new Date().getFullYear();

app.get('/sport/f1/calendar', async (req, res) => {
  try { res.json(await ergast(`/${F1Y}`)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/f1/drivers', async (req, res) => {
  try {
    for (const y of [F1Y, F1Y - 1]) {
      const d = await ergast(`/${y}/driverStandings`).catch(() => null);
      const lists = d?.MRData?.StandingsTable?.StandingsLists;
      if (lists?.[0]?.DriverStandings?.length > 0) return res.json(d);
    }
    res.status(500).json({ error: 'Non disponibile' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/f1/constructors', async (req, res) => {
  try {
    for (const y of [F1Y, F1Y - 1]) {
      const d = await ergast(`/${y}/constructorStandings`).catch(() => null);
      const lists = d?.MRData?.StandingsTable?.StandingsLists;
      if (lists?.[0]?.ConstructorStandings?.length > 0) return res.json(d);
    }
    res.status(500).json({ error: 'Non disponibile' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/f1/last', async (req, res) => {
  try { res.json(await ergast('/current/last/results', 3600000)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP — TheSportsDB
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/motogp/calendar', async (req, res) => {
  try {
    const [p, n] = await Promise.all([
      sdb('/eventspastleague.php?id=4399', 3600000),
      sdb('/eventsnextleague.php?id=4399', 3600000),
    ]);
    const isMoto = e => (e.strLeague || '').toLowerCase().includes('moto');
    res.json({ past: (p?.events || []).filter(isMoto), upcoming: (n?.events || []).filter(isMoto) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/motogp/table', async (req, res) => {
  try {
    const y = new Date().getFullYear();
    for (const s of [`${y}`, `${y-1}`]) {
      const d = await sdb(`/lookuptable.php?l=4399&s=${s}`, 3600000).catch(() => null);
      if (d?.table?.length > 0) return res.json({ table: d.table });
    }
    res.json({ table: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy porta ${PORT}`));
