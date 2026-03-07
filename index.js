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
  // Campionati italiani
  {slug:'ita.1',              name:'Serie A',              fd:'SA',  isCup:false},
  {slug:'ita.2',              name:'Serie B',              fd:null,  isCup:false},
  {slug:'ita.3',              name:'Serie C',              fd:null,  isCup:false},
  // Campionati europei
  {slug:'esp.1',              name:'La Liga',              fd:'PD',  isCup:false},
  {slug:'eng.1',              name:'Premier League',       fd:'PL',  isCup:false},
  {slug:'ger.1',              name:'Bundesliga',           fd:'BL1', isCup:false},
  {slug:'fra.1',              name:'Ligue 1',              fd:'FL1', isCup:false},
  // Coppe europee
  {slug:'uefa.champions',     name:'Champions League',     fd:'CL',  isCup:true},
  {slug:'uefa.europa',        name:'Europa League',        fd:'EL',  isCup:true},
  {slug:'uefa.conference',    name:'Conference League',    fd:'ECSL',isCup:true},
  // Coppe nazionali
  {slug:'ita.coppa_italia',   name:'Coppa Italia',         fd:null,  isCup:true},
  {slug:'esp.copa_del_rey',   name:'Copa del Rey',         fd:null,  isCup:true},
  {slug:'eng.fa',             name:'FA Cup',               fd:'FAC', isCup:true},
  {slug:'ger.dfb_pokal',      name:'DFB Pokal',            fd:'DFB', isCup:true},
  {slug:'fra.coupe_de_france',name:'Coppa di Francia',     fd:null,  isCup:true},
  {slug:'ita.super_cup',      name:'Supercoppa Italiana',  fd:null,  isCup:true},
  {slug:'esp.super_cup',      name:'Supercoppa Spagnola',  fd:null,  isCup:true},
  {slug:'uefa.super_cup',     name:'UEFA Super Cup',       fd:null,  isCup:true},
];

// Mappa football-data team ID ↔ ESPN team ID (popolata dinamicamente)
const fdIdCache = new Map(); // espnId → fdId

// Mappa NOME (lowercase, normalizzato) → FD team ID
// Dati confermati da football-data.org /v4/competitions/SA/teams
const FD_NAME_MAP = {
  // Serie A
  'milan':98,'ac milan':98,'acmilan':98,
  'fiorentina':99,'acf fiorentina':99,
  'roma':100,'as roma':100,
  'atalanta':102,'atalanta bc':102,
  'bologna':103,'bologna fc':103,
  'cagliari':104,'cagliari calcio':104,
  'genoa':107,'genoa cfc':107,
  'inter':108,'internazionale':108,'inter milan':108,'fc internazionale':108,
  'juventus':109,'juventus fc':109,
  'lazio':110,'ss lazio':110,
  'parma':112,'parma calcio':112,
  'napoli':113,'ssc napoli':113,
  'udinese':115,'udinese calcio':115,
  'verona':450,'hellas verona':450,
  'torino':586,'torino fc':586,
  'lecce':5890,'us lecce':5890,
  'como':7397,'como 1907':7397,
  // Serie B
  'palermo':488,'us palermo':488,
  'sampdoria':489,'uc sampdoria':489,
  'bari':6226,'ssc bari':6226,
  'catanzaro':3629,
  'cremonese':457,'us cremonese':457,
  'pisa':487,'ac pisa':487,
  'frosinone':6240,'frosinone calcio':6240,
  'venezia':523,'venezia fc':523,
  'brescia':3298,'brescia calcio':3298,
  'spezia':6212,'spezia calcio':6212,
  'modena':2320,'modena fc':2320,
  'sassuolo':471,'us sassuolo':471,
  'reggiana':2321,'ac reggiana':2321,
  'mantova':2322,
  'juve stabia':2323,'ss juve stabia':2323,
  'cesena':2324,'ac cesena':2324,
  'carrarese':2325,
  'sudtirol':2326,'fc sudtirol':2326,
  'cosenza':6241,'cosenza calcio':6241,
  // Champions + altre
  'real madrid':86,'real':86,
  'barcelona':81,'fc barcelona':81,
  'atletico madrid':78,'atletico':78,
  'manchester city':65,'man city':65,
  'manchester united':66,'man united':66,
  'liverpool':64,
  'chelsea':61,
  'arsenal':57,
  'tottenham':73,'tottenham hotspur':73,'spurs':73,
  'bayern munich':5,'bayern':5,'fc bayern':5,
  'borussia dortmund':4,'dortmund':4,
  'psg':524,'paris saint-germain':524,'paris sg':524,
  'porto':4284,
  'benfica':1903,
  'ajax':610,
  'bayer leverkusen':3,
  'rb leipzig':721,'red bull leipzig':721,
};

function normName(n){
  return (n||'').toLowerCase()
    .replace(/(fc|cf|sc|ac|as|ssc|us|rc|afc|cd|real)/g,'')
    .replace(/\s+/g,' ').trim();
}

// ─── Score parsing ────────────────────────────────────────────────────────────
function parseScore(s){
  if(s==null)return'';
  if(typeof s==='object'&&s.value!=null)return String(Math.round(Number(s.value)));
  const n=Number(s);
  return(!isNaN(n)&&String(s).trim()!=='')?String(Math.round(n)):'';
}

// ─── Traduci status ESPN → italiano ─────────────────────────────────────────
function translateStatus(st){
  if(!st)return'';
  const name=st.name||'';const desc=st.description||'';const detail=st.detail||'';
  // Partita finita
  if(name==='STATUS_FULL_TIME'||detail==='FT')return'Tempo Regolamentare';
  if(name==='STATUS_EXTRA_TIME'||detail==='AET'||detail==='ET')return'Dopo i Supplementari';
  if(name==='STATUS_PENALTY'||detail==='Pen'||detail==='PSO')return'Dopo i Rigori';
  if(name==='STATUS_ABANDONED')return'Abbandonata';
  if(name==='STATUS_POSTPONED')return'Rinviata';
  if(name==='STATUS_SUSPENDED')return'Sospesa';
  if(name==='STATUS_CANCELED')return'Annullata';
  // In corso
  if(name==='STATUS_IN_PROGRESS'||name==='STATUS_HALFTIME')return desc||'In Corso';
  if(name==='STATUS_HALFTIME'||detail==='HT')return'Intervallo';
  // Non iniziata
  if(name==='STATUS_SCHEDULED'||name==='STATUS_UPCOMING')return'';
  // Extra time
  if(name.includes('EXTRA')||detail.includes('ET'))return'Supplementari';
  if(name.includes('PENALTY')||detail.includes('Pen'))return'Rigori';
  return '';
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
      clock:comp.status?.displayClock||'',
      round,
      statusDetail:translateStatus(comp.status?.type),
    };
  }catch{return null;}
}

