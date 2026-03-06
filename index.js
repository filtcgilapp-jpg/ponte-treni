const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
function getC(k) { const e = cache.get(k); if (!e || Date.now() > e.exp) { cache.delete(k); return null; } return e.data; }
function setC(k, v, ms) { cache.set(k, { data: v, exp: Date.now() + ms }); }
async function fetch(url, ttl = 300000) {
  const c = getC(url); if (c) return c;
  const r = await axios.get(url, { timeout: 20000 });
  setC(url, r.data, ttl); return r.data;
}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const VT   = 'https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_H = { 'User-Agent':'Mozilla/5.0','Referer':'https://www.viaggiatreno.it/','Origin':'https://www.viaggiatreno.it' };
const SDB  = 'https://www.thesportsdb.com/api/v1/json/123';

async function sdb(path, ttl=600000) {
  const c = getC(path); if (c) return c;
  const r = await axios.get(`${SDB}${path}`, { timeout:20000 });
  setC(path, r.data, ttl); return r.data;
}
async function ergast(path, ttl=3600000) {
  const k=`erg:${path}`; const c=getC(k); if (c) return c;
  const r = await axios.get(`https://api.jolpi.ca/ergast/f1${path}.json`, { timeout:15000 });
  setC(k, r.data, ttl); return r.data;
}

// Leghe calcio ESPN con slug esatto per standings
const SOCCER_LEAGUES = [
  { slug:'ita.1',            name:'Serie A' },
  { slug:'uefa.champions',   name:'Champions League' },
  { slug:'esp.1',            name:'La Liga' },
  { slug:'eng.1',            name:'Premier League' },
  { slug:'ger.1',            name:'Bundesliga' },
  { slug:'fra.1',            name:'Ligue 1' },
  { slug:'ita.coppa_italia', name:'Coppa Italia' },
  { slug:'uefa.europa',      name:'Europa League' },
];

// ─── NORMALIZZA EVENTO ESPN ────────────────────────────────────────────────────
// ESPN /scoreboard e /teams/:id/events restituiscono struttura completa
// ESPN /teams/:id/schedule può restituire $ref — usiamo scoreboard/events
function normEvent(e) {
  try {
    const comp = (e.competitions||[])[0]||{};
    const comps = comp.competitors||[];
    let home={}, away={};
    for (const c of comps) { if(c.homeAway==='home') home=c; else away=c; }
    const st = comp.status?.type||{};
    return {
      id:         String(e.id||''),
      date:       e.date||'',
      league:     e.league?.name || e.season?.type?.name || '',
      leagueSlug: e.league?.slug||'',
      homeName:   home.team?.shortDisplayName||home.team?.displayName||'',
      awayName:   away.team?.shortDisplayName||away.team?.displayName||'',
      homeScore:  home.score!=null ? String(home.score) : '',
      awayScore:  away.score!=null ? String(away.score) : '',
      homeId:     String(home.team?.id||''),
      awayId:     String(away.team?.id||''),
      completed:  !!st.completed,
      live:       st.name==='STATUS_IN_PROGRESS',
      clock:      comp.status?.displayClock||'',
    };
  } catch { return null; }
}

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req,res) => res.send('OK '+new Date().toISOString()));
app.get('/img', async (req,res) => {
  try {
    const r = await axios.get(req.query.url, { responseType:'arraybuffer', timeout:10000 });
    res.set('Content-Type', r.headers['content-type']||'image/jpeg');
    res.set('Cache-Control','public,max-age=86400');
    res.send(r.data);
  } catch { res.status(404).send('Not found'); }
});

