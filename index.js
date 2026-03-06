const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
function getC(k){const e=cache.get(k);if(!e||Date.now()>e.exp){cache.delete(k);return null;}return e.data;}
function setC(k,v,ms){cache.set(k,{data:v,exp:Date.now()+ms});}
async function fetch(url,ttl=300000){
  const c=getC(url);if(c)return c;
  const r=await axios.get(url,{timeout:20000});
  setC(url,r.data,ttl);return r.data;
}

const ESPN ='https://site.api.espn.com/apis/site/v2/sports';
const ESPN2='https://site.web.api.espn.com/apis/v2/sports';
const VT   ='https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_H ={'User-Agent':'Mozilla/5.0','Referer':'https://www.viaggiatreno.it/','Origin':'https://www.viaggiatreno.it'};
const SDB  ='https://www.thesportsdb.com/api/v1/json/123';

async function sdb(path,ttl=600000){
  const c=getC(path);if(c)return c;
  const r=await axios.get(`${SDB}${path}`,{timeout:20000});
  setC(path,r.data,ttl);return r.data;
}
async function ergast(path,ttl=3600000){
  const k=`erg:${path}`;const c=getC(k);if(c)return c;
  const r=await axios.get(`https://api.jolpi.ca/ergast/f1${path}.json`,{timeout:15000});
  setC(k,r.data,ttl);return r.data;
}

const SOCCER_LEAGUES=[
  {slug:'ita.1',           name:'Serie A'},
  {slug:'uefa.champions',  name:'Champions League'},
  {slug:'esp.1',           name:'La Liga'},
  {slug:'eng.1',           name:'Premier League'},
  {slug:'ger.1',           name:'Bundesliga'},
  {slug:'fra.1',           name:'Ligue 1'},
  {slug:'ita.coppa_italia',name:'Coppa Italia'},
  {slug:'uefa.europa',     name:'Europa League'},
];

// ─── NORMALIZZA EVENTO ESPN ───────────────────────────────────────────────────
// score può essere: numero, stringa, oppure oggetto {value:N} (nel /schedule)
function parseScore(s){
  if(s==null)return '';
  if(typeof s==='object'&&s.value!=null)return String(s.value);
  const n=Number(s);
  if(!isNaN(n))return String(Math.round(n));
  return String(s);
}

function normEvent(e,leagueName,leagueSlug){
  try{
    if(!e||typeof e!=='object'||e.$ref)return null;
    const comp=(e.competitions||[])[0]||{};
    const comps=comp.competitors||[];
    if(comps.length<2)return null;
    let home=null,away=null;
    for(const c of comps){if(c.homeAway==='home')home=c;else away=c;}
    if(!home||!away)return null;
    const hName=home.team?.shortDisplayName||home.team?.displayName||'';
    const aName=away.team?.shortDisplayName||away.team?.displayName||'';
    if(!hName&&!aName)return null;
    const st=comp.status?.type||{};
    const hScore=parseScore(home.score);
    const aScore=parseScore(away.score);
    return{
      id:      String(e.id||''),
      date:    e.date||'',
      league:  leagueName||e.league?.name||e.season?.type?.name||'',
      leagueSlug:leagueSlug||e.league?.slug||'',
      homeName:hName,
      awayName:aName,
      homeScore:hScore,
      awayScore:aScore,
      homeId:  String(home.team?.id||''),
      awayId:  String(away.team?.id||''),
      completed:!!st.completed,
      live:    st.name==='STATUS_IN_PROGRESS',
      clock:   comp.status?.displayClock||'',
    };
  }catch{return null;}
}

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/',(req,res)=>res.send('OK '+new Date().toISOString()));
app.get('/img',async(req,res)=>{
  try{
    const r=await axios.get(req.query.url,{responseType:'arraybuffer',timeout:10000});
    res.set('Content-Type',r.headers['content-type']||'image/jpeg');
    res.set('Cache-Control','public,max-age=86400');
    res.send(r.data);
  }catch{res.status(404).send('Not found');}
});

