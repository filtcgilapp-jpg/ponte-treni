const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
function getC(k){const e=cache.get(k);if(!e||Date.now()>e.exp){cache.delete(k);return null;}return e.data;}
function setC(k,v,ms){cache.set(k,{data:v,exp:Date.now()+ms});}
async function fetch(url,ttl=300000,headers={}){
  const k=url+JSON.stringify(headers);
  const c=getC(k);if(c)return c;
  const r=await axios.get(url,{timeout:20000,headers});
  setC(k,r.data,ttl);return r.data;
}

const ESPN ='https://site.api.espn.com/apis/site/v2/sports';
const ESPN2='https://site.web.api.espn.com/apis/v2/sports';
const VT   ='https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_H ={'User-Agent':'Mozilla/5.0','Referer':'https://www.viaggiatreno.it/','Origin':'https://www.viaggiatreno.it'};
const SDB  ='https://www.thesportsdb.com/api/v1/json/123';
const FD   ='https://api.football-data.org/v4';
const FD_H ={'X-Auth-Token':'138a06978b4b4c11b8fada4a4b9247de'};

async function sdb(path,ttl=600000){
  const c=getC(path);if(c)return c;
  const r=await axios.get(`${SDB}${path}`,{timeout:20000});
  setC(path,r.data,ttl);return r.data;
}
async function fd(path,ttl=3600000){
  return fetch(`${FD}${path}`,ttl,FD_H);
}
async function ergast(path,ttl=3600000){
  const k=`erg:${path}`;const c=getC(k);if(c)return c;
  const r=await axios.get(`https://api.jolpi.ca/ergast/f1${path}.json`,{timeout:15000});
  setC(k,r.data,ttl);return r.data;
}

const SOCCER_LEAGUES=[
  {slug:'ita.1',          name:'Serie A',          fd:'SA',  fdCupId:null},
  {slug:'uefa.champions', name:'Champions League',  fd:'CL',  fdCupId:null},
  {slug:'esp.1',          name:'La Liga',           fd:'PD',  fdCupId:null},
  {slug:'eng.1',          name:'Premier League',    fd:'PL',  fdCupId:null},
  {slug:'ger.1',          name:'Bundesliga',        fd:'BL1', fdCupId:null},
  {slug:'fra.1',          name:'Ligue 1',           fd:'FL1', fdCupId:null},
  {slug:'ita.coppa_italia',name:'Coppa Italia',     fd:null,  fdCupId:null},
  {slug:'uefa.europa',    name:'Europa League',     fd:'EL',  fdCupId:null},
];

// Mappa football-data team ID ↔ ESPN team ID (popolata dinamicamente)
const fdIdCache = new Map(); // espnId → fdId

// ─── Score parsing ────────────────────────────────────────────────────────────
function parseScore(s){
  if(s==null)return'';
  if(typeof s==='object'&&s.value!=null)return String(Math.round(Number(s.value)));
  const n=Number(s);
  return(!isNaN(n)&&String(s).trim()!=='')?String(Math.round(n)):'';
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
    const round=comp.notes?.[0]?.headline||comp.type?.text||
                (e.week?.number?`Giornata ${e.week.number}`:'');
    return{
      id:String(e.id||''),date:e.date||'',
      league:leagueName||e.league?.name||'',
      leagueSlug:leagueSlug||e.league?.slug||'',
      homeName:hName,awayName:aName,
      homeScore:completed?parseScore(home.score):'',
      awayScore:completed?parseScore(away.score):'',
      homeId:String(home.team?.id||''),awayId:String(away.team?.id||''),
      completed,live:st.name==='STATUS_IN_PROGRESS',
      clock:comp.status?.displayClock||'',round,
    };
  }catch{return null;}
}

// ─── Mappa stage coppa → italiano ─────────────────────────────────────────────
function mapStage(s){
  if(!s)return'';
  const m={
    'FINAL':'Finale','SEMI_FINALS':'Semifinale','QUARTER_FINALS':'Quarti di Finale',
    'ROUND_OF_16':'Ottavi di Finale','ROUND_OF_32':'Sedicesimi di Finale',
    'ROUND_OF_64':'Trentaduesimi','GROUP_STAGE':'Fase a Gironi',
    'PLAYOFF_ROUND_ONE':'Playoff','PLAYOFF_ROUND_TWO':'Playoff',
    'QUALIFYING':'Qualificazioni','QUALIFYING_ROUNDS':'Qualificazioni',
    'PRELIMINARY_ROUND':'Turno Preliminare','PRELIMINARY_SEMI_FINALS':'Semifinale Preliminare',
    '1ST_LEG':'Andata','2ND_LEG':'Ritorno',
  };
  return m[s]||s.replace(/_/g,' ');
}

