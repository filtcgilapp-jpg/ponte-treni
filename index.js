const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());

// ── CONFIG ────────────────────────────────────────────────────────────────────
const VT = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.viaggiatreno.it/',
  'Origin': 'https://www.viaggiatreno.it',
};
const SDB = 'https://www.thesportsdb.com/api/v1/json/123';

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
function getC(k) {
  const e = cache.get(k);
  if (!e || Date.now() > e.exp) { cache.delete(k); return null; }
  return e.data;
}
function setC(k, data, ms) { cache.set(k, { data, exp: Date.now() + ms }); }

async function sdb(path, ttl = 600000) {
  const c = getC(path); if (c) return c;
  const r = await axios.get(`${SDB}${path}`, { timeout: 20000 });
  setC(path, r.data, ttl);
  return r.data;
}

// Ergast — prova jolpi.ca con fallback ergast.com mirror
async function ergast(path, ttl = 3600000) {
  const k = `erg:${path}`; const c = getC(k); if (c) return c;
  // Prova entrambi i mirror
  const urls = [
    `https://api.jolpi.ca/ergast/f1${path}.json`,
    `https://ergast.com/api/f1${path}.json`,
  ];
  let lastErr;
  for (const url of urls) {
    try {
      console.log(`[ERGAST] ${url}`);
      const r = await axios.get(url, { timeout: 15000 });
      if (r.data?.MRData) {
        setC(k, r.data, ttl);
        return r.data;
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Ergast non disponibile');
}

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('OK ' + new Date().toISOString()));

// ── PROXY IMMAGINI ─────────────────────────────────────────────────────────────
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
    const line = b1.split('\n')[0];
    const pipe = line.indexOf('|');
    const parts = line.substring(pipe + 1).trim().split('-');
    if (parts.length < 2) return res.status(404).json({ error: 'Formato non riconosciuto.' });
    const ts = parts[2] || Date.now().toString();
    const r2 = await axios.get(`${VT}/andamentoTreno/${parts[1]}/${parts[0]}/${ts}`, { headers: VT_H, timeout: 12000, responseType: 'text' });
    const b2 = (r2.data || '').toString().trim();
    if (!b2 || b2.startsWith('<')) return res.status(404).json({ error: `Dati non disponibili.` });
    let p; try { p = JSON.parse(b2); } catch { return res.status(404).json({ error: `Treno ${n} non attivo.` }); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return res.status(404).json({ error: `Dati non validi.` });
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RICERCA
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/search/team', async (req, res) => {
  try { res.json(await sdb(`/searchteams.php?t=${encodeURIComponent(req.query.q || '')}`, 900000)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/sport/search/player', async (req, res) => {
  try { res.json(await sdb(`/searchplayers.php?p=${encodeURIComponent(req.query.q || '')}`, 900000)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MAPPING CORRETTIVO — TheSportsDB ha bug su alcune squadre italiane
// ══════════════════════════════════════════════════════════════════════════════
const LEAGUE_FIX = {
  '133604': [ // Juventus
    { idLeague: '4335', strLeague: 'Italian Serie A' },
    { idLeague: '4480', strLeague: 'UEFA Champions League' },
    { idLeague: '4336', strLeague: 'Coppa Italia' },
  ],
  '134793': [ // Inter Milan
    { idLeague: '4335', strLeague: 'Italian Serie A' },
    { idLeague: '4480', strLeague: 'UEFA Champions League' },
  ],
  '133613': [ // AC Milan
    { idLeague: '4335', strLeague: 'Italian Serie A' },
    { idLeague: '4480', strLeague: 'UEFA Champions League' },
  ],
  '133618': [ // Roma
    { idLeague: '4335', strLeague: 'Italian Serie A' },
    { idLeague: '4480', strLeague: 'UEFA Europa League' },
  ],
  '133616': [ // Napoli
    { idLeague: '4335', strLeague: 'Italian Serie A' },
    { idLeague: '4480', strLeague: 'UEFA Champions League' },
  ],
};

// ══════════════════════════════════════════════════════════════════════════════
// SQUADRA
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/team/:id', async (req, res) => {
  try { res.json(await sdb(`/lookupteam.php?id=${req.params.id}`, 86400000)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Partite stagione — prova formato calcistico e singolo anno
app.get('/sport/team/:id/season', async (req, res) => {
  try {
    const id = req.params.id;
    const y = new Date().getFullYear();
    const seasons = [`${y-1}-${y}`, `${y}-${y+1}`, `${y}`, `${y-1}`, `${y-2}-${y-1}`];
    let best = null;
    for (const s of seasons) {
      try {
        const d = await sdb(`/eventsseason.php?id=${id}&s=${s}`, 7200000);
        const evs = Array.isArray(d?.events) ? d.events : [];
        if (evs.length > (best?.length || 0)) {
          best = evs;
          if (evs.length > 15) break;
        }
      } catch {}
    }
    res.json({ events: best || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ultime 5 partite già giocate
app.get('/sport/team/:id/last', async (req, res) => {
  try {
    const d = await sdb(`/eventslast.php?id=${req.params.id}`, 1800000);
    res.json({ events: d?.results || d?.events || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Prossime 5 partite
app.get('/sport/team/:id/next', async (req, res) => {
  try {
    const d = await sdb(`/eventsnext.php?id=${req.params.id}`, 1800000);
    res.json({ events: d?.events || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rosa completa
app.get('/sport/team/:id/players', async (req, res) => {
  try {
    const d = await sdb(`/lookup_all_players.php?id=${req.params.id}`, 86400000);
    res.json(d || { player: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Leghe della squadra — usa override se disponibile, altrimenti estrae dagli eventi
app.get('/sport/team/:id/leagues', async (req, res) => {
  try {
    const id = req.params.id;
    if (LEAGUE_FIX[id]) return res.json({ leagues: LEAGUE_FIX[id] });

    const y = new Date().getFullYear();
    const seasons = [`${y-1}-${y}`, `${y}-${y+1}`, `${y}`, `${y-1}`];
    let events = [];
    for (const s of seasons) {
      try {
        const d = await sdb(`/eventsseason.php?id=${id}&s=${s}`, 7200000);
        if (Array.isArray(d?.events) && d.events.length > 0) { events = d.events; break; }
      } catch {}
    }
    // Aggiungi anche ultimi/prossimi per estrarre più leghe
    try { const l = await sdb(`/eventslast.php?id=${id}`, 1800000); events = [...events, ...(l?.results || l?.events || [])]; } catch {}
    try { const n = await sdb(`/eventsnext.php?id=${id}`, 1800000); events = [...events, ...(n?.events || [])]; } catch {}

    const map = new Map();
    for (const e of events) {
      if (e.idLeague && e.strLeague && !map.has(e.idLeague)) {
        map.set(e.idLeague, { idLeague: e.idLeague, strLeague: e.strLeague });
      }
    }

    if (map.size === 0) {
      // Fallback: leggi da lookupteam
      const td = await sdb(`/lookupteam.php?id=${id}`, 86400000);
      const team = td?.teams?.[0];
      if (team) {
        for (let i = 1; i <= 7; i++) {
          const k = i === 1 ? '' : String(i);
          const lid = team[`idLeague${k}`]; const ln = team[`strLeague${k}`];
          if (lid && ln) map.set(lid, { idLeague: lid, strLeague: ln });
        }
      }
    }
    res.json({ leagues: [...map.values()] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CLASSIFICHE
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/league/:id/table', async (req, res) => {
  try {
    const id = req.params.id;
    const y = new Date().getFullYear();
    const seasons = [`${y-1}-${y}`, `${y}`, `${y}-${y+1}`, `${y-2}-${y-1}`];
    for (const s of seasons) {
      try {
        const d = await sdb(`/lookuptable.php?l=${id}&s=${s}`, 3600000);
        if (d?.table?.length > 0) return res.json(d);
      } catch {}
    }
    res.json({ table: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/league/:id/last', async (req, res) => {
  try { res.json(await sdb(`/eventspastleague.php?id=${req.params.id}`, 1800000)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/sport/league/:id/next', async (req, res) => {
  try { res.json(await sdb(`/eventsnextleague.php?id=${req.params.id}`, 1800000)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GIOCATORE
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/player/:id', async (req, res) => {
  try { res.json(await sdb(`/lookupplayer.php?id=${req.params.id}`, 86400000)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/player/:id/last', async (req, res) => {
  try {
    const d = await sdb(`/eventslast.php?id=${req.params.id}`, 1800000);
    const ev = d?.results || d?.events || d?.event || [];
    res.json({ events: Array.isArray(ev) ? ev : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/player/:id/next', async (req, res) => {
  try {
    const d = await sdb(`/eventsnext.php?id=${req.params.id}`, 1800000);
    const ev = d?.events || d?.results || [];
    res.json({ events: Array.isArray(ev) ? ev : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/player/:id/season', async (req, res) => {
  try {
    const id = req.params.id;
    const y = new Date().getFullYear();
    for (const s of [`${y}`, `${y-1}-${y}`, `${y}-${y+1}`]) {
      try {
        const d = await sdb(`/eventsseason.php?id=${id}&s=${s}`, 7200000);
        if (Array.isArray(d?.events) && d.events.length > 0) return res.json({ events: d.events });
      } catch {}
    }
    res.json({ events: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TENNIS RANKING
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/tennis/ranking/:type', async (req, res) => {
  try {
    const lid = req.params.type === 'wta' ? '4290' : '4289';
    const y = new Date().getFullYear();
    for (const s of [`${y}`, `${y-1}`, `${y-1}-${y}`]) {
      try {
        const d = await sdb(`/lookuptable.php?l=${lid}&s=${s}`, 86400000);
        if (d?.table?.length > 0) return res.json({ ranking: d.table });
      } catch {}
    }
    res.json({ ranking: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F1 — Ergast
// ══════════════════════════════════════════════════════════════════════════════
const F1_YEAR = new Date().getFullYear();

app.get('/sport/f1/calendar', async (req, res) => {
  try { res.json(await ergast(`/${F1_YEAR}`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/f1/drivers', async (req, res) => {
  try {
    // Prova stagione corrente, se vuota usa quella precedente
    for (const y of [F1_YEAR, F1_YEAR - 1]) {
      try {
        const d = await ergast(`/${y}/driverStandings`);
        const lists = d?.MRData?.StandingsTable?.StandingsLists;
        if (lists?.length > 0 && lists[0].DriverStandings?.length > 0) return res.json(d);
      } catch {}
    }
    res.status(500).json({ error: 'Classifica piloti non disponibile' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/f1/constructors', async (req, res) => {
  try {
    for (const y of [F1_YEAR, F1_YEAR - 1]) {
      try {
        const d = await ergast(`/${y}/constructorStandings`);
        const lists = d?.MRData?.StandingsTable?.StandingsLists;
        if (lists?.length > 0 && lists[0].ConstructorStandings?.length > 0) return res.json(d);
      } catch {}
    }
    res.status(500).json({ error: 'Classifica costruttori non disponibile' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/f1/last', async (req, res) => {
  try { res.json(await ergast('/current/last/results', 3600000)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/motogp/calendar', async (req, res) => {
  try {
    const [past, next] = await Promise.all([
      sdb('/eventspastleague.php?id=4399', 3600000),
      sdb('/eventsnextleague.php?id=4399', 3600000),
    ]);
    const isMoto = e => {
      const l = (e.strLeague || '').toLowerCase();
      return l.includes('moto') || l.includes('grand prix') || l.includes(' gp');
    };
    res.json({
      past: (past?.events || []).filter(isMoto),
      next: (next?.events || []).filter(isMoto),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/sport/motogp/table', async (req, res) => {
  try {
    const y = new Date().getFullYear();
    for (const s of [`${y}`, `${y-1}`, `${y}-${y+1}`]) {
      try {
        const d = await sdb(`/lookuptable.php?l=4399&s=${s}`, 3600000);
        if (d?.table?.length > 0) return res.json({ table: d.table });
      } catch {}
    }
    res.json({ table: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Proxy porta ${PORT}`));
