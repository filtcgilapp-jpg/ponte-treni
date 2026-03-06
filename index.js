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

// ─── score può essere numero, stringa o oggetto {value:N} ─────────────────────
function parseScore(s){
  if(s==null)return'';
  if(typeof s==='object'&&s.value!=null)return String(Math.round(Number(s.value)));
  const n=Number(s);
  if(!isNaN(n)&&String(s).trim()!=='')return String(Math.round(n));
  return'';
}

// ─── Normalizza evento ESPN ───────────────────────────────────────────────────
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
    const completed=!!st.completed;
    const hScore=completed?parseScore(home.score):'';
    const aScore=completed?parseScore(away.score):'';
    // Fase/round da ESPN notes o week
    const round=comp.notes?.[0]?.headline||comp.type?.text||
                (e.week?.number?`Giornata ${e.week.number}`:'');
    return{
      id:String(e.id||''),date:e.date||'',
      league:leagueName||e.league?.name||'',
      leagueSlug:leagueSlug||e.league?.slug||'',
      homeName:hName,awayName:aName,
      homeScore:hScore,awayScore:aScore,
      homeId:String(home.team?.id||''),awayId:String(away.team?.id||''),
      completed,live:st.name==='STATUS_IN_PROGRESS',
      clock:comp.status?.displayClock||'',round,
    };
  }catch{return null;}
}

// ─── Mappa nomi fase coppa inglese→italiano ───────────────────────────────────
function mapPhase(raw){
  if(!raw)return'';
  const r=raw.toLowerCase().trim();
  if(r.includes('semifinal')||r.includes('semi-final'))return'Semifinale';
  if(r.includes('quarterfinal')||r.includes('quarter-final')||r.includes('round of 8'))return'Quarti di Finale';
  if(r.includes('round of 16')||r.includes('ottavi'))return'Ottavi di Finale';
  if(r.includes('round of 32')||r.includes('sedicesimi'))return'Sedicesimi';
  if(r.includes('round of 64')||r.includes('trentaduesimi'))return'Trentaduesimi';
  if((r.includes('final')&&!r.includes('semi')&&!r.includes('quarter')&&!r.includes('round')))return'Finale';
  if(r.includes('group')||r.includes('gruppo')||r.includes('girone'))return'Fase a Gironi';
  if(r.includes('playoff')||r.includes('play-off'))return'Playoff';
  if(r.includes('1st leg'))return'Andata';
  if(r.includes('2nd leg'))return'Ritorno';
  if(r.match(/giornata\s*\d/i)||r.match(/round\s*\d/i)||r.match(/matchday/i))return raw;
  return raw;
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
    setC(ck,{query,items,fetchedAt:new Date().toISOString()},1800000);
    res.json({query,items,fetchedAt:new Date().toISOString()});
  }catch(err){res.status(500).json({error:err.message});}
});

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
// Partite passate: ESPN /teams/:id/schedule (stagione corrente)
// Partite future:  ESPN /scoreboard?dates=OGGI-+90gg filtrato per teamId
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

app.get('/sport/soccer/team/:id/events',async(req,res)=>{
  try{
    const id=req.params.id;
    const allEvents=[];
    const seen=new Set();

    // ── PASSATE: schedule stagione corrente per ogni lega ──────────────────
    await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams/${id}/schedule`,3600000);
        for(const e of(d?.events||[])){
          if(!e||e.$ref)continue;
          const ne=normEvent(e,lg.name,lg.slug);
          if(!ne||!ne.completed||seen.has(ne.id))continue;
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}
    }));

    // ── FUTURE: scoreboard ESPN con range date (CONFERMATO: 69 eventi) ─────
    // Range: oggi + 90 giorni, per ogni lega
    const now=new Date();
    const from=now.toISOString().slice(0,10).replace(/-/g,'');
    const to=new Date(now.getTime()+90*864e5).toISOString().slice(0,10).replace(/-/g,'');
    await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/scoreboard?dates=${from}-${to}`,300000);
        for(const e of(d?.events||[])){
          const ne=normEvent(e,lg.name,lg.slug);
          if(!ne||seen.has(ne.id))continue;
          if(ne.homeId!==id&&ne.awayId!==id)continue;
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}
    }));

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