// ─── Mappa stage → italiano (football-data + ESPN) ────────────────────────────
function mapStage(s){
  if(!s)return'';
  // football-data.org stage values
  const fdMap={
    'FINAL':'Finale','SEMI_FINALS':'Semifinale','QUARTER_FINALS':'Quarti di Finale',
    'ROUND_OF_16':'Ottavi di Finale','ROUND_OF_32':'Sedicesimi di Finale',
    'ROUND_OF_64':'Trentaduesimi','GROUP_STAGE':'Fase a Gironi',
    'LEAGUE_STAGE':'Fase a Gironi','LEAGUE STAGE':'Fase a Gironi',
    'PLAYOFF_ROUND_ONE':'Playoff','PLAYOFF_ROUND_TWO':'Playoff',
    'PLAYOFFS':'Playoff','PLAY_OFF_ROUND':'Playoff',
    'QUALIFYING':'Qualificazioni','QUALIFYING_ROUNDS':'Qualificazioni',
    'PRELIMINARY_ROUND':'Turno Preliminare','PRELIMINARY_SEMI_FINALS':'Semifinale Preliminare',
    '1ST_LEG':'Andata','2ND_LEG':'Ritorno',
  };
  if(fdMap[s])return fdMap[s];
  // ESPN text values (case-insensitive fuzzy)
  const lower=s.toLowerCase().trim();
  if(lower==='final'||lower==='finale'||lower==='final stage')return'Finale';
  if(lower.includes('semi'))return'Semifinale';
  if(lower.includes('quarter')||lower==='quarti di finale')return'Quarti di Finale';
  if(lower==='last 16'||lower==='last_16'||lower.includes('round of 16')||lower.includes('ottavi'))return'Ottavi di Finale';
  if(lower==='last 32'||lower==='last_32'||lower.includes('round of 32'))return'Sedicesimi di Finale';
  if(lower==='last 64'||lower==='last_64'||lower.includes('round of 64'))return'Trentaduesimi';
  if(lower.includes('league stage')||lower.includes('group stage')||lower.includes('girone'))return'Fase a Gironi';
  if(lower.includes('playoff'))return'Playoff';
  if(lower.includes('qualifying'))return'Qualificazioni';
  if(lower.includes('1st leg')||lower==='andata')return'Andata';
  if(lower.includes('2nd leg')||lower==='ritorno')return'Ritorno';
  // Nomi lega generici usati come fase (ESPN fallback) → Fase Knockout
  if(lower==='champions league'||lower==='cl')return'Fase Knockout';
  if(lower==='europa league'||lower==='el')return'Fase Knockout';
  if(lower==='conference league')return'Fase Knockout';
  if(lower==='coppa italia')return'Fase a Eliminazione';
  if(lower==='fa cup'||lower==='dfb pokal'||lower==='coupe de france'||lower==='copa del rey')return'Fase a Eliminazione';
  // Giornata numerica
  const gm=lower.match(/(?:matchday|giornata|round|md)\s*(\d+)/);
  if(gm)return`Giornata ${gm[1]}`;
  return s;
}

// ─── Mappa fase ESPN → italiano ───────────────────────────────────────────────
function mapPhaseESPN(raw){ return mapStage(raw); }

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/',(req,res)=>res.send('OK '+new Date().toISOString()));
app.get('/cache/clear',async(req,res)=>{
  // Svuota solo le entry Wikipedia MotoGP
  for(const[k] of cache){if(k.includes('wikipedia')||k.includes('wiki'))cache.delete(k);}
  res.json({cleared:true,remaining:cache.size});
});
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
    // Fallback TheSportsDB per leghe non coperte da ESPN (Serie C, leghe minori)
    if(seen.size===0){
      try{
        const d=await sdb(`/searchteams.php?t=${encodeURIComponent(q)}`,3600000);
        for(const t of(d?.teams||[])){
          if(!['soccer','football'].includes((t.strSport||'').toLowerCase()))continue;
          const dn=(t.strTeam||'').toLowerCase();
          if(!dn.includes(q)&&!(t.strTeamShort||'').toLowerCase().includes(q))continue;
          if(!seen.has(dn))seen.set(dn,{
            id:`sdb:${t.idTeam}`,
            name:t.strTeam,
            shortName:t.strTeamShort||t.strTeam,
            league:t.strLeague||'Calcio',
            leagueSlug:t.strLeague?.toLowerCase().includes('serie b')?'ita.2':
                       t.strLeague?.toLowerCase().includes('serie c')||t.strLeague?.toLowerCase().includes('lega pro')?'ita.3':
                       t.strLeague?.toLowerCase().includes('serie a')?'ita.1':'ita.1',
          });
        }
      }catch{}
    }
    res.json({teams:[...seen.values()]});
  }catch(e){res.status(500).json({error:e.message});}
});