// ── OG ────────────────────────────────────────────────────────────────────────
app.get('/og',async(req,res)=>{
  const url=req.query.url;if(!url)return res.status(400).json({error:'Missing url'});
  const ck=`og:${url}`;const cached=getC(ck);if(cached)return res.json(cached);
  try{
    const r=await axios.get(url,{timeout:10000,headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1)','Accept':'text/html'},maxRedirects:5});
    const html=r.data;
    const getMeta=(prop)=>{
      for(const p of[new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`,'i'),new RegExp(`<meta[^>]*name=["']${prop}["'][^>]*content=["']([^"']+)["']`,'i')]){
        const m=html.match(p);if(m)return m[1].replace(/&amp;/g,'&').replace(/&#039;/g,"'").trim();
      }return null;
    };
    const titleM=html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const result={title:getMeta('title')||(titleM?titleM[1].trim():null),description:getMeta('description'),image:getMeta('image'),url:getMeta('url')||url};
    setC(ck,result,86400000);res.json(result);
  }catch(err){res.status(500).json({error:err.message});}
});

// ── NEWS ──────────────────────────────────────────────────────────────────────
app.get('/news',async(req,res)=>{
  let query=req.query.q||'';
  if(!query&&req.query.tags)query=req.query.tags.split(',').map(t=>t.trim()).filter(Boolean).join(' OR ');
  if(!query)return res.status(400).json({error:'Missing q or tags'});
  const ck=`news:${query}`;const cached=getC(ck);if(cached)return res.json(cached);
  try{
    const r=await axios.get(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=it&gl=IT&ceid=IT:it`,{timeout:12000,headers:{'User-Agent':'Mozilla/5.0 (compatible; RSS reader)'}});
    const xml=r.data;const items=[];
    const itemRx=/<item>([\s\S]*?)<\/item>/g;let m;
    while((m=itemRx.exec(xml))!==null&&items.length<20){
      const b=m[1];
      const getTag=(tag)=>{const x=b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,'i'));return x?x[1].replace(/<[^>]+>/g,'').trim():null;};
      const linkM=b.match(/<link>(.*?)<\/link>/i);
      const imgM=b.match(/url="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i)||b.match(/<media:content[^>]+url="([^"]+)"/i);
      const rawTitle=getTag('title')||'';const srcM=rawTitle.match(/^(.*?)\s+-\s+([^-]+)$/);
      items.push({title:srcM?srcM[1].trim():rawTitle,source:srcM?srcM[2].trim():(getTag('source')||''),description:(getTag('description')||'').replace(/&lt;.*?&gt;/g,'').substring(0,200),url:linkM?linkM[1]:null,image:imgM?imgM[1]:null,pubDate:getTag('pubDate')?new Date(getTag('pubDate')).toISOString():new Date().toISOString()});
    }
    const result={query,items,fetchedAt:new Date().toISOString()};
    setC(ck,result,1800000);res.json(result);
  }catch(err){res.status(500).json({error:err.message});}
});

// ── TRENI ─────────────────────────────────────────────────────────────────────
app.get('/treno/:numero',async(req,res)=>{
  try{
    const n=req.params.numero;
    const a=await axios.get(`${VT}/cercaNumeroTrenoTrenoAutocomplete/${n}`,{headers:VT_H,timeout:12000,responseType:'text'});
    const b1=(a.data||'').toString().trim();
    if(!b1||!b1.includes('|'))return res.status(404).json({error:`Treno ${n} non trovato.`});
    const parts=b1.split('\n')[0].split('|')[1].trim().split('-');
    if(parts.length<2)return res.status(404).json({error:'Formato non riconosciuto.'});
    const r2=await axios.get(`${VT}/andamentoTreno/${parts[1]}/${parts[0]}/${parts[2]||Date.now()}`,{headers:VT_H,timeout:12000,responseType:'text'});
    const b2=(r2.data||'').toString().trim();
    if(!b2||b2.startsWith('<'))return res.status(404).json({error:'Dati non disponibili.'});
    let p;try{p=JSON.parse(b2);}catch{return res.status(404).json({error:`Treno ${n} non attivo.`});}
    res.json(p);
  }catch(err){res.status(500).json({error:err.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// CALCIO
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/soccer/search',async(req,res)=>{
  try{
    const q=(req.query.q||'').toLowerCase().trim();
    if(q.length<2)return res.json({teams:[]});
    const seen=new Map();
    await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams`,86400000);
        for(const t of(d?.sports?.[0]?.leagues?.[0]?.teams||[])){
          const team=t.team;
          const dn=(team.displayName||'').toLowerCase();
          if(!dn.includes(q)&&!(team.shortDisplayName||'').toLowerCase().includes(q))continue;
          if(!seen.has(dn))seen.set(dn,{
            id:String(team.id),name:team.displayName,
            shortName:team.shortDisplayName||team.displayName,
            league:lg.name,leagueSlug:lg.slug,
          });
        }
      }catch{}
    }));
    res.json({teams:[...seen.values()]});
  }catch(e){res.status(500).json({error:e.message});}
});

// Partite squadra: schedule ESPN (passate+future) + scoreboard corrente
app.get('/sport/soccer/team/:id/events',async(req,res)=>{
  try{
    const id=req.params.id;
    const name=req.query.name||'';
    const allEvents=[];
    const seen=new Set();

    await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{
      // 1) schedule — contiene tutta la stagione passata+futura
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams/${id}/schedule`,3600000);
        for(const e of(d?.events||[])){
          if(!e||e.$ref||typeof e!=='object')continue;
          const ne=normEvent(e,lg.name,lg.slug);
          if(!ne||seen.has(ne.id))continue;
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}

      // 2) scoreboard corrente — sovrascrive con dati live/recenti
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/scoreboard`,60000);
        for(const e of(d?.events||[])){
          const ne=normEvent(e,lg.name,lg.slug);
          if(!ne)continue;
          if(ne.homeId!==id&&ne.awayId!==id)continue;
          if(!seen.has(ne.id)){seen.add(ne.id);allEvents.push(ne);}
          else{
            // aggiorna score con dato live
            const idx=allEvents.findIndex(x=>x.id===ne.id);
            if(idx>=0)allEvents[idx]=ne;
          }
        }
      }catch{}
    }));

    // Fallback TheSportsDB se pochi dati
    if(allEvents.length<3&&name){
      try{
        const sd=await sdb(`/searchteams.php?t=${encodeURIComponent(name)}`,3600000);
        const teams=(sd?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));
        if(teams.length>0){
          const tid=teams[0].idTeam;
          const y=new Date().getFullYear();
          for(const s of[`${y-1}-${y}`,`${y}-${y+1}`,`${y}`]){
            const ev=await sdb(`/eventsseason.php?id=${tid}&s=${s}`,7200000).catch(()=>null);
            if((ev?.events||[]).length>0){
              for(const e of ev.events){
                if(seen.has(String(e.idEvent)))continue;
                seen.add(String(e.idEvent));
                allEvents.push({
                  id:String(e.idEvent),
                  date:(e.dateEvent||'')+'T'+(e.strTime||'00:00:00'),
                  league:e.strLeague||'',leagueSlug:'',
                  homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',
                  homeScore:e.intHomeScore!=null?String(e.intHomeScore):'',
                  awayScore:e.intAwayScore!=null?String(e.intAwayScore):'',
                  homeId:'',awayId:'',
                  completed:e.intHomeScore!=null,live:false,clock:'',
                });
              }
              break;
            }
          }
        }
      }catch{}
    }

    allEvents.sort((a,b)=>new Date(a.date)-new Date(b.date));
    res.json({events:allEvents});
  }catch(e){res.status(500).json({error:e.message});}
});