// Classifica
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
            return res.json({standings:entries.map((e,i)=>{
              const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
              return{
                rank:Math.round(stats['rank']||i+1),
                name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||e.team?.displayName||'',
                teamId:String(e.team?.id||''),
                played:Math.round(stats['gamesPlayed']||0),wins:Math.round(stats['wins']||0),
                draws:Math.round(stats['ties']||stats['draws']||0),losses:Math.round(stats['losses']||0),
                points:Math.round(stats['points']||0),gd:Math.round(stats['pointDifferential']||0),
              };
            })});
          }
        }catch{}
      }
    }
    // Fallback TheSportsDB
    const sdbMap={'ita.1':'4335','esp.1':'4332','eng.1':'4328','ger.1':'4331','fra.1':'4334','uefa.champions':'4480'};
    const lid=sdbMap[slug];
    if(lid){
      for(const s of[`${year-1}-${year}`,`${year}`]){
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

// Fasi coppa — scoreboard con range date + schedule, raggruppati per fase
app.get('/sport/soccer/:league/phases',async(req,res)=>{
  try{
    const slug=req.params.league;
    const teamId=req.query.teamId||'';
    const allEvents=[];
    const seen=new Set();

    // Schedule (partite giocate)
    if(teamId){
      try{
        const d=await fetch(`${ESPN}/soccer/${slug}/teams/${teamId}/schedule`,3600000);
        for(const e of(d?.events||[])){
          if(!e||e.$ref)continue;
          const ne=normEvent(e,slug,slug);if(!ne||seen.has(ne.id))continue;
          const comp=(e.competitions||[])[0]||{};
          ne.round=mapPhase(comp.notes?.[0]?.headline||comp.type?.text||'');
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}
    }

    // Scoreboard future
    const now=new Date();
    const from=now.toISOString().slice(0,10).replace(/-/g,'');
    const to=new Date(now.getTime()+180*864e5).toISOString().slice(0,10).replace(/-/g,'');
    try{
      const d=await fetch(`${ESPN}/soccer/${slug}/scoreboard?dates=${from}-${to}`,300000);
      for(const e of(d?.events||[])){
        const ne=normEvent(e,slug,slug);if(!ne)continue;
        if(teamId&&ne.homeId!==teamId&&ne.awayId!==teamId)continue;
        const comp=(e.competitions||[])[0]||{};
        ne.round=mapPhase(comp.notes?.[0]?.headline||comp.type?.text||'');
        if(!seen.has(ne.id)){seen.add(ne.id);allEvents.push(ne);}
      }
    }catch{}

    allEvents.sort((a,b)=>new Date(a.date)-new Date(b.date));

    // Raggruppa per fase
    const phaseMap=new Map();
    for(const e of allEvents){
      const ph=e.round||'Coppa Italia';
      if(!phaseMap.has(ph))phaseMap.set(ph,[]);
      phaseMap.get(ph).push(e);
    }

    // Standings (gironi se presenti)
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

    const phases=[...phaseMap.entries()].map(([name,events])=>({name,events}));
    res.json({phases,standings});
  }catch(e){res.status(500).json({error:e.message});}
});

// Live
app.get('/sport/soccer/:league/live',async(req,res)=>{
  try{
    const d=await fetch(`${ESPN}/soccer/${req.params.league}/scoreboard`,30000);
    res.json({events:(d?.events||[]).map(e=>normEvent(e,'',req.params.league)).filter(Boolean)});
  }catch(e){res.status(500).json({error:e.message});}
});

// Rosa — ESPN roster (rosa completa) con fallback TheSportsDB
app.get('/sport/soccer/team/:id/roster',async(req,res)=>{
  try{
    const id=req.params.id;
    const name=(req.query.name||'').trim();

    // ESPN roster — fonte più completa e aggiornata
    for(const lg of SOCCER_LEAGUES){
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams/${id}/roster`,86400000);
        const athletes=d?.athletes||[];
        if(athletes.length>0){
          const players=athletes.flatMap(group=>{
            const pos=group.position||group.displayName||'';
            return(group.items||[]).map(p=>({
              idPlayer:String(p.id),
              strPlayer:p.displayName||p.fullName||'',
              strPosition:p.position?.name||p.position?.abbreviation||pos||'',
              strNationality:p.citizenship||p.birthPlace?.country||'',
              strNumber:String(p.jersey||''),
              strThumb:p.headshot?.href||'',
            }));
          });
          if(players.length>5)return res.json({player:players});
        }
      }catch{}
    }

    // Fallback TheSportsDB con varianti nome
    const variants=[name,'Inter','Internazionale','Inter Milan','AC Milan','Milan']
      .filter(v=>v&&name.toLowerCase().includes(v.toLowerCase().split(' ')[0]));
    const searchNames=[name,...new Set(variants)].filter(Boolean).slice(0,4);

    for(const variant of searchNames){
      try{
        const sd=await sdb(`/searchteams.php?t=${encodeURIComponent(variant)}`,3600000);
        const teams=(sd?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));
        if(teams.length>0){
          const p=await sdb(`/lookup_all_players.php?id=${teams[0].idTeam}`,86400000);
          if((p?.player||[]).length>5)return res.json({player:p.player});
        }
      }catch{}
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
    // Passate
    try{
      const d=await fetch(`${ESPN}/basketball/${league}/teams/${id}/schedule`,3600000);
      for(const e of(d?.events||[])){
        if(!e||e.$ref)continue;
        const ne=normEvent(e,league,league);if(!ne||!ne.completed||seen.has(ne.id))continue;
        seen.add(ne.id);allEvents.push(ne);
      }
    }catch{}
    // Future via scoreboard con date range
    const now=new Date();
    const from=now.toISOString().slice(0,10).replace(/-/g,'');
    const to=new Date(now.getTime()+90*864e5).toISOString().slice(0,10).replace(/-/g,'');
    try{
      const d=await fetch(`${ESPN}/basketball/${league}/scoreboard?dates=${from}-${to}`,300000);
      for(const e of(d?.events||[])){
        const ne=normEvent(e,league,league);if(!ne||seen.has(ne.id))continue;
        if(ne.homeId!==id&&ne.awayId!==id)continue;
        seen.add(ne.id);allEvents.push(ne);
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
    res.json({standings:entries.map((e,i)=>{
      const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
      return{rank:i+1,name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||'',teamId:String(e.team?.id||''),wins:Math.round(stats['wins']||0),losses:Math.round(stats['losses']||0)};
    })});
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
// ID confermati: Jannik Sinner = 34208213, Martin Sinner = 34204632
// TheSportsDB /eventslast → {results:[]} /eventsnext → {events:[]}
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/tennis/search',async(req,res)=>{
  try{
    const q=req.query.q||'';
    const d=await sdb(`/searchplayers.php?p=${encodeURIComponent(q)}`,900000);
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
    // eventslast → results[], eventsnext → events[]
    const toArr=d=>{
      if(!d)return[];
      const v=d.results||d.events||d.event||[];
      return Array.isArray(v)?v:[];
    };
    const past=toArr(last);
    const upcoming=toArr(next);

    // Se vuoti, prova con i tornei TheSportsDB per il giocatore
    if(past.length===0&&upcoming.length===0){
      try{
        // Cerca eventi per team/player tramite lookupplayer + eventsseason
        const info=await sdb(`/lookupplayer.php?id=${id}`,86400000).catch(()=>null);
        const teamId=info?.players?.[0]?.idTeam;
        if(teamId){
          const[tl,tn]=await Promise.all([
            sdb(`/eventslast.php?id=${teamId}`,1800000).catch(()=>null),
            sdb(`/eventsnext.php?id=${teamId}`,1800000).catch(()=>null),
          ]);
          return res.json({past:toArr(tl),upcoming:toArr(tn)});
        }
      }catch{}
    }
    res.json({past,upcoming});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/tennis/player/:id/info',async(req,res)=>{
  try{
    const d=await sdb(`/lookupplayer.php?id=${req.params.id}`,86400000);
    res.json({player:(d?.players||d?.player||[])[0]||null});
  }catch(e){res.status(500).json({error:e.message});}
});

// Ranking ATP/WTA — ESPN web API
app.get('/sport/tennis/ranking/:type',async(req,res)=>{
  try{
    const isWTA=req.params.type==='wta';
    const tour=isWTA?'wta':'atp';
    for(const url of[
      `${ESPN2}/tennis/${tour}/rankings`,
      `${ESPN}/tennis/${tour}/rankings`,
    ]){
      try{
        const d=await fetch(url,3600000);
        const entries=d?.rankings?.[0]?.entries||d?.entries||[];
        if(entries.length>0){
          return res.json({ranking:entries.slice(0,100).map((e,i)=>({
            rank:e.currentRanking||e.ranking||i+1,
            name:e.athlete?.displayName||e.player?.displayName||e.team?.displayName||'',
            country:e.athlete?.flag?.alt||e.athlete?.country?.abbreviation||'',
            points:e.rankingPoints||e.points||0,
          }))});
        }
      }catch{}
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
// TheSportsDB ha pochissimi dati (1-2 eventi).
// Usiamo Ergast-style API jolpi.ca per MotoGP se disponibile,
// altrimenti ESPN racing/motogp + TheSportsDB come supplemento
// ══════════════════════════════════════════════════════════════════════════════
app.get('/sport/motogp/calendar',async(req,res)=>{
  try{
    const past=[];const upcoming=[];const seen=new Set();
    const now=new Date();

    // ESPN racing/motogp scoreboard — range ampio
    const from='20260101';
    const to='20261231';
    try{
      // Scoreboard anno corrente
      const d=await fetch(`${ESPN}/racing/motogp/scoreboard`,120000);
      for(const e of(d?.events||[])){
        if(seen.has(String(e.id)))continue;seen.add(String(e.id));
        const ev={
          idEvent:String(e.id),
          strEvent:e.name||e.shortName||'',
          strLeague:'MotoGP',
          dateEvent:e.date?e.date.split('T')[0]:'',
          strTime:e.date?e.date.split('T')[1]:'',
          strVenue:e.venues?.[0]?.fullName||e.location||'',
          strCountry:e.location||'',
          intRound:String(e.week?.number||''),
        };
        const d2=e.date?new Date(e.date):null;
        if(d2&&d2<now)past.push(ev);else upcoming.push(ev);
      }
    }catch{}

    // TheSportsDB come supplemento
    try{
      const[p,n]=await Promise.all([
        sdb('/eventspastleague.php?id=4407',1800000).catch(()=>null),
        sdb('/eventsnextleague.php?id=4407',1800000).catch(()=>null),
      ]);
      for(const e of(p?.events||[])){
        if(!seen.has(String(e.idEvent))){seen.add(String(e.idEvent));past.push(e);}
      }
      for(const e of(n?.events||[])){
        if(!seen.has(String(e.idEvent))){seen.add(String(e.idEvent));upcoming.push(e);}
      }
    }catch{}

    // Ordina
    past.sort((a,b)=>new Date(b.dateEvent||b.date||0)-new Date(a.dateEvent||a.date||0));
    upcoming.sort((a,b)=>new Date(a.dateEvent||a.date||0)-new Date(b.dateEvent||b.date||0));
    res.json({past,upcoming});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/motogp/table',async(req,res)=>{
  try{
    const y=new Date().getFullYear();
    // TheSportsDB — prova anni in ordine decrescente
    for(const s of[`${y}`,`${y-1}`,`${y-2}`]){
      try{
        const d=await sdb(`/lookuptable.php?l=4407&s=${s}`,3600000);
        if(d?.table?.length>0)return res.json({table:d.table,season:s});
      }catch{}
    }
    // Fallback ESPN standings motogp
    try{
      const d=await fetch(`${ESPN}/racing/motogp/standings`,3600000);
      const entries=d?.standings?.[0]?.entries||d?.entries||[];
      if(entries.length>0){
        return res.json({table:entries.map((e,i)=>({
          intRank:String(i+1),
          strTeam:e.athlete?.displayName||e.team?.displayName||'',
          intPoints:String(e.points||0),
          intPlayed:String(e.starts||0),
        }))});
      }
    }catch{}
    res.json({table:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Proxy porta ${PORT}`));