// Trova ID football-data da nome squadra — usa name map hardcoded + fallback API
async function getFdTeamId(espnId, teamName){
  if(fdIdCache.has(String(espnId)))return fdIdCache.get(String(espnId));
  // Prima cerca nel name map hardcoded (istantaneo, preciso)
  const norm=normName(teamName);
  const words=norm.split(' ').filter(w=>w.length>2);
  // Match esatto
  if(FD_NAME_MAP[norm]){fdIdCache.set(String(espnId),FD_NAME_MAP[norm]);return FD_NAME_MAP[norm];}
  // Match parziale — cerca se la chiave contiene una parola del nome
  for(const [k,v] of Object.entries(FD_NAME_MAP)){
    if(words.some(w=>k.includes(w)||w.includes(k.split(' ')[0]))){
      fdIdCache.set(String(espnId),v);return v;
    }
  }
  // Fallback: API football-data
  const comps=['SA','CL','PD','PL','BL1','FL1','EL'];
  for(const comp of comps){
    try{
      const d=await fd('/competitions/'+comp+'/teams',86400000);
      for(const t of(d?.teams||[])){
        const tn=normName(t.name);const ts=normName(t.shortName);
        if(words.some(w=>tn.includes(w)||ts.includes(w))){
          fdIdCache.set(String(espnId),t.id);return t.id;
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

    // Squadre da TheSportsDB (Serie C, leghe minori): usa SDB direttamente
    if(id.startsWith('sdb:')){
      const sdbId=id.replace('sdb:','');
      try{
        const[last,next]=await Promise.all([
          sdb(`/eventslast.php?id=${sdbId}`,1800000).catch(()=>({results:[]})),
          sdb(`/eventsnext.php?id=${sdbId}`,1800000).catch(()=>({events:[]})),
        ]);
        const past=(last?.results||last?.events||[]).map(e=>({
          id:String(e.idEvent),
          date:e.dateEvent?(e.dateEvent+'T'+(e.strTime||'00:00:00')):'',
          league:e.strLeague||'Serie C',leagueSlug:'ita.3',
          homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',
          homeScore:e.intHomeScore!=null?String(e.intHomeScore):'',
          awayScore:e.intAwayScore!=null?String(e.intAwayScore):'',
          homeId:'',awayId:'',completed:e.intHomeScore!=null,live:false,clock:'',
          round:e.intRound?`Giornata ${e.intRound}`:'',statusDetail:'',
        }));
        const future=(next?.events||[]).map(e=>({
          id:String(e.idEvent),
          date:e.dateEvent?(e.dateEvent+'T'+(e.strTime||'00:00:00')):'',
          league:e.strLeague||'Serie C',leagueSlug:'ita.3',
          homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',
          homeScore:'',awayScore:'',homeId:'',awayId:'',
          completed:false,live:false,clock:'',
          round:e.intRound?`Giornata ${e.intRound}`:'',statusDetail:'',
        }));
        const all=[...past,...future];
        all.sort((a,b)=>new Date(a.date)-new Date(b.date));
        return res.json({events:all});
      }catch(err){return res.json({events:[],error:err.message});}
    }

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
        if((d?.events||[]).some(e=>e&&!e.$ref)){
          map.set(lg.slug,{slug:lg.slug,name:lg.name,isCup:lg.isCup||false});
          return;
        }
      }catch{}
      // Per coppe europee: prova anche scoreboard recente
      if(lg.isCup){
        try{
          const now=new Date();
          const from=new Date(now.getTime()-180*864e5).toISOString().slice(0,10).replace(/-/g,'');
          const to=new Date(now.getTime()+180*864e5).toISOString().slice(0,10).replace(/-/g,'');
          const d=await fetch(`${ESPN}/soccer/${lg.slug}/scoreboard?dates=${from}-${to}`,3600000);
          const found=(d?.events||[]).some(e=>{
            const ne=normEvent(e,'','');
            return ne&&(ne.homeId===id||ne.awayId===id);
          });
          if(found)map.set(lg.slug,{slug:lg.slug,name:lg.name,isCup:true});
        }catch{}
      }
    }));
    const main=req.query.main;
    if(main&&!map.has(main)){const found=SOCCER_LEAGUES.find(l=>l.slug===main);if(found)map.set(main,{slug:main,name:found.name,isCup:found.isCup||false});}
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
          // Prova più campi ESPN per determinare la fase
          const headline=comp.notes?.[0]?.headline||'';
          const typeText=comp.type?.text||'';
          const rawPhase=headline||typeText||'';
          ne.round=rawPhase?mapPhaseESPN(rawPhase):'';
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
        const hl2=comp.notes?.[0]?.headline||comp.type?.text||'';
        ne.round=hl2?mapPhaseESPN(hl2):'';
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

    // Raggruppa per fase, assegna fase mancante in base alla data/contesto
    const phaseOrder=['Qualificazioni','Turno Preliminare','Fase a Gironi','Playoff',
      'Sedicesimi di Finale','Ottavi di Finale','Quarti di Finale','Semifinale','Andata','Ritorno',
      'Finale','Fase a Eliminazione','Fase Knockout'];
    // Per eventi senza round, cerca di dedurre dalla posizione temporale
    const phaseMap=new Map();
    for(const e of allEvents){
      let ph=e.round;
      if(!ph||ph===''){
        // Prova a inferire: se altri eventi nella stessa settimana hanno una fase, usa quella
        // Altrimenti usa "Fase Knockout" per coppe
        const isKnockout=SOCCER_LEAGUES.find(l=>l.slug===slug)?.isCup;
        ph=isKnockout?'Fase a Eliminazione':'Altra Fase';
      }
      if(!phaseMap.has(ph))phaseMap.set(ph,[]);
      phaseMap.get(ph).push(e);
    }
    // Ordina le fasi in ordine logico
    const sortedPhases=[...phaseMap.entries()].sort((a,b)=>{
      const ai=phaseOrder.indexOf(a[0]);
      const bi=phaseOrder.indexOf(b[0]);
      if(ai>=0&&bi>=0)return ai-bi;
      if(ai>=0)return -1;
      if(bi>=0)return 1;
      return a[0].localeCompare(b[0]);
    });

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

    res.json({phases:sortedPhases.map(([name,events])=>({name,events})),standings});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/soccer/:league/live',async(req,res)=>{
  try{
    const d=await fetch(`${ESPN}/soccer/${req.params.league}/scoreboard`,30000);
    res.json({events:(d?.events||[]).map(e=>normEvent(e,'',req.params.league)).filter(Boolean)});
  }catch(e){res.status(500).json({error:e.message});}
});