// Leghe della squadra
app.get('/sport/soccer/team/:id/leagues',async(req,res)=>{
  try{
    const id=req.params.id;
    const map=new Map();
    await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams/${id}/schedule`,3600000);
        if((d?.events||[]).some(e=>e&&!e.$ref))map.set(lg.slug,{slug:lg.slug,name:lg.name});
      }catch{}
    }));
    const main=req.query.main;
    if(main&&!map.has(main)){
      const found=SOCCER_LEAGUES.find(l=>l.slug===main);
      if(found)map.set(main,{slug:main,name:found.name});
    }
    res.json({leagues:[...map.values()]});
  }catch(e){res.status(500).json({error:e.message});}
});

// Classifica — ESPN standings + fallback TheSportsDB
// Le coppe (Coppa Italia, Europa) non hanno classifica a gironi → restituisce []
app.get('/sport/soccer/:league/standings',async(req,res)=>{
  try{
    const slug=req.params.league;
    const year=new Date().getFullYear();

    for(const y of[year,year-1]){
      for(const url of[
        `${ESPN2}/soccer/${slug}/standings?season=${y}`,
        `${ESPN}/soccer/${slug}/standings`,
      ]){
        try{
          const d=await fetch(url,3600000);
          let entries=[];
          for(const g of(d.children||[])){entries.push(...(g.standings?.entries||[]));}
          if(!entries.length)entries=d.standings?.entries||[];
          if(entries.length>0){
            const rows=entries.map((e,i)=>{
              const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
              return{
                rank:   Math.round(stats['rank']||i+1),
                name:   e.team?.displayName||'',
                shortName:e.team?.shortDisplayName||e.team?.displayName||'',
                teamId: String(e.team?.id||''),
                played: Math.round(stats['gamesPlayed']||0),
                wins:   Math.round(stats['wins']||0),
                draws:  Math.round(stats['ties']||stats['draws']||0),
                losses: Math.round(stats['losses']||0),
                points: Math.round(stats['points']||0),
                gd:     Math.round(stats['pointDifferential']||0),
              };
            });
            return res.json({standings:rows});
          }
        }catch{}
      }
    }

    // Fallback TheSportsDB per leghe principali
    const sdbMap={'ita.1':'4335','esp.1':'4332','eng.1':'4328','ger.1':'4331','fra.1':'4334','uefa.champions':'4480'};
    const lid=sdbMap[slug];
    if(lid){
      const y=new Date().getFullYear();
      for(const s of[`${y-1}-${y}`,`${y}`]){
        const d=await sdb(`/lookuptable.php?l=${lid}&s=${s}`,3600000).catch(()=>null);
        if(d?.table?.length>0){
          return res.json({standings:d.table.map(r=>({
            rank:+r.intRank,name:r.strTeam,shortName:r.strTeam,teamId:'',
            played:+r.intPlayed,wins:+r.intWin,draws:+r.intDraw,losses:+r.intLoss,
            points:+r.intPoints,gd:(+r.intGoalsFor)-(+r.intGoalsAgainst),
          }))});
        }
      }
    }
    res.json({standings:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// Fasi/Tabellone coppa — raggruppa eventi per round/fase
// Usato per Coppa Italia, Europa League, Champions League gruppi+eliminazione
app.get('/sport/soccer/:league/phases',async(req,res)=>{
  try{
    const slug=req.params.league;
    const teamId=req.query.teamId||'';
    const year=new Date().getFullYear();
    const allEvents=[];
    const seen=new Set();

    // Prendi schedule della squadra (o scoreboard se no teamId)
    if(teamId){
      try{
        const d=await fetch(`${ESPN}/soccer/${slug}/teams/${teamId}/schedule`,3600000);
        for(const e of(d?.events||[])){
          if(!e||e.$ref)continue;
          const ne=normEvent(e,slug,slug);if(!ne||seen.has(ne.id))continue;
          // Estrai nome fase dal competition
          const comp=(e.competitions||[])[0]||{};
          ne.round=comp.notes?.[0]?.headline||comp.type?.text||e.week?.text||'';
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}
    }

    // Anche scoreboard per eventi recenti/live
    try{
      const d=await fetch(`${ESPN}/soccer/${slug}/scoreboard`,60000);
      for(const e of(d?.events||[])){
        if(!e)continue;
        const ne=normEvent(e,slug,slug);if(!ne)continue;
        if(teamId&&ne.homeId!==teamId&&ne.awayId!==teamId)continue;
        const comp=(e.competitions||[])[0]||{};
        ne.round=comp.notes?.[0]?.headline||comp.type?.text||e.week?.text||'';
        if(!seen.has(ne.id)){seen.add(ne.id);allEvents.push(ne);}
        else{const idx=allEvents.findIndex(x=>x.id===ne.id);if(idx>=0)allEvents[idx]=ne;}
      }
    }catch{}

    allEvents.sort((a,b)=>new Date(a.date)-new Date(b.date));

    // Raggruppa per fase
    const phaseMap=new Map();
    for(const e of allEvents){
      const ph=e.round||'Altro';
      if(!phaseMap.has(ph))phaseMap.set(ph,[]);
      phaseMap.get(ph).push(e);
    }

    // Ordine fasi: Prima gironi, poi eliminazione diretta
    const phaseOrder=['Gruppo','Gironi','Round of 32','Round of 16','Ottavi','Quarti','Semifinal','Finale','Final'];
    const phases=[...phaseMap.entries()]
      .sort((a,b)=>{
        const dateA=new Date(a[1][0]?.date||'2000');
        const dateB=new Date(b[1][0]?.date||'2000');
        return dateA-dateB;
      })
      .map(([name,events])=>({name,events}));

    // Prova anche standings (per gironi Champions/Europa)
    let standings=[];
    try{
      const yr=new Date().getFullYear();
      for(const y of[yr,yr-1]){
        for(const url of[`${ESPN2}/soccer/${slug}/standings?season=${y}`,`${ESPN}/soccer/${slug}/standings`]){
          try{
            const d=await fetch(url,3600000);
            let entries=[];
            for(const g of(d.children||[])){entries.push(...(g.standings?.entries||[]));}
            if(!entries.length)entries=d.standings?.entries||[];
            if(entries.length>0){
              standings=entries.map((e,i)=>{
                const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
                return{rank:Math.round(stats['rank']||i+1),name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||'',teamId:String(e.team?.id||''),played:Math.round(stats['gamesPlayed']||0),wins:Math.round(stats['wins']||0),draws:Math.round(stats['ties']||0),losses:Math.round(stats['losses']||0),points:Math.round(stats['points']||0),gd:Math.round(stats['pointDifferential']||0)};
              });
              break;
            }
          }catch{}
          if(standings.length)break;
        }
        if(standings.length)break;
      }
    }catch{}

    res.json({phases,standings});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/soccer/:league/live',async(req,res)=>{
  try{
    const d=await fetch(`${ESPN}/soccer/${req.params.league}/scoreboard`,30000);
    res.json({events:(d?.events||[]).map(e=>normEvent(e,'',req.params.league)).filter(Boolean)});
  }catch(e){res.status(500).json({error:e.message});}
});

// Rosa — ESPN roster (più completo di TheSportsDB)
app.get('/sport/soccer/team/:id/roster',async(req,res)=>{
  try{
    const id=req.params.id;
    const name=req.query.name||'';

    // Prova ESPN prima — più aggiornato
    try{
      // Cerca in quale lega è la squadra
      for(const lg of SOCCER_LEAGUES){
        try{
          const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams/${id}/roster`,86400000);
          const athletes=d?.athletes||[];
          if(athletes.length>0){
            const players=athletes.flatMap(group=>(group.items||[]).map(p=>({
              idPlayer:String(p.id),
              strPlayer:p.displayName||p.fullName||'',
              strPosition:p.position?.name||p.position?.abbreviation||group.position||'',
              strNationality:p.citizenship||p.birthPlace?.country||'',
              strNumber:p.jersey||'',
              strThumb:p.headshot?.href||'',
            })));
            if(players.length>0)return res.json({player:players});
          }
        }catch{}
      }
    }catch{}

    // Fallback TheSportsDB
    if(name){
      const sd=await sdb(`/searchteams.php?t=${encodeURIComponent(name)}`,3600000);
      const teams=(sd?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));
      if(teams.length>0){
        const p=await sdb(`/lookup_all_players.php?id=${teams[0].idTeam}`,86400000);
        return res.json({player:p?.player||[]});
      }
    }
    res.json({player:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// BASKET
// ══════════════════════════════════════════════════════════════════════════════
const BBALL_LEAGUES=[
  {slug:'nba',name:'NBA'},
  {slug:'ita.lba',name:'Lega Basket'},
  {slug:'euroleague',name:'EuroLeague'},
];

app.get('/sport/basketball/search',async(req,res)=>{
  try{
    const q=(req.query.q||'').toLowerCase().trim();if(q.length<2)return res.json({teams:[]});
    const seen=new Map();
    await Promise.all(BBALL_LEAGUES.map(async(lg)=>{
      try{
        const d=await fetch(`${ESPN}/basketball/${lg.slug}/teams`,86400000);
        for(const t of(d?.sports?.[0]?.leagues?.[0]?.teams||[])){
          const team=t.team;const dn=(team.displayName||'').toLowerCase();
          if(!dn.includes(q))continue;
          if(!seen.has(dn))seen.set(dn,{id:String(team.id),name:team.displayName,league:lg.name,leagueSlug:lg.slug});
        }
      }catch{}
    }));
    res.json({teams:[...seen.values()]});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/basketball/team/:league/:id/events',async(req,res)=>{
  try{
    const{league,id}=req.params;
    const allEvents=[];const seen=new Set();
    // Schedule
    try{
      const d=await fetch(`${ESPN}/basketball/${league}/teams/${id}/schedule`,3600000);
      for(const e of(d?.events||[])){
        if(!e||e.$ref)continue;
        const ne=normEvent(e,league,league);if(!ne||seen.has(ne.id))continue;
        seen.add(ne.id);allEvents.push(ne);
      }
    }catch{}
    // Scoreboard
    try{
      const d=await fetch(`${ESPN}/basketball/${league}/scoreboard`,60000);
      for(const e of(d?.events||[])){
        const ne=normEvent(e,league,league);if(!ne)continue;
        if(ne.homeId!==id&&ne.awayId!==id)continue;
        if(!seen.has(ne.id)){seen.add(ne.id);allEvents.push(ne);}
        else{const idx=allEvents.findIndex(x=>x.id===ne.id);if(idx>=0)allEvents[idx]=ne;}
      }
    }catch{}
    allEvents.sort((a,b)=>new Date(a.date)-new Date(b.date));
    res.json({events:allEvents});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/basketball/:league/standings',async(req,res)=>{
  try{
    const d=await fetch(`${ESPN}/basketball/${req.params.league}/standings`,3600000);
    let entries=[];
    for(const g of(d.children||[])){entries.push(...(g.standings?.entries||[]));}
    if(!entries.length)entries=d.standings?.entries||[];
    const rows=entries.map((e,i)=>{
      const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
      return{rank:i+1,name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||'',teamId:String(e.team?.id||''),wins:Math.round(stats['wins']||0),losses:Math.round(stats['losses']||0)};
    });
    res.json({standings:rows});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/basketball/:league/live',async(req,res)=>{
  try{
    const d=await fetch(`${ESPN}/basketball/${req.params.league}/scoreboard`,30000);
    res.json({events:(d?.events||[]).map(e=>normEvent(e,'',req.params.league)).filter(Boolean)});
  }catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// TENNIS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/tennis/search',async(req,res)=>{
  try{
    const q=req.query.q||'';
    const d=await sdb(`/searchplayers.php?p=${encodeURIComponent(q)}`,900000);
    // TheSportsDB restituisce 'player' non 'players'
    const all=d?.player||d?.players||[];
    res.json({players:all.filter(p=>(p.strSport||'').toLowerCase()==='tennis')});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/tennis/player/:id/events',async(req,res)=>{
  try{
    const id=req.params.id;
    const[last,next]=await Promise.all([
      sdb(`/eventslast.php?id=${id}`,1800000).catch(()=>null),
      sdb(`/eventsnext.php?id=${id}`,1800000).catch(()=>null),
    ]);
    // eventslast → results, eventsnext → events
    const toArr=d=>{
      if(!d)return[];
      const v=d.results||d.events||d.event||[];
      return Array.isArray(v)?v:[];
    };
    res.json({past:toArr(last),upcoming:toArr(next)});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/tennis/player/:id/info',async(req,res)=>{
  try{
    const d=await sdb(`/lookupplayer.php?id=${req.params.id}`,86400000);
    res.json({player:(d?.players||d?.player||[])[0]||null});
  }catch(e){res.status(500).json({error:e.message});}
});

// Ranking ATP/WTA
app.get('/sport/tennis/ranking/:type',async(req,res)=>{
  try{
    const isWTA=req.params.type==='wta';
    const tour=isWTA?'wta':'atp';

    // ESPN web API rankings
    for(const url of[
      `${ESPN2}/tennis/${tour}/rankings`,
      `${ESPN}/tennis/${tour}/rankings`,
    ]){
      try{
        const d=await fetch(url,3600000);
        const entries=d?.rankings?.[0]?.entries||d?.entries||[];
        if(entries.length>0){
          return res.json({ranking:entries.slice(0,100).map((e,i)=>({
            rank:   e.currentRanking||e.ranking||i+1,
            name:   e.athlete?.displayName||e.player?.displayName||e.team?.displayName||'',
            country:e.athlete?.flag?.alt||e.athlete?.country?.abbreviation||'',
            points: e.rankingPoints||e.points||0,
          }))});
        }
      }catch{}
    }

    // Fallback TheSportsDB
    const lid=isWTA?'4290':'4289';
    const y=new Date().getFullYear();
    for(const s of[`${y}`,`${y-1}`]){
      const d=await sdb(`/lookuptable.php?l=${lid}&s=${s}`,86400000).catch(()=>null);
      if(d?.table?.length>0){
        return res.json({ranking:d.table.map(r=>({rank:+r.intRank,name:r.strTeam,country:'',points:+r.intPoints||0}))});
      }
    }
    res.json({ranking:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// F1
// ══════════════════════════════════════════════════════════════════════════════
const F1Y=new Date().getFullYear();
app.get('/sport/f1/calendar',async(req,res)=>{
  try{res.json(await ergast(`/${F1Y}`));}catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/drivers',async(req,res)=>{
  try{
    for(const y of[F1Y,F1Y-1]){
      const d=await ergast(`/${y}/driverStandings`).catch(()=>null);
      if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.length>0)return res.json(d);
    }
    res.status(500).json({error:'Non disponibile'});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/constructors',async(req,res)=>{
  try{
    for(const y of[F1Y,F1Y-1]){
      const d=await ergast(`/${y}/constructorStandings`).catch(()=>null);
      if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings?.length>0)return res.json(d);
    }
    res.status(500).json({error:'Non disponibile'});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/last',async(req,res)=>{
  try{res.json(await ergast('/current/last/results',3600000));}catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/motogp/calendar',async(req,res)=>{
  try{
    // TheSportsDB — lega MotoGP id=4407
    const[p,n]=await Promise.all([
      sdb('/eventspastleague.php?id=4407',1800000).catch(()=>null),
      sdb('/eventsnextleague.php?id=4407',1800000).catch(()=>null),
    ]);
    let past=(p?.events||[]);
    let upcoming=(n?.events||[]);

    // Se TheSportsDB vuoto, prova ESPN MotoGP
    if(past.length+upcoming.length<3){
      try{
        const espn=await fetch(`${ESPN}/racing/motogp/scoreboard`,120000);
        const now=new Date();
        for(const e of(espn?.events||[])){
          const d=e.date?new Date(e.date):null;
          const ev={
            idEvent:String(e.id||''),
            strEvent:e.name||e.shortName||'',
            strLeague:'MotoGP',
            dateEvent:e.date?e.date.split('T')[0]:'',
            strTime:e.date?e.date.split('T')[1]:'',
            strVenue:e.venues?.[0]?.fullName||'',
          };
          if(d&&d<now)past.push(ev);else upcoming.push(ev);
        }
      }catch{}
    }

    res.json({past,upcoming});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/motogp/table',async(req,res)=>{
  try{
    const y=new Date().getFullYear();
    for(const s of[`${y}`,`${y-1}`]){
      const d=await sdb(`/lookuptable.php?l=4407&s=${s}`,3600000).catch(()=>null);
      if(d?.table?.length>0)return res.json({table:d.table});
    }
    res.json({table:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Proxy porta ${PORT}`));