// ─── Mappa fase ESPN → italiano ───────────────────────────────────────────────
function mapPhaseESPN(raw){
  if(!raw)return'';
  const r=raw.toLowerCase();
  if(r.includes('semifinal'))return'Semifinale';
  if(r.includes('quarterfinal')||r.includes('quarter-final'))return'Quarti di Finale';
  if(r.includes('round of 16')||r.includes('ottavi'))return'Ottavi di Finale';
  if(r.includes('round of 32'))return'Sedicesimi di Finale';
  if(r.includes('final')&&!r.includes('semi')&&!r.includes('quarter')&&!r.includes('round'))return'Finale';
  if(r.includes('group')||r.includes('girone'))return'Fase a Gironi';
  if(r.includes('1st leg'))return'Andata';if(r.includes('2nd leg'))return'Ritorno';
  return raw;
}

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/',(req,res)=>res.send('OK '+new Date().toISOString()));
app.get('/img',async(req,res)=>{
  try{
    const r=await axios.get(req.query.url,{responseType:'arraybuffer',timeout:10000});
    res.set('Content-Type',r.headers['content-type']||'image/jpeg');
    res.set('Cache-Control','public,max-age=86400');res.send(r.data);
  }catch{res.status(404).send('Not found');}
});
app.get('/og',async(req,res)=>{
  const url=req.query.url;if(!url)return res.status(400).json({error:'Missing url'});
  const ck=`og:${url}`;const cached=getC(ck);if(cached)return res.json(cached);
  try{
    const r=await axios.get(url,{timeout:10000,headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1)','Accept':'text/html'},maxRedirects:5});
    const html=r.data;
    const getMeta=(prop)=>{for(const p of[new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`,'i'),new RegExp(`<meta[^>]*name=["']${prop}["'][^>]*content=["']([^"']+)["']`,'i')]){const m=html.match(p);if(m)return m[1].replace(/&amp;/g,'&').replace(/&#039;/g,"'").trim();}return null;};
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
// CALCIO — ricerca ESPN, partite ESPN, rosa+fasi football-data.org
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

// Trova ID football-data da nome squadra
async function getFdTeamId(espnId, teamName){
  if(fdIdCache.has(espnId))return fdIdCache.get(espnId);
  // Cerca nelle competizioni che supportiamo
  const comps=['SA','CL','PD','PL','BL1','FL1','EL'];
  for(const comp of comps){
    try{
      const d=await fd(`/competitions/${comp}/teams`,86400000);
      for(const t of(d?.teams||[])){
        const n=(t.name||'').toLowerCase();
        const sn=(t.shortName||'').toLowerCase();
        const q=teamName.toLowerCase().replace(/\s*(fc|cf|sc|ac|as|ssc)\s*/gi,'').trim();
        if(n.includes(q)||sn.includes(q)||q.includes(sn.split(' ')[0])){
          fdIdCache.set(espnId,t.id);
          return t.id;
        }
      }
    }catch{}
  }
  return null;
}

app.get('/sport/soccer/team/:id/events',async(req,res)=>{
  try{
    const id=req.params.id;
    const allEvents=[];const seen=new Set();

    // Passate: ESPN schedule
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

    // Future: ESPN scoreboard date range (CONFERMATO: 69 eventi)
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

app.get('/sport/soccer/team/:id/leagues',async(req,res)=>{
  try{
    const id=req.params.id;const map=new Map();
    await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{
      try{
        const d=await fetch(`${ESPN}/soccer/${lg.slug}/teams/${id}/schedule`,3600000);
        if((d?.events||[]).some(e=>e&&!e.$ref))map.set(lg.slug,{slug:lg.slug,name:lg.name});
      }catch{}
    }));
    const main=req.query.main;
    if(main&&!map.has(main)){const found=SOCCER_LEAGUES.find(l=>l.slug===main);if(found)map.set(main,{slug:main,name:found.name});}
    res.json({leagues:[...map.values()]});
  }catch(e){res.status(500).json({error:e.message});}
});

// Classifica — ESPN + fallback football-data
app.get('/sport/soccer/:league/standings',async(req,res)=>{
  try{
    const slug=req.params.league;
    const year=new Date().getFullYear();
    // ESPN
    for(const y of[year,year-1]){
      for(const url of[`${ESPN2}/soccer/${slug}/standings?season=${y}`,`${ESPN}/soccer/${slug}/standings`]){
        try{
          const d=await fetch(url,3600000);
          let entries=[];
          for(const g of(d.children||[])){entries.push(...(g.standings?.entries||[]));}
          if(!entries.length)entries=d.standings?.entries||[];
          if(entries.length>0){
            return res.json({standings:entries.map((e,i)=>{
              const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
              return{rank:Math.round(stats['rank']||i+1),name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||e.team?.displayName||'',teamId:String(e.team?.id||''),played:Math.round(stats['gamesPlayed']||0),wins:Math.round(stats['wins']||0),draws:Math.round(stats['ties']||stats['draws']||0),losses:Math.round(stats['losses']||0),points:Math.round(stats['points']||0),gd:Math.round(stats['pointDifferential']||0)};
            })});
          }
        }catch{}
      }
    }
    // Fallback football-data.org
    const lg=SOCCER_LEAGUES.find(l=>l.slug===slug);
    if(lg?.fd){
      try{
        const d=await fd(`/competitions/${lg.fd}/standings`,3600000);
        const table=d?.standings?.find(s=>s.type==='TOTAL')?.table||[];
        if(table.length>0){
          return res.json({standings:table.map(e=>({
            rank:e.position,name:e.team?.name||'',shortName:e.team?.shortName||e.team?.tla||'',
            teamId:'fd:'+String(e.team?.id||''),
            played:e.playedGames||0,wins:e.won||0,draws:e.draw||0,losses:e.lost||0,
            points:e.points||0,gd:e.goalDifference||0,
          }))});
        }
      }catch{}
    }
    res.json({standings:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// Fasi coppa — ESPN + football-data per le coppe supportate
app.get('/sport/soccer/:league/phases',async(req,res)=>{
  try{
    const slug=req.params.league;
    const teamId=req.query.teamId||'';
    const allEvents=[];const seen=new Set();

    // Partite giocate da ESPN schedule
    if(teamId){
      try{
        const d=await fetch(`${ESPN}/soccer/${slug}/teams/${teamId}/schedule`,3600000);
        for(const e of(d?.events||[])){
          if(!e||e.$ref)continue;
          const ne=normEvent(e,slug,slug);if(!ne||seen.has(ne.id))continue;
          const comp=(e.competitions||[])[0]||{};
          ne.round=mapPhaseESPN(comp.notes?.[0]?.headline||comp.type?.text||'');
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}
    }
    // Future via scoreboard
    const now=new Date();
    const from=now.toISOString().slice(0,10).replace(/-/g,'');
    const to=new Date(now.getTime()+180*864e5).toISOString().slice(0,10).replace(/-/g,'');
    try{
      const d=await fetch(`${ESPN}/soccer/${slug}/scoreboard?dates=${from}-${to}`,300000);
      for(const e of(d?.events||[])){
        const ne=normEvent(e,slug,slug);if(!ne)continue;
        if(teamId&&ne.homeId!==teamId&&ne.awayId!==teamId)continue;
        const comp=(e.competitions||[])[0]||{};
        ne.round=mapPhaseESPN(comp.notes?.[0]?.headline||comp.type?.text||'');
        if(!seen.has(ne.id)){seen.add(ne.id);allEvents.push(ne);}
      }
    }catch{}

    // football-data per coppe con stage (CL, EL)
    const lg=SOCCER_LEAGUES.find(l=>l.slug===slug);
    if(lg?.fd){
      try{
        const year=new Date().getFullYear();
        const season=year-1; // stagione 2025/26 = season 2025
        const url=teamId
          ?`/competitions/${lg.fd}/matches?season=${season}&team=${await getFdTeamId(teamId,'')}`
          :`/competitions/${lg.fd}/matches?season=${season}`;
        const d=await fd(url,3600000).catch(()=>null);
        for(const m of(d?.matches||[])){
          const eid=`fd:${m.id}`;
          if(seen.has(eid))continue;
          seen.add(eid);
          allEvents.push({
            id:eid,
            date:m.utcDate||'',
            league:lg.name,leagueSlug:slug,
            homeName:m.homeTeam?.shortName||m.homeTeam?.name||'',
            awayName:m.awayTeam?.shortName||m.awayTeam?.name||'',
            homeScore:m.score?.fullTime?.home!=null?String(m.score.fullTime.home):'',
            awayScore:m.score?.fullTime?.away!=null?String(m.score.fullTime.away):'',
            homeId:'',awayId:'',
            completed:m.status==='FINISHED',live:m.status==='IN_PLAY',clock:'',
            round:mapStage(m.stage||m.matchday?.toString()||''),
          });
        }
      }catch{}
    }

    allEvents.sort((a,b)=>new Date(a.date)-new Date(b.date));

    // Raggruppa per fase
    const phaseMap=new Map();
    for(const e of allEvents){
      const ph=e.round||lg?.name||slug;
      if(!phaseMap.has(ph))phaseMap.set(ph,[]);
      phaseMap.get(ph).push(e);
    }

    // Standings gironi
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
              });break;
            }
          }catch{}
          if(standings.length)break;
        }
        if(standings.length)break;
      }
    }catch{}

    res.json({phases:[...phaseMap.entries()].map(([name,events])=>({name,events})),standings});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/soccer/:league/live',async(req,res)=>{
  try{
    const d=await fetch(`${ESPN}/soccer/${req.params.league}/scoreboard`,30000);
    res.json({events:(d?.events||[]).map(e=>normEvent(e,'',req.params.league)).filter(Boolean)});
  }catch(e){res.status(500).json({error:e.message});}
});

// Rosa — football-data.org (rosa completa, 39 giocatori per Inter confermato)
app.get('/sport/soccer/team/:id/roster',async(req,res)=>{
  try{
    const espnId=req.params.id;
    const name=(req.query.name||'').trim();

    // Trova fd team id
    let fdId=await getFdTeamId(espnId,name);

    // Se non trovato, cerca direttamente per nome
    if(!fdId&&name){
      const comps=['SA','CL','PD','PL','BL1','FL1','EL'];
      for(const comp of comps){
        try{
          const d=await fd(`/competitions/${comp}/teams`,86400000);
          for(const t of(d?.teams||[])){
            const n=(t.name||'').toLowerCase();
            const sn=(t.shortName||'').toLowerCase();
            const q=name.toLowerCase().replace(/\s*(fc|cf|sc|ac|as|ssc)\s*/gi,'').trim().split(' ')[0];
            if(n.includes(q)||sn.includes(q)){fdId=t.id;fdIdCache.set(espnId,t.id);break;}
          }
        }catch{}
        if(fdId)break;
      }
    }

    if(fdId){
      try{
        const d=await fd(`/teams/${fdId}`,86400000);
        const squad=d?.squad||[];
        if(squad.length>0){
          return res.json({player:squad.map(p=>({
            idPlayer:String(p.id),
            strPlayer:p.name||'',
            strPosition:p.position||'',
            strNationality:p.nationality||'',
            strNumber:'',
            strThumb:'',
            dateOfBirth:p.dateOfBirth||'',
          }))});
        }
      }catch{}
    }

    // Fallback TheSportsDB
    const sd=await sdb(`/searchteams.php?t=${encodeURIComponent(name)}`,3600000).catch(()=>null);
    const teams=(sd?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));
    if(teams.length>0){
      const p=await sdb(`/lookup_all_players.php?id=${teams[0].idTeam}`,86400000).catch(()=>null);
      if((p?.player||[]).length>0)return res.json({player:p.player});
    }
    res.json({player:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// BASKET
// ══════════════════════════════════════════════════════════════════════════════
const BBALL_LEAGUES=[{slug:'nba',name:'NBA'},{slug:'ita.lba',name:'Lega Basket'},{slug:'euroleague',name:'EuroLeague'}];
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
    const{league,id}=req.params;const allEvents=[];const seen=new Set();
    try{
      const d=await fetch(`${ESPN}/basketball/${league}/teams/${id}/schedule`,3600000);
      for(const e of(d?.events||[])){
        if(!e||e.$ref)continue;
        const ne=normEvent(e,league,league);if(!ne||!ne.completed||seen.has(ne.id))continue;
        seen.add(ne.id);allEvents.push(ne);
      }
    }catch{}
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
// TENNIS — TheSportsDB + ESPN ranking
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
    const toArr=d=>{if(!d)return[];const v=d.results||d.events||d.event||[];return Array.isArray(v)?v:[];};
    let past=toArr(last),upcoming=toArr(next);
    // Se vuoti, prova con idTeam del giocatore
    if(!past.length&&!upcoming.length){
      try{
        const info=await sdb(`/lookupplayer.php?id=${id}`,86400000);
        const teamId=(info?.players||info?.player||[])[0]?.idTeam;
        if(teamId){
          const[tl,tn]=await Promise.all([
            sdb(`/eventslast.php?id=${teamId}`,1800000).catch(()=>null),
            sdb(`/eventsnext.php?id=${teamId}`,1800000).catch(()=>null),
          ]);
          past=toArr(tl);upcoming=toArr(tn);
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
app.get('/sport/tennis/ranking/:type',async(req,res)=>{
  try{
    const isWTA=req.params.type==='wta';const tour=isWTA?'wta':'atp';
    for(const url of[`${ESPN2}/tennis/${tour}/rankings`,`${ESPN}/tennis/${tour}/rankings`]){
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
app.get('/sport/f1/calendar',async(req,res)=>{try{res.json(await ergast(`/${F1Y}`));}catch(e){res.status(500).json({error:e.message});}});
app.get('/sport/f1/drivers',async(req,res)=>{
  try{for(const y of[F1Y,F1Y-1]){const d=await ergast(`/${y}/driverStandings`).catch(()=>null);if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.length>0)return res.json(d);}res.status(500).json({error:'Non disponibile'});}catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/constructors',async(req,res)=>{
  try{for(const y of[F1Y,F1Y-1]){const d=await ergast(`/${y}/constructorStandings`).catch(()=>null);if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings?.length>0)return res.json(d);}res.status(500).json({error:'Non disponibile'});}catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/f1/last',async(req,res)=>{try{res.json(await ergast('/current/last/results',3600000));}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════════════════════════════════
// MOTOGP — Wikipedia API (calendario completo) + TheSportsDB (supplemento)
// ══════════════════════════════════════════════════════════════════════════════

// Parser calendario MotoGP da wikitext Wikipedia
function parseMotoGPWikitext(wt){
  const races=[];
  // Cerca la sezione della tabella calendario
  // Struttura: righe con | Round || GP name || Circuit || Date || ...
  const lines=wt.split('\n');
  let inTable=false;
  let currentRace={};
  let round=0;

  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();

    // Inizio tabella calendario (cerca "Season calendar" o "Rnd" header)
    if(line.includes('Season calendar')||line.includes('Rnd')||line.includes('Grand Prix')||line.includes('{| class="wikitable'))inTable=true;

    if(!inTable)continue;

    // Fine tabella
    if(line==='|}')break;

    // Nuova riga della tabella
    if(line.startsWith('|-')){
      if(currentRace.name){races.push(currentRace);}
      currentRace={};continue;
    }

    // Celle della tabella — parse contenuto
    if(line.startsWith('|')&&!line.startsWith('||')&&!line.startsWith('|}')&&!line.startsWith('|+')){
      const cell=line.replace(/^\|+\s*/,'').trim();

      // Round number
      if(/^\d+$/.test(cell)&&!currentRace.round){
        currentRace.round=parseInt(cell);round=currentRace.round;continue;
      }

      // Link GP → nome
      const gpMatch=cell.match(/\[\[2\d{3}\s+(.+?(?:Grand Prix|GP).+?)(?:\|[^\]]+)?\]\]/i);
      if(gpMatch&&!currentRace.name){
        let name=gpMatch[1].trim();
        name=name.replace(/motorcycle\s+/i,'').replace(/\s+Grand Prix/i,' GP').replace(/Grand Prix of the\s*/i,'GP of the ').trim();
        currentRace.name=name;continue;
      }

      // Circuito
      const circMatch=cell.match(/\[\[([^\]|]+(?:Circuit|Track|Ring|Autodrome|Speedway|Park)[^\]|]*)/i);
      if(circMatch&&!currentRace.circuit){
        currentRace.circuit=circMatch[1].trim();continue;
      }

      // Data — cerca pattern mese
      const dateMatch=cell.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i);
      if(dateMatch&&!currentRace.dateStr){
        currentRace.dateStr=`${dateMatch[1]} ${dateMatch[2]}`;
        // Converti in ISO
        const months={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
        const m=months[dateMatch[2].toLowerCase()]||1;
        const y=new Date().getFullYear();
        currentRace.date=`${y}-${String(m).padStart(2,'0')}-${String(dateMatch[1]).padStart(2,'0')}T12:00:00Z`;
        continue;
      }

      // Nazione/venue
      const flagMatch=cell.match(/\{\{flagicon\|([^}]+)\}\}/);
      if(flagMatch&&!currentRace.country){currentRace.country=flagMatch[1].trim();continue;}
    }
  }
  if(currentRace.name)races.push(currentRace);

  // Rimuovi duplicati e aggiungi round se mancante
  return races.filter(r=>r.name).map((r,i)=>({
    ...r,
    round:r.round||(i+1),
    idEvent:`wiki_moto_${r.round||i+1}`,
    strEvent:r.name,
    strLeague:'MotoGP',
    dateEvent:r.date?r.date.split('T')[0]:'',
    strVenue:r.circuit||'',
    strCountry:r.country||'',
  }));
}

app.get('/sport/motogp/calendar',async(req,res)=>{
  try{
    const now=new Date();
    const year=now.getFullYear();
    let allRaces=[];

    // 1. Wikipedia API — calendario completo
    try{
      const wiki=await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${year}_MotoGP_World_Championship&prop=revisions&rvprop=content&format=json&formatversion=2`,
        7200000
      );
      const wt=wiki?.query?.pages?.[0]?.revisions?.[0]?.content||'';
      if(wt.length>1000){
        const parsed=parseMotoGPWikitext(wt);
        allRaces=parsed;
      }
    }catch{}

    // 2. TheSportsDB come supplemento date/info
    const seen=new Set(allRaces.map(r=>r.strEvent?.toLowerCase().replace(/\s+/g,'')));
    try{
      const[p,n]=await Promise.all([
        sdb('/eventspastleague.php?id=4407',1800000).catch(()=>null),
        sdb('/eventsnextleague.php?id=4407',1800000).catch(()=>null),
      ]);
      for(const e of [...(p?.events||[]),...(n?.events||[])]){
        const k=(e.strEvent||'').toLowerCase().replace(/\s+/g,'');
        if(!seen.has(k)){seen.add(k);allRaces.push({
          idEvent:String(e.idEvent),strEvent:e.strEvent||'',strLeague:'MotoGP',
          dateEvent:e.dateEvent||'',strVenue:e.strVenue||'',strCountry:e.strCountry||'',round:0,
        });}
      }
    }catch{}

    // Separa passate/future e ordina
    allRaces.sort((a,b)=>new Date(a.date||a.dateEvent||0)-new Date(b.date||b.dateEvent||0));
    const past=allRaces.filter(r=>{const d=new Date(r.date||r.dateEvent||0);return d<now&&r.dateEvent;});
    const upcoming=allRaces.filter(r=>{const d=new Date(r.date||r.dateEvent||0);return d>=now||!r.dateEvent;});

    res.json({past,upcoming});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/motogp/table',async(req,res)=>{
  try{
    const y=new Date().getFullYear();
    // TheSportsDB — anni in ordine decrescente
    for(const s of[`${y}`,`${y-1}`,`${y-2}`]){
      try{
        const d=await sdb(`/lookuptable.php?l=4407&s=${s}`,3600000);
        if(d?.table?.length>0)return res.json({table:d.table,season:s});
      }catch{}
    }
    // ESPN standings motogp
    try{
      const d=await fetch(`${ESPN}/racing/motogp/standings`,3600000);
      const entries=d?.standings?.[0]?.entries||d?.entries||[];
      if(entries.length>0){
        return res.json({table:entries.map((e,i)=>({
          intRank:String(i+1),strTeam:e.athlete?.displayName||e.team?.displayName||'',
          intPoints:String(e.points||0),intPlayed:String(e.starts||0),
        }))});
      }
    }catch{}
    res.json({table:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Proxy porta ${PORT}`));