// ── OG ────────────────────────────────────────────────────────────────────────
app.get('/og', async (req,res) => {
  const url=req.query.url; if (!url) return res.status(400).json({error:'Missing url'});
  const ck=`og:${url}`; const cached=getC(ck); if (cached) return res.json(cached);
  try {
    const r = await axios.get(url,{timeout:10000,headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1)','Accept':'text/html'},maxRedirects:5});
    const html=r.data;
    const getMeta=(prop)=>{
      for (const p of [new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`,'i'),new RegExp(`<meta[^>]*name=["']${prop}["'][^>]*content=["']([^"']+)["']`,'i')]) {
        const m=html.match(p); if(m) return m[1].replace(/&amp;/g,'&').replace(/&#039;/g,"'").trim();
      } return null;
    };
    const titleM=html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const result={title:getMeta('title')||(titleM?titleM[1].trim():null),description:getMeta('description'),image:getMeta('image'),url:getMeta('url')||url};
    setC(ck,result,86400000); res.json(result);
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ── NEWS ──────────────────────────────────────────────────────────────────────
app.get('/news', async (req,res) => {
  let query=req.query.q||'';
  if (!query&&req.query.tags) query=req.query.tags.split(',').map(t=>t.trim()).filter(Boolean).join(' OR ');
  if (!query) return res.status(400).json({error:'Missing q or tags'});
  const ck=`news:${query}`; const cached=getC(ck); if (cached) return res.json(cached);
  try {
    const r=await axios.get(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=it&gl=IT&ceid=IT:it`,{timeout:12000,headers:{'User-Agent':'Mozilla/5.0 (compatible; RSS reader)'}});
    const xml=r.data; const items=[];
    const itemRx=/<item>([\s\S]*?)<\/item>/g; let m;
    while((m=itemRx.exec(xml))!==null&&items.length<20){
      const b=m[1];
      const getTag=(tag)=>{const x=b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,'i'));return x?x[1].replace(/<[^>]+>/g,'').trim():null;};
      const linkM=b.match(/<link>(.*?)<\/link>/i);
      const imgM=b.match(/url="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i)||b.match(/<media:content[^>]+url="([^"]+)"/i);
      const rawTitle=getTag('title')||''; const srcM=rawTitle.match(/^(.*?)\s+-\s+([^-]+)$/);
      items.push({title:srcM?srcM[1].trim():rawTitle,source:srcM?srcM[2].trim():(getTag('source')||''),description:(getTag('description')||'').replace(/&lt;.*?&gt;/g,'').substring(0,200),url:linkM?linkM[1]:null,image:imgM?imgM[1]:null,pubDate:getTag('pubDate')?new Date(getTag('pubDate')).toISOString():new Date().toISOString()});
    }
    const result={query,items,fetchedAt:new Date().toISOString()};
    setC(ck,result,1800000); res.json(result);
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ── TRENI ─────────────────────────────────────────────────────────────────────
app.get('/treno/:numero', async (req,res) => {
  try {
    const n=req.params.numero;
    const a=await axios.get(`${VT}/cercaNumeroTrenoTrenoAutocomplete/${n}`,{headers:VT_H,timeout:12000,responseType:'text'});
    const b1=(a.data||'').toString().trim();
    if (!b1||!b1.includes('|')) return res.status(404).json({error:`Treno ${n} non trovato.`});
    const parts=b1.split('\n')[0].split('|')[1].trim().split('-');
    if (parts.length<2) return res.status(404).json({error:'Formato non riconosciuto.'});
    const r2=await axios.get(`${VT}/andamentoTreno/${parts[1]}/${parts[0]}/${parts[2]||Date.now()}`,{headers:VT_H,timeout:12000,responseType:'text'});
    const b2=(r2.data||'').toString().trim();
    if (!b2||b2.startsWith('<')) return res.status(404).json({error:'Dati non disponibili.'});
    let p; try{p=JSON.parse(b2);}catch{return res.status(404).json({error:`Treno ${n} non attivo.`});}
    res.json(p);
  } catch(err) { res.status(500).json({error:err.message}); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CALCIO — ESPN scoreboard per gli eventi (struttura COMPLETA, no $ref)
// ══════════════════════════════════════════════════════════════════════════════

// Cerca squadra — deduplicata per nome
app.get('/sport/soccer/search', async (req,res) => {
  try {
    const q=(req.query.q||'').toLowerCase().trim();
    if (q.length<2) return res.json({teams:[]});
    const seen=new Map();
    await Promise.all(SOCCER_LEAGUES.map(async (lg) => {
      try {
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams`,86400000);
        for (const t of (d?.sports?.[0]?.leagues?.[0]?.teams||[])) {
          const team=t.team;
          const dn=(team.displayName||'').toLowerCase();
          if (!dn.includes(q)&&!(team.shortDisplayName||'').toLowerCase().includes(q)) continue;
          if (!seen.has(dn)) seen.set(dn,{
            id:String(team.id), name:team.displayName,
            shortName:team.shortDisplayName||team.displayName,
            league:lg.name, leagueSlug:lg.slug,
          });
        }
      } catch {}
    }));
    res.json({teams:[...seen.values()]});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Partite squadra — usa ESPN scoreboard per OGNI lega (dati completi, no $ref)
// + fallback su TheSportsDB per le partite
app.get('/sport/soccer/team/:id/events', async (req,res) => {
  try {
    const id=req.params.id;
    const name=req.query.name||'';
    const allEvents=[];
    const seen=new Set();

    // Strategia: per ogni lega ESPN, prendi il scoreboard e filtra per squadra
    // Più affidabile di /teams/:id/schedule che restituisce $ref
    await Promise.all(SOCCER_LEAGUES.map(async (lg) => {
      try {
        // ESPN: /teams/:id/events per una lega specifica — struttura completa
        const url=`${ESPN}/soccer/${lg.slug}/teams/${id}/events`;
        const d=await fetch(url,1800000);
        for (const e of (d?.events||d?.items||[])) {
          const ne=normEvent(e); if(!ne||seen.has(ne.id)) continue;
          if (!ne.league) ne.league=lg.name;
          if (!ne.leagueSlug) ne.leagueSlug=lg.slug;
          seen.add(ne.id); allEvents.push(ne);
        }
      } catch {}
    }));

    // Fallback TheSportsDB se ESPN non restituisce nulla
    if (allEvents.length===0 && name) {
      try {
        const sd=await sdb(`/searchteams.php?t=${encodeURIComponent(name)}`,3600000);
        const teams=(sd?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));
        if (teams.length>0) {
          const tid=teams[0].idTeam;
          const y=new Date().getFullYear();
          for (const s of [`${y-1}-${y}`,`${y}-${y+1}`,`${y}`]) {
            const ev=await sdb(`/eventsseason.php?id=${tid}&s=${s}`,7200000).catch(()=>null);
            if ((ev?.events||[]).length>0) {
              for (const e of ev.events) {
                if (seen.has(e.idEvent)) continue; seen.add(e.idEvent);
                allEvents.push({
                  id:e.idEvent, date:e.dateEvent+'T'+e.strTime,
                  league:e.strLeague||'', leagueSlug:'',
                  homeName:e.strHomeTeam, awayName:e.strAwayTeam,
                  homeScore:e.intHomeScore||'', awayScore:e.intAwayScore||'',
                  homeId:'', awayId:'', completed:!!e.intHomeScore,
                  live:false, clock:'',
                });
              }
              break;
            }
          }
        }
      } catch {}
    }

    // Ordina per data
    allEvents.sort((a,b)=>new Date(a.date)-new Date(b.date));
    res.json({events:allEvents});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Leghe della squadra — ricavate dagli eventi
app.get('/sport/soccer/team/:id/leagues', async (req,res) => {
  try {
    const id=req.params.id;
    const map=new Map();
    await Promise.all(SOCCER_LEAGUES.map(async (lg) => {
      try {
        const url=`${ESPN}/soccer/${lg.slug}/teams/${id}/events`;
        const d=await fetch(url,3600000);
        if ((d?.events||d?.items||[]).length>0) {
          map.set(lg.slug,{slug:lg.slug,name:lg.name});
        }
      } catch {}
    }));
    // Assicura almeno la lega principale (passata come query param)
    const main=req.query.main;
    if (main && !map.has(main)) {
      const found=SOCCER_LEAGUES.find(l=>l.slug===main);
      if (found) map.set(main,{slug:main,name:found.name});
    }
    res.json({leagues:[...map.values()]});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Classifica — prova l'anno corrente e quello precedente
app.get('/sport/soccer/:league/standings', async (req,res) => {
  try {
    const slug=req.params.league;
    const year=new Date().getFullYear();
    for (const y of [year,year-1]) {
      for (const url of [
        `https://site.web.api.espn.com/apis/v2/sports/soccer/${slug}/standings?season=${y}`,
        `${ESPN}/soccer/${slug}/standings`,
      ]) {
        try {
          const d=await fetch(url,3600000);
          let entries=[];
          for (const g of (d.children||[])) { entries.push(...(g.standings?.entries||[])); }
          if (!entries.length) entries=d.standings?.entries||[];
          if (entries.length>0) {
            const rows=entries.map((e,i)=>{
              const stats={}; for(const s of(e.stats||[])){stats[s.name]=s.value;}
              return {
                rank: stats['rank']||i+1,
                name: e.team?.displayName||'', shortName:e.team?.shortDisplayName||e.team?.displayName||'',
                teamId: String(e.team?.id||''),
                played: stats['gamesPlayed']||0, wins:stats['wins']||0,
                draws:stats['ties']||stats['draws']||0, losses:stats['losses']||0,
                points:stats['points']||0, gd:stats['pointDifferential']||0,
              };
            }).sort((a,b)=>(b.points-a.points)||(b.gd-a.gd));
            return res.json({standings:rows});
          }
        } catch {}
      }
    }
    // Fallback TheSportsDB
    const sdbSlugMap={'ita.1':'4335','esp.1':'4332','eng.1':'4328','ger.1':'4331','fra.1':'4334','uefa.champions':'4480'};
    const lid=sdbSlugMap[slug];
    if (lid) {
      const y=new Date().getFullYear();
      for(const s of[`${y-1}-${y}`,`${y}`]){
        const d=await sdb(`/lookuptable.php?l=${lid}&s=${s}`,3600000).catch(()=>null);
        if(d?.table?.length>0){
          return res.json({standings:d.table.map(r=>({rank:+r.intRank,name:r.strTeam,shortName:r.strTeam,teamId:'',played:+r.intPlayed,wins:+r.intWin,draws:+r.intDraw,losses:+r.intLoss,points:+r.intPoints,gd:(+r.intGoalsFor-(+r.intGoalsAgainst))||0}))});
        }
      }
    }
    res.json({standings:[]});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Live scoreboard
app.get('/sport/soccer/:league/live', async (req,res) => {
  try {
    const d=await fetch(`${ESPN}/soccer/${req.params.league}/scoreboard`,30000);
    res.json({events:(d?.events||[]).map(normEvent).filter(Boolean)});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Rosa — TheSportsDB
app.get('/sport/soccer/team/:id/roster', async (req,res) => {
  try {
    const name=req.query.name||''; if(!name) return res.json({player:[]});
    const d=await sdb(`/searchteams.php?t=${encodeURIComponent(name)}`,3600000);
    const teams=(d?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));
    if(!teams.length) return res.json({player:[]});
    const p=await sdb(`/lookup_all_players.php?id=${teams[0].idTeam}`,86400000);
    res.json({player:p?.player||[]});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══════════════════════════════════════════════════════════════════════════════
// BASKET — ESPN
// ══════════════════════════════════════════════════════════════════════════════
const BBALL_LEAGUES=[
  {slug:'nba',name:'NBA'},{slug:'ita.lba',name:'Lega Basket'},{slug:'euroleague',name:'EuroLeague'},
];

app.get('/sport/basketball/search', async (req,res) => {
  try {
    const q=(req.query.q||'').toLowerCase().trim(); if(q.length<2) return res.json({teams:[]});
    const seen=new Map();
    await Promise.all(BBALL_LEAGUES.map(async(lg)=>{
      try {
        const d=await fetch(`${ESPN}/basketball/${lg.slug}/teams`,86400000);
        for(const t of(d?.sports?.[0]?.leagues?.[0]?.teams||[])){
          const team=t.team; const dn=(team.displayName||'').toLowerCase();
          if(!dn.includes(q)) continue;
          if(!seen.has(dn)) seen.set(dn,{id:String(team.id),name:team.displayName,league:lg.name,leagueSlug:lg.slug});
        }
      } catch {}
    }));
    res.json({teams:[...seen.values()]});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/sport/basketball/team/:league/:id/events', async (req,res) => {
  try {
    const{league,id}=req.params;
    const d=await fetch(`${ESPN}/basketball/${league}/teams/${id}/events`,1800000).catch(()=>null);
    res.json({events:(d?.events||d?.items||[]).map(normEvent).filter(Boolean)});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/sport/basketball/:league/standings', async (req,res) => {
  try {
    const d=await fetch(`${ESPN}/basketball/${req.params.league}/standings`,3600000);
    let entries=[];
    for(const g of(d.children||[])){entries.push(...(g.standings?.entries||[]));}
    if(!entries.length) entries=d.standings?.entries||[];
    const rows=entries.map((e,i)=>{
      const stats={}; for(const s of(e.stats||[])){stats[s.name]=s.value;}
      return{rank:i+1,name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||'',teamId:String(e.team?.id||''),wins:stats['wins']||0,losses:stats['losses']||0};
    });
    res.json({standings:rows});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/sport/basketball/:league/live', async (req,res) => {
  try {
    const d=await fetch(`${ESPN}/basketball/${req.params.league}/scoreboard`,30000);
    res.json({events:(d?.events||[]).map(normEvent).filter(Boolean)});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TENNIS — TheSportsDB + ESPN per ranking
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/tennis/search', async (req,res) => {
  try {
    const d=await sdb(`/searchplayers.php?p=${encodeURIComponent(req.query.q||'')}`,900000);
    res.json({players:(d?.player||[]).filter(p=>(p.strSport||'').toLowerCase()==='tennis')});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/sport/tennis/player/:id/events', async (req,res) => {
  try {
    const id=req.params.id;
    const[last,next]=await Promise.all([
      sdb(`/eventslast.php?id=${id}`,1800000).catch(()=>null),
      sdb(`/eventsnext.php?id=${id}`,1800000).catch(()=>null),
    ]);
    const toArr=d=>{const v=d?.results||d?.events||[];return Array.isArray(v)?v:[];};
    res.json({past:toArr(last),upcoming:toArr(next)});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/sport/tennis/player/:id/info', async (req,res) => {
  try {
    const d=await sdb(`/lookupplayer.php?id=${req.params.id}`,86400000);
    res.json({player:d?.players?.[0]||null});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Ranking: prova ESPN tennis, fallback TheSportsDB
app.get('/sport/tennis/ranking/:type', async (req,res) => {
  try {
    const isWTA=req.params.type==='wta';
    // ESPN tennis ranking
    try {
      const espnSlug=isWTA?'wta':'atp';
      const d=await fetch(`${ESPN}/tennis/${espnSlug}/rankings`,3600000);
      const entries=d?.rankings?.[0]?.entries||d?.entries||[];
      if(entries.length>0){
        return res.json({ranking:entries.map((e,i)=>({
          rank:e.currentRanking||e.ranking||i+1,
          name:e.athlete?.displayName||e.player?.displayName||'',
          country:e.athlete?.flag?.alt||'',
          points:e.rankingPoints||e.points||0,
        }))});
      }
    } catch {}
    // Fallback TheSportsDB
    const lid=isWTA?'4290':'4289';
    const y=new Date().getFullYear();
    for(const s of[`${y}`,`${y-1}`]){
      const d=await sdb(`/lookuptable.php?l=${lid}&s=${s}`,86400000).catch(()=>null);
      if(d?.table?.length>0){
        return res.json({ranking:d.table.map(r=>({rank:+r.intRank,name:r.strTeam,country:'',points:+r.intPoints}))});
      }
    }
    res.json({ranking:[]});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F1
// ══════════════════════════════════════════════════════════════════════════════
const F1Y=new Date().getFullYear();
app.get('/sport/f1/calendar', async (req,res) => {
  try{res.json(await ergast(`/${F1Y}`));}catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/drivers', async (req,res) => {
  try{
    for(const y of[F1Y,F1Y-1]){
      const d=await ergast(`/${y}/driverStandings`).catch(()=>null);
      const lists=d?.MRData?.StandingsTable?.StandingsLists;
      if(lists?.[0]?.DriverStandings?.length>0) return res.json(d);
    }
    res.status(500).json({error:'Non disponibile'});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/constructors', async (req,res) => {
  try{
    for(const y of[F1Y,F1Y-1]){
      const d=await ergast(`/${y}/constructorStandings`).catch(()=>null);
      const lists=d?.MRData?.StandingsTable?.StandingsLists;
      if(lists?.[0]?.ConstructorStandings?.length>0) return res.json(d);
    }
    res.status(500).json({error:'Non disponibile'});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/last', async (req,res) => {
  try{res.json(await ergast('/current/last/results',3600000));}catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/motogp/calendar', async (req,res) => {
  try{
    const[p,n]=await Promise.all([
      sdb('/eventspastleague.php?id=4407',3600000),
      sdb('/eventsnextleague.php?id=4407',3600000),
    ]);
    res.json({past:p?.events||[],upcoming:n?.events||[]});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/motogp/table', async (req,res) => {
  try{
    const y=new Date().getFullYear();
    for(const s of[`${y}`,`${y-1}`]){
      const d=await sdb(`/lookuptable.php?l=4407&s=${s}`,3600000).catch(()=>null);
      if(d?.table?.length>0) return res.json({table:d.table});
    }
    res.json({table:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Proxy porta ${PORT}`));