// Rosa — football-data.org (rosa completa)
// Strategia: cerca FD team ID per nome (name map hardcoded) poi fallback API
app.get('/sport/soccer/team/:id/roster',async(req,res)=>{
  try{
    const espnId=String(req.params.id);
    const name=(req.query.name||'').trim();

    // Se ID è sdb:XXXXX (squadra trovata via TheSportsDB), usa SDB per rosa
    if(espnId.startsWith('sdb:')){
      const sdbId=espnId.replace('sdb:','');
      try{
        const p=await sdb('/lookup_all_players.php?id='+sdbId,86400000);
        if((p?.player||[]).length>0){
          return res.json({player:(p.player||[]).map(pl=>({
            idPlayer:String(pl.idPlayer),strPlayer:pl.strPlayer||'',
            strPosition:mapPosition(pl.strPosition||''),
            strNationality:pl.strNationality||'',strNumber:pl.strNumber||'',
            strThumb:pl.strThumb||'',dateOfBirth:pl.dateBorn||'',
          }))});
        }
      }catch{}
      return res.json({player:[]});
    }

    // 1. Name map hardcoded (istantaneo)
    let fdId=null;
    const norm=normName(name);
    if(FD_NAME_MAP[norm]){
      fdId=FD_NAME_MAP[norm];
    } else {
      // match parziale: ogni parola significativa del nome
      const words=norm.split(' ').filter(w=>w.length>2);
      for(const [k,v] of Object.entries(FD_NAME_MAP)){
        if(words.some(w=>k===w||k.startsWith(w)||w.startsWith(k.split(' ')[0]))){
          fdId=v;break;
        }
      }
    }

    // 2. Fallback: cerca in tutte le competizioni FD per nome
    if(!fdId){
      const comps=['SA','CL','PD','PL','BL1','FL1','EL'];
      outer: for(const comp of comps){
        try{
          const d=await fd('/competitions/'+comp+'/teams',86400000);
          for(const t of(d?.teams||[])){
            const tn=normName(t.name);const ts=normName(t.shortName||'');
            const words=norm.split(' ').filter(w=>w.length>2);
            if(words.some(w=>tn.includes(w)||ts===w)){fdId=t.id;break outer;}
          }
        }catch{}
      }
    }

    // 3. Scarica rosa da FD
    if(fdId){
      try{
        const d=await fd('/teams/'+fdId,86400000);
        const squad=d?.squad||[];
        if(squad.length>0){
          return res.json({player:squad.map(p=>({
            idPlayer:String(p.id),
            strPlayer:p.name||'',
            strPosition:mapPosition(p.position||''),
            strNationality:p.nationality||'',
            strNumber:'',strThumb:'',
            dateOfBirth:p.dateOfBirth||'',
          }))});
        }
      }catch{}
    }

    // 4. Fallback TheSportsDB
    const sd=await sdb('/searchteams.php?t='+encodeURIComponent(name),3600000).catch(()=>null);
    const sdbTeams=(sd?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));
    if(sdbTeams.length>0){
      const p=await sdb('/lookup_all_players.php?id='+sdbTeams[0].idTeam,86400000).catch(()=>null);
      if((p?.player||[]).length>0)return res.json({player:p.player});
    }
    res.json({player:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// Mappa posizioni inglese FD → italiano
function mapPosition(p){
  const m={'Goalkeeper':'Portiere','Defence':'Difensore','Midfielder':'Centrocampista','Offence':'Attaccante','Defender':'Difensore','Forward':'Attaccante','Winger':'Ala','Attacking Midfield':'Trequartista','Central Midfield':'Centrocampista','Defensive Midfield':'Mediano','Left Back':'Terzino Sinistro','Right Back':'Terzino Destro','Centre-Back':'Difensore Centrale','Left Winger':'Ala Sinistra','Right Winger':'Ala Destra','Centre-Forward':'Centravanti','Second Striker':'Seconda Punta'};
  return m[p]||p;
}

// ══════════════════════════════════════════════════════════════════════════════
// BASKET
// ══════════════════════════════════════════════════════════════════════════════
const BBALL_LEAGUES=[{slug:'nba',name:'NBA'},{slug:'ita.lba',name:'Lega Basket'},{slug:'euroleague',name:'EuroLeague'}];
app.get('/sport/basketball/search',async(req,res)=>{
  try{
    const q=(req.query.q||'').toLowerCase().trim();if(q.length<2)return res.json({teams:[]});
    const seen=new Map();
    // ESPN /teams per ogni lega
    await Promise.all(BBALL_LEAGUES.map(async(lg)=>{
      try{
        const d=await fetch(`${ESPN}/basketball/${lg.slug}/teams`,86400000);
        for(const t of(d?.sports?.[0]?.leagues?.[0]?.teams||[])){
          const team=t.team;const dn=(team.displayName||'').toLowerCase();
          const sn=(team.shortDisplayName||'').toLowerCase();
          if(!dn.includes(q)&&!sn.includes(q))continue;
          if(!seen.has(dn))seen.set(dn,{id:String(team.id),name:team.displayName,shortName:team.shortDisplayName||team.displayName,league:lg.name,leagueSlug:lg.slug});
        }
      }catch{}
    }));
    // Se non trovato con ESPN /teams, cerca via scoreboard (Euroleague/LBA spesso non in /teams)
    if(seen.size===0){
      await Promise.all(BBALL_LEAGUES.map(async(lg)=>{
        try{
          const d=await fetch(`${ESPN}/basketball/${lg.slug}/scoreboard`,3600000);
          for(const e of(d?.events||[])){
            const comps=(e.competitions||[])[0]?.competitors||[];
            for(const c of comps){
              const team=c.team;
              const dn=(team?.displayName||'').toLowerCase();
              const sn=(team?.shortDisplayName||'').toLowerCase();
              if(!dn.includes(q)&&!sn.includes(q))continue;
              if(team?.id&&!seen.has(dn))seen.set(dn,{
                id:String(team.id),name:team.displayName,shortName:team.shortDisplayName||team.displayName,
                league:lg.name,leagueSlug:lg.slug,
              });
            }
          }
        }catch{}
      }));
    }
    // TheSportsDB — sempre, per coprire LBA/EuroLeague non in ESPN
    try{
      const d=await sdb(`/searchteams.php?t=${encodeURIComponent(q)}`,3600000);
      for(const t of(d?.teams||[])){
        const sport=(t.strSport||'').toLowerCase();
        if(!sport.includes('basketball')&&!sport.includes('basket'))continue;
        const dn=(t.strTeam||'').toLowerCase();
        if(!dn.includes(q)&&!(t.strTeamShort||'').toLowerCase().includes(q))continue;
        if(seen.has(dn))continue;
        const lg=(t.strLeague||'').toLowerCase();
        const slug=lg.includes('euroleague')?'euroleague':
                   lg.includes('eurocup')?'eurocup':
                   lg.includes('lba')||lg.includes('legabasket')||lg.includes('serie a')?'ita.lba':
                   lg.includes('nba')?'nba':'euroleague';
        seen.set(dn,{id:`sdb:${t.idTeam}`,name:t.strTeam,
          shortName:t.strTeamShort||t.strTeam,
          league:t.strLeague||'Basketball',leagueSlug:slug});
      }
    }catch{}
    res.json({teams:[...seen.values()]});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/sport/basketball/team/:league/:id/events',async(req,res)=>{
  try{
    const{league,id}=req.params;
    const allEvents=[];const seen=new Set();
    const now=new Date();
    const from=new Date(now.getTime()-120*864e5).toISOString().slice(0,10).replace(/-/g,'');
    const to=new Date(now.getTime()+90*864e5).toISOString().slice(0,10).replace(/-/g,'');

    // Se ID viene da TheSportsDB (sdb:XXXXX), usa SDB per eventi
    if(id.startsWith('sdb:')){
      const sdbId=id.replace('sdb:','');
      try{
        const[last,next]=await Promise.all([
          sdb(`/eventslast.php?id=${sdbId}`,1800000).catch(()=>null),
          sdb(`/eventsnext.php?id=${sdbId}`,1800000).catch(()=>null),
        ]);
        const past=(last?.results||last?.events||[]);
        const upcoming=(next?.events||[]);
        return res.json({events:[...past.map(e=>({
          id:String(e.idEvent),date:e.dateEvent?e.dateEvent+'T'+e.strTime:e.dateEvent||'',
          league:e.strLeague||'Basketball',leagueSlug:league,
          homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',
          homeScore:e.intHomeScore!=null?String(e.intHomeScore):'',
          awayScore:e.intAwayScore!=null?String(e.intAwayScore):'',
          homeId:'',awayId:'',completed:!!e.intHomeScore||e.strStatus==='Match Finished',
          live:false,clock:'',round:e.intRound?`Giornata ${e.intRound}`:'',
        })),...upcoming.map(e=>({
          id:String(e.idEvent),date:e.dateEvent?e.dateEvent+'T'+(e.strTime||'00:00:00'):e.dateEvent||'',
          league:e.strLeague||'Basketball',leagueSlug:league,
          homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',
          homeScore:'',awayScore:'',homeId:'',awayId:'',
          completed:false,live:false,clock:'',round:e.intRound?`Giornata ${e.intRound}`:'',
        }))]});
      }catch{}
      return res.json({events:[]});
    }

    // ID ESPN — usa schedule + scoreboard
    for(const lg of BBALL_LEAGUES){
      try{
        const d=await fetch(`${ESPN}/basketball/${lg.slug}/teams/${id}/schedule`,3600000);
        for(const e of(d?.events||[])){
          if(!e||e.$ref)continue;
          const ne=normEvent(e,lg.name,lg.slug);if(!ne||seen.has(ne.id))continue;
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}
    }
    // Scoreboard future per ogni lega
    for(const lg of BBALL_LEAGUES){
      try{
        const d=await fetch(`${ESPN}/basketball/${lg.slug}/scoreboard?dates=${from}-${to}`,300000);
        for(const e of(d?.events||[])){
          const ne=normEvent(e,lg.name,lg.slug);if(!ne||seen.has(ne.id))continue;
          if(ne.homeId!==id&&ne.awayId!==id)continue;
          seen.add(ne.id);allEvents.push(ne);
        }
      }catch{}
    }
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
// Parsa nota ESPN tennis: "(2) Jannik Sinner (ITA) bt Hugo Gaston (FRA) 6-2 6-1"
function parseTennisNote(note){
  if(!note)return null;
  const bt=note.match(/^(.+?)\s+(bt|d\.|leads|defeated|vs\.?)\s+(.+?)(\s+[\d\-\s()\/]+(?:ret)?)?$/i);
  if(!bt)return null;
  const clean=s=>s.replace(/^\(\d+\)\s*/,'').replace(/\s*\([A-Z]{2,3}\)$/,'').trim();
  const p1=clean(bt[1]);
  const p2=clean(bt[3]);
  const score=(bt[4]||'').trim();
  const verb=(bt[2]||'').toLowerCase();
  const completed=verb==='bt'||verb.startsWith('d')||verb==='defeated';
  return{p1,p2,score,completed};
}

app.get('/sport/tennis/player/:id/events',async(req,res)=>{
  try{
    const{id}=req.params;
    let past=[],upcoming=[];

    // Recupera nome giocatore da TheSportsDB
    const playerInfo=await sdb('/lookupplayer.php?id='+id,86400000).catch(()=>null);
    const playerName=(playerInfo?.players||playerInfo?.player||[])[0]?.strPlayer||'';
    const lastName=(playerName.split(' ').pop()||'').toLowerCase();

    if(lastName.length>2){
      const now=new Date();
      const fromPast=new Date(now-120*864e5).toISOString().slice(0,10).replace(/-/g,'');
      const toFuture=new Date(now.getTime()+90*864e5).toISOString().slice(0,10).replace(/-/g,'');
      for(const tour of['atp','wta']){
        try{
          const d=await fetch(`${ESPN}/tennis/${tour}/scoreboard?dates=${fromPast}-${toFuture}`,1800000).catch(()=>null);
          for(const ev of(d?.events||[])){
            const tournament=ev.shortName||ev.name||'';
            for(const grp of(ev.groupings||[])){
              const grouping=grp.grouping?.displayName||'';
              for(const comp of(grp.competitions||[])){
                const note=((comp.notes||[]).map(n=>n.text||'')).find(n=>n.toLowerCase().includes(lastName));
                if(!note)continue;
                const parsed=parseTennisNote(note);
                if(!parsed)continue;
                const dateStr=comp.date?comp.date.split('T')[0]:(ev.date?ev.date.split('T')[0]:'');
                const isCompleted=parsed.completed||(comp.status?.type?.completed===true);
                const isFuture=dateStr&&new Date(dateStr)>now;
                const entry={
                  idEvent:String(comp.id||ev.id),
                  strEvent:tournament,
                  strSubEvent:grouping,
                  strHomeTeam:parsed.p1,
                  strAwayTeam:parsed.p2,
                  strScore:parsed.score,
                  intHomeScore:null,intAwayScore:null,
                  dateEvent:dateStr,
                  strLeague:tournament,
                  strStatus:isCompleted?'Match Finished':'Scheduled',
                };
                if(isCompleted&&!isFuture)past.push(entry);
                else upcoming.push(entry);
              }
            }
          }
        }catch{}
      }
    }

    // Ordina per data
    past.sort((a,b)=>new Date(b.dateEvent)-new Date(a.dateEvent));
    upcoming.sort((a,b)=>new Date(a.dateEvent)-new Date(b.dateEvent));
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
    // ESPN usa ESPN2 (site.web.api.espn.com) per rankings
    const urls=[
      `https://site.web.api.espn.com/apis/v2/sports/tennis/${tour}/rankings?limit=100`,
      `${ESPN2}/tennis/${tour}/rankings?limit=100`,
      `${ESPN}/tennis/${tour}/rankings`,
    ];
    for(const url of urls){
      try{
        const d=await fetch(url,3600000);
        const entries=d?.rankings?.[0]?.entries||d?.entries||d?.athletes||[];
        if(entries.length>0){
          return res.json({rankings:entries.slice(0,100).map((e,i)=>({
            rank:e.currentRanking||e.ranking||i+1,
            name:e.athlete?.displayName||e.player?.displayName||e.team?.displayName||'',
            country:e.athlete?.flag?.alt||e.athlete?.country?.abbreviation||e.athlete?.nationality||'',
            points:e.rankingPoints||e.points||0,
            id:String(e.athlete?.id||e.player?.id||''),
          }))});
        }
      }catch{}
    }
    // Fallback: TheSportsDB top 50 per tour
    try{
      const leagueId=isWTA?'4303':'4302';
      const d=await sdb(`/lookup_all_players.php?id=${leagueId}`,86400000).catch(()=>null);
      if((d?.player||[]).length>0){
        return res.json({rankings:(d.player||[]).slice(0,50).map((p,i)=>({
          rank:i+1,name:p.strPlayer||'',
          country:p.strNationality||'',points:0,
          id:String(p.idPlayer||''),
        }))});
      }
    }catch{}
    res.json({rankings:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════════════════════════════════════
// F1
// ══════════════════════════════════════════════════════════════════════════════
const F1Y=new Date().getFullYear();
app.get('/sport/f1/calendar',async(req,res)=>{
  try{
    const cal=await ergast(`/${F1Y}`);
    const races=cal?.MRData?.RaceTable?.Races||[];
    const now=new Date();
    // Per le gare passate, aggiungi risultati (top 3)
    await Promise.all(races.map(async(race)=>{
      const raceDate=new Date(race.date);
      if(raceDate<now){
        try{
          const r=await ergast(`/${F1Y}/${race.round}/results`);
          race.Results=(r?.MRData?.RaceTable?.Races?.[0]?.Results||[]).slice(0,3);
        }catch{}
      }
    }));
    res.json(cal);
  }catch(e){res.status(500).json({error:e.message});}
});
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
// Struttura CONFERMATA:
// ! 1                                         ← round header con !
// | 1 March                                   ← data
// |{{flagicon|THA}} [[Thailand motorcycle Grand Prix|PT Grand Prix of Thailand]]
// |[[Chang International Circuit]], [[Buriram]]
// NOTA: i link GP NON contengono "2026", usano il nome generico
function parseMotoGPWikitext(wt){
  const year = new Date().getFullYear();
  const months = {january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12};

  // Trova la tabella calendario (dopo "provisionally scheduled")
  const anchor = wt.indexOf('provisionally scheduled');
  const tableStart = wt.indexOf('{| class="wikitable"', anchor >= 0 ? anchor : 0);
  if(tableStart < 0) return [];
  const tableEnd = wt.indexOf('\n|}', tableStart);
  const table = wt.slice(tableStart, tableEnd > 0 ? tableEnd + 3 : wt.length);

  // Split per separatore di riga |-
  const rowBlocks = table.split(/\n\|-\n/);
  const races = [];

  for(const block of rowBlocks){
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let round = null, dateISO = '', gpName = '', circuit = '', country = '';

    for(const line of lines){
      // Round: ! 1  (solo numero dopo !)
      if(!round){
        const rm = line.match(/^!\s*(\d+)\s*$/);
        if(rm){ round = parseInt(rm[1]); continue; }
      }

      // Data: | 1 March  o  | 22 March
      if(!dateISO){
        const dm = line.match(/^\|\s*(\d{1,2})(?:[–\-]\d{1,2})?\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i);
        if(dm){
          const mon = months[dm[2].toLowerCase()] || 1;
          dateISO = `${year}-${String(mon).padStart(2,'0')}-${String(parseInt(dm[1])).padStart(2,'0')}`;
          continue;
        }
      }

      // GP name: riga con flagicon — estrai testo dopo | nel link GP
      if(!gpName && line.includes('flagicon')){
        const flagM = line.match(/\{\{flagicon\|([^|}]+)/);
        if(flagM) country = flagM[1].trim();
        // Link: [[X motorcycle Grand Prix|Nome Sponsorizzato Grand Prix of Y]]
        // Vogliamo estrarre il paese/luogo dal nome generico del GP
        // Strategia: prendi il titolo del link (parte prima del |) e puliscilo
        const linkM = line.match(/\[\[([^\]|]+(?:motorcycle Grand Prix|Grand Prix)[^\]|]*)(?:\|([^\]]+))?\]\]/i);
        if(linkM){
          // Usa il titolo del link (linkM[1]) che è il nome generico
          // es: "Thailand motorcycle Grand Prix" → "GP Thailandia"
          let rawName = linkM[1].trim();
          // Rimuovi "motorcycle " e normalizza
          rawName = rawName
            .replace(/\s*motorcycle\s*/gi, ' ')
            .replace(/Grand Prix of the\s*/i, 'GP of the ')
            .replace(/\s*Grand Prix\s*$/i, ' GP')
            .replace(/^GP\s+/i, '')
            .replace(/\s+/g, ' ').trim();
          gpName = rawName;
        }
        continue;
      }

      // Circuito: riga con [[NomeCircuito]] senza flagicon
      if(!circuit && !line.includes('flagicon') && !line.includes('Grand Prix') && line.startsWith('|')){
        const cm = line.match(/\[\[([^\]|]{4,70})(?:\|[^\]]+)?\]\]/);
        if(cm && !cm[1].includes('Ref') && !cm[1].includes('List of')){
          circuit = cm[1].trim();
        }
      }
    }

    if(round && gpName){
      races.push({
        round,
        idEvent: `wiki_moto_${round}`,
        strEvent: gpName,
        strLeague: 'MotoGP',
        date: dateISO ? dateISO + 'T12:00:00Z' : '',
        dateEvent: dateISO,
        strVenue: circuit,
        strCountry: country,
      });
    }
  }

  races.sort((a,b) => a.round - b.round);
  return races;
}

// Calendario MotoGP 2026 hardcoded (Wikipedia bloccata da Render)
const MOTOGP_2026=[
  {round:1, strEvent:'Thai GP',       dateEvent:'2026-03-01',strVenue:'Chang International Circuit',           strCountry:'THA'},
  {round:2, strEvent:'Brazilian GP',  dateEvent:'2026-03-22',strVenue:'Autódromo Internacional Ayrton Senna', strCountry:'BRA'},
  {round:3, strEvent:'Americas GP',   dateEvent:'2026-03-29',strVenue:'Circuit of the Americas',               strCountry:'USA'},
  {round:4, strEvent:'Qatar GP',      dateEvent:'2026-04-12',strVenue:'Lusail International Circuit',          strCountry:'QAT'},
  {round:5, strEvent:'Spanish GP',    dateEvent:'2026-04-26',strVenue:'Circuito de Jerez – Ángel Nieto',       strCountry:'ESP'},
  {round:6, strEvent:'French GP',     dateEvent:'2026-05-10',strVenue:'Bugatti Circuit',                       strCountry:'FRA'},
  {round:7, strEvent:'Catalan GP',    dateEvent:'2026-05-17',strVenue:'Circuit de Barcelona-Catalunya',        strCountry:'CAT'},
  {round:8, strEvent:'Italian GP',    dateEvent:'2026-05-31',strVenue:'Autodromo Internazionale del Mugello',  strCountry:'ITA'},
  {round:9, strEvent:'German GP',     dateEvent:'2026-06-14',strVenue:'Sachsenring',                           strCountry:'GER'},
  {round:10,strEvent:'Dutch GP',      dateEvent:'2026-06-28',strVenue:'TT Circuit Assen',                      strCountry:'NED'},
  {round:11,strEvent:'Finnish GP',    dateEvent:'2026-07-05',strVenue:'KymiRing',                              strCountry:'FIN'},
  {round:12,strEvent:'British GP',    dateEvent:'2026-07-26',strVenue:'Silverstone Circuit',                   strCountry:'GBR'},
  {round:13,strEvent:'Austrian GP',   dateEvent:'2026-08-09',strVenue:'Red Bull Ring',                         strCountry:'AUT'},
  {round:14,strEvent:'Czech GP',      dateEvent:'2026-08-16',strVenue:'Automotodrom Brno',                     strCountry:'CZE'},
  {round:15,strEvent:'San Marino GP', dateEvent:'2026-09-06',strVenue:'Misano World Circuit',                  strCountry:'ITA'},
  {round:16,strEvent:'Aragon GP',     dateEvent:'2026-09-20',strVenue:'MotorLand Aragon',                      strCountry:'ESP'},
  {round:17,strEvent:'Japanese GP',   dateEvent:'2026-10-04',strVenue:'Twin Ring Motegi',                      strCountry:'JPN'},
  {round:18,strEvent:'Australian GP', dateEvent:'2026-10-18',strVenue:'Phillip Island Grand Prix Circuit',     strCountry:'AUS'},
  {round:19,strEvent:'Malaysian GP',  dateEvent:'2026-11-01',strVenue:'Sepang International Circuit',          strCountry:'MAS'},
  {round:20,strEvent:'Valencian GP',  dateEvent:'2026-11-15',strVenue:'Circuit Ricardo Tormo',                 strCountry:'ESP'},
].map(r=>({...r,strLeague:'MotoGP',idEvent:'moto2026_'+r.round}));

app.get('/sport/motogp/calendar',async(req,res)=>{
  const now=new Date();
  const past=MOTOGP_2026.filter(r=>new Date(r.dateEvent)<now);
  const upcoming=MOTOGP_2026.filter(r=>new Date(r.dateEvent)>=now);
  res.json({past,upcoming});
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

// ── CLASSIFICHE GENERALI — tutte le leghe principali ─────────────────────────
app.get('/sport/soccer/standings/all',async(req,res)=>{
  const leagues=[
    {slug:'ita.1',name:'Serie A'},
    {slug:'ita.2',name:'Serie B'},
    {slug:'uefa.champions',name:'Champions League'},
    {slug:'uefa.europa',name:'Europa League'},
    {slug:'esp.1',name:'La Liga'},
    {slug:'eng.1',name:'Premier League'},
    {slug:'ger.1',name:'Bundesliga'},
    {slug:'fra.1',name:'Ligue 1'},
  ];
  const results=await Promise.all(leagues.map(async(lg)=>{
    try{
      const yr=new Date().getFullYear();
      let entries=[];
      for(const y of[yr,yr-1]){
        for(const url of[
          `${ESPN2}/soccer/${lg.slug}/standings?season=${y}`,
          `${ESPN}/soccer/${lg.slug}/standings`,
        ]){
          try{
            const d=await fetch(url,3600000);
            for(const g of(d.children||[])){entries.push(...(g.standings?.entries||[]));}
            if(!entries.length)entries=d.standings?.entries||[];
            if(entries.length>0)break;
          }catch{}
          if(entries.length)break;
        }
        if(entries.length)break;
      }
      if(!entries.length)return null;
      return{
        slug:lg.slug,name:lg.name,
        standings:entries.map((e,i)=>{
          const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
          return{
            rank:Math.round(stats['rank']||i+1),
            name:e.team?.displayName||'',
            shortName:e.team?.shortDisplayName||e.team?.displayName||'',
            teamId:String(e.team?.id||''),
            logo:e.team?.logos?.[0]?.href||'',
            played:Math.round(stats['gamesPlayed']||0),
            wins:Math.round(stats['wins']||0),
            draws:Math.round(stats['ties']||stats['draws']||0),
            losses:Math.round(stats['losses']||0),
            points:Math.round(stats['points']||0),
            gd:Math.round(stats['pointDifferential']||0),
            gf:Math.round(stats['pointsFor']||stats['goalsScored']||0),
            ga:Math.round(stats['pointsAgainst']||stats['goalsConceded']||0),
          };
        }),
      };
    }catch{return null;}
  }));
  res.json({leagues:results.filter(Boolean)});
});

// ── CLASSIFICHE BASKET ────────────────────────────────────────────────────────
app.get('/sport/basketball/standings/all',async(req,res)=>{
  const leagues=[
    {slug:'ita.lba',name:'Lega Basket Serie A'},
    {slug:'euroleague',name:'EuroLeague'},
    {slug:'eurocup',name:'EuroCup'},
    {slug:'nba',name:'NBA'},
  ];
  const results=await Promise.all(leagues.map(async(lg)=>{
    try{
      const yr=new Date().getFullYear();
      let entries=[];
      for(const y of[yr,yr-1]){
        for(const url of[
          `${ESPN2}/basketball/${lg.slug}/standings?season=${y}`,
          `${ESPN}/basketball/${lg.slug}/standings`,
        ]){
          try{
            const d=await fetch(url,3600000);
            for(const g of(d?.children||[])){entries.push(...(g.standings?.entries||[]));}
            if(!entries.length)entries=d?.standings?.entries||[];
            if(entries.length)break;
          }catch{}
          if(entries.length)break;
        }
        if(entries.length)break;
      }
      if(!entries.length)return null;
      return{
        slug:lg.slug,name:lg.name,
        standings:entries.map((e,i)=>{
          const stats={};for(const s of(e.stats||[])){stats[s.name]=s.value;}
          return{
            rank:Math.round(stats['rank']||i+1),
            name:e.team?.displayName||'',
            shortName:e.team?.shortDisplayName||e.team?.displayName||'',
            teamId:String(e.team?.id||''),
            logo:e.team?.logos?.[0]?.href||'',
            played:Math.round(stats['gamesPlayed']||0),
            wins:Math.round(stats['wins']||0),
            losses:Math.round(stats['losses']||0),
            points:Math.round(stats['points']||stats['winPercent']||0),
            pct:stats['winPercent']?Math.round(stats['winPercent']*1000)/10:null,
          };
        }),
      };
    }catch{return null;}
  }));
  res.json({leagues:results.filter(Boolean)});
});

// ── TABELLONE COPPE (partite per fase) ────────────────────────────────────────
const CUP_LEAGUES=[
  // Coppe europee
  {slug:'uefa.champions',   name:'Champions League',    fd:'CL',   group:'Europa'},
  {slug:'uefa.europa',      name:'Europa League',       fd:'EL',   group:'Europa'},
  {slug:'uefa.conference',  name:'Conference League',   fd:'ECSL', group:'Europa'},
  {slug:'uefa.super_cup',   name:'UEFA Super Cup',      fd:null,   group:'Europa'},
  // Coppe italiane
  {slug:'ita.coppa_italia', name:'Coppa Italia',        fd:null,   group:'Italia'},
  {slug:'ita.super_cup',    name:'Supercoppa Italiana', fd:null,   group:'Italia'},
  // Coppe straniere
  {slug:'esp.copa_del_rey', name:'Copa del Rey',        fd:null,   group:'Estero'},
  {slug:'esp.super_cup',    name:'Supercoppa Spagnola', fd:null,   group:'Estero'},
  {slug:'eng.fa',           name:'FA Cup',              fd:'FAC',  group:'Estero'},
  {slug:'ger.dfb_pokal',    name:'DFB Pokal',           fd:'DFB',  group:'Estero'},
  {slug:'fra.coupe_de_france',name:'Coupe de France',   fd:'CDF',  group:'Estero'},
];

app.get('/sport/soccer/cups',async(req,res)=>{
  try{
    // Stagione 2025/26: tre chunk da 90 giorni (ESPN max ~90gg per range)
    const now=new Date();
    const yyyymmdd=d=>d.toISOString().slice(0,10).replace(/-/g,'');
    const ranges=[
      `20250801-20251030`,  // Fase a gironi / qualificazioni
      `20251030-20260131`,  // Ottavi / quarti invernali
      `${yyyymmdd(new Date(now.getTime()-30*864e5))}-${yyyymmdd(new Date(now.getTime()+90*864e5))}`, // recente + prossimi 3 mesi
    ];
    const results=[];
    for(const lg of CUP_LEAGUES){
      const events=[];const seen=new Set();
      for(const dateRange of ranges){
        try{
          const d=await fetch(`${ESPN}/soccer/${lg.slug}/scoreboard?dates=${dateRange}`,7200000);
          const rawEvs=d?.events||[];
          for(const e of rawEvs){
            const ne=normEvent(e,lg.name,lg.slug);
            if(!ne||seen.has(ne.id))continue;
            const comp=(e.competitions||[])[0]||{};
            const hl=comp.notes?.[0]?.headline||comp.type?.text||'';
            ne.round=hl?mapPhaseESPN(hl):'';
            seen.add(ne.id);events.push(ne);
          }
        }catch{}
      }
      // football-data fallback per Conference + coppe con fd e pochi eventi ESPN
      if(lg.fd&&(events.length<3||lg.slug==='uefa.conference')){
        try{
          const yr=new Date().getFullYear();
          const d=await fd(`/competitions/${lg.fd}/matches?season=${yr-1}`,7200000).catch(()=>null);
          for(const m of(d?.matches||[])){
            const eid=`fd:${m.id}`;if(seen.has(eid))continue;seen.add(eid);
            events.push({
              id:eid,date:m.utcDate||'',league:lg.name,leagueSlug:lg.slug,
              homeName:m.homeTeam?.shortName||m.homeTeam?.name||'',
              awayName:m.awayTeam?.shortName||m.awayTeam?.name||'',
              homeScore:m.score?.fullTime?.home!=null?String(m.score.fullTime.home):'',
              awayScore:m.score?.fullTime?.away!=null?String(m.score.fullTime.away):'',
              homeId:'',awayId:'',completed:m.status==='FINISHED',live:false,clock:'',
              round:mapStage(m.stage||''),statusDetail:'',
            });
          }
        }catch{}
      }
      if(events.length===0)continue;
      events.sort((a,b)=>new Date(a.date)-new Date(b.date));
      const phaseMap=new Map();
      for(const e of events){
        const ph=e.round||'Partite';
        if(!phaseMap.has(ph))phaseMap.set(ph,[]);
        phaseMap.get(ph).push(e);
      }
      const phaseOrder=['Qualificazioni','Fase a Gironi','Playoff','Sedicesimi di Finale',
        'Ottavi di Finale','Quarti di Finale','Semifinale','Andata','Ritorno','Finale',
        'Fase a Eliminazione','Fase Knockout','Partite'];
      const phases=[...phaseMap.entries()]
        .sort((a,b)=>{const ai=phaseOrder.indexOf(a[0]),bi=phaseOrder.indexOf(b[0]);
          return ai>=0&&bi>=0?ai-bi:ai>=0?-1:bi>=0?1:0;})
        .map(([name,evs])=>({name,events:evs}));
      results.push({slug:lg.slug,name:lg.name,group:lg.group,phases,totalEvents:events.length});
    }
    res.json({cups:results});
  }catch(e){res.status(500).json({error:e.message});}
});

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Proxy porta ${PORT}`));
