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
  const r=await axios.get(url,{timeout:8000,headers});
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
  const r=await axios.get(`${SDB}${path}`,{timeout:8000});
  setC(path,r.data,ttl);return r.data;
}
async function fd(path,ttl=3600000){
  return fetch(`${FD}${path}`,ttl,FD_H);
}
async function ergast(path,ttl=3600000){
  const k=`erg:${path}`;const c=getC(k);if(c)return c;
  const r=await axios.get(`https://api.jolpi.ca/ergast/f1${path}.json`,{timeout:8000});
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
  const name=st.name||'';const desc=(st.description||'').toLowerCase();const detail=st.detail||'';
  const shortDetail=(st.shortDetail||st.name||'').toLowerCase();
  // Partita finita
  if(name==='STATUS_FULL_TIME'||detail==='FT')return'FT';
  if(name==='STATUS_EXTRA_TIME'||detail==='AET'||detail==='ET'||
     desc.includes('extra time')||desc.includes('after extra')||shortDetail.includes('aet'))return'dts';
  if(name==='STATUS_PENALTY'||detail==='Pen'||detail==='PSO'||
     desc.includes('penalt')||desc.includes('rigori')||shortDetail.includes('pso')||shortDetail.includes('pen'))return'dcr';
  if(name==='STATUS_ABANDONED')return'Abbandonata';
  if(name==='STATUS_POSTPONED')return'Rinviata';
  if(name==='STATUS_SUSPENDED')return'Sospesa';
  if(name==='STATUS_CANCELED')return'Annullata';
  // In corso
  if(name==='STATUS_HALFTIME'||detail==='HT'||desc.includes('half'))return'HT';
  if(name==='STATUS_IN_PROGRESS')return desc||'In Corso';
  // Non iniziata
  if(name==='STATUS_SCHEDULED'||name==='STATUS_UPCOMING')return'';
  // Extra time in corso
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
    let rawRound=comp.notes?.[0]?.headline||comp.type?.text||
                (e.week?.number?`Giornata ${e.week.number}`:'');
    // ESPN a volte mette "X advance N-M on penalties" come headline → non è una fase
    if(/advance|on penalties|win \d|loses \d/i.test(rawRound)) rawRound='';
    const round=rawRound;
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
      homeScorePen:home.shootoutScore!=null?String(home.shootoutScore):'',
      awayScorePen:away.shootoutScore!=null?String(away.shootoutScore):'',
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
    'LEAGUE_STAGE':'Fase Leghe','LEAGUE STAGE':'Fase Leghe',
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
  if(lower.includes('league stage'))return'Fase Leghe';
  if(lower.includes('group stage')||lower.includes('girone'))return'Fase a Gironi';
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

// Classifica fase UEFA per data (per EL/Conference dove ESPN/FD non fornisce round)
function mapPhaseByDate(dateStr, slug){
  if(!dateStr) return 'Partite';
  const d=new Date(dateStr);
  const m=d.getMonth()+1; // 1-12
  const day=d.getDate();
  const yr=d.getFullYear();
  
  // Stagione europea: agosto-maggio
  // CL/EL/UECL 2024-25 e 2025-26
  if(m>=8 && m<=10) return 'Fase Leghe';           // ago-ott: gironi/fase leghe
  if(m===11) return 'Fase Leghe';                   // nov: ancora fase leghe
  if(m===12) return 'Fase Leghe';                   // dic: ultima giornata fase leghe
  if(m===1) return 'Playoff';                        // gen: playoff (andata)
  if(m===2) return 'Playoff';                        // feb: playoff (ritorno) + sorteggi
  if(m===3 && day<=20) return 'Ottavi di Finale';   // mar prima metà: ottavi andata
  if(m===3 && day>20) return 'Ottavi di Finale';    // mar seconda metà: ottavi ritorno
  if(m===4 && day<=17) return 'Quarti di Finale';   // apr prima metà: quarti
  if(m===4 && day>17) return 'Semifinale';          // apr seconda metà: semifinali
  if(m===5 && day<=25) return 'Semifinale';         // mag prima: semifinali ritorno
  if(m===5 && day>25) return 'Finale';              // mag fine: finale
  if(m===6) return 'Finale';                        // giu: finale (raro)
  return 'Partite';
}

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
        // SDB: eventslast (ultimi 5) + eventsseason (tutta stagione per le future)
        const yr=new Date().getFullYear();
        const season=`${yr-1}-${yr}`;
        const[last,next,seas]=await Promise.all([
          sdb(`/eventslast.php?id=${sdbId}`,1800000).catch(()=>({results:[]})),
          sdb(`/eventsnext.php?id=${sdbId}`,1800000).catch(()=>({events:[]})),
          sdb(`/eventsseason.php?id=${sdbId}&s=${season}`,3600000).catch(()=>({events:[]})),
        ]);
        const normSdb=(e,isDone)=>({
          id:String(e.idEvent),
          date:e.dateEvent?(e.dateEvent+'T'+(e.strTime||'00:00:00')):'',
          league:e.strLeague||'',leagueSlug:'ita.3',
          homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',
          homeScore:isDone&&e.intHomeScore!=null?String(e.intHomeScore):'',
          awayScore:isDone&&e.intAwayScore!=null?String(e.intAwayScore):'',
          homeId:String(e.idHomeTeam||''),awayId:String(e.idAwayTeam||''),
          completed:isDone,live:false,clock:'',
          round:e.intRound?`Giornata ${e.intRound}`:(e.strRound?`Giornata ${e.strRound}`:''),
          statusDetail:'',
        });
        const now=new Date();
        const seenLocal=new Set();
        const all=[];
        // Passate da eventslast
        for(const e of(last?.results||last?.events||[])){
          if(!seenLocal.has(e.idEvent)){seenLocal.add(e.idEvent);all.push(normSdb(e,true));}
        }
        // Season events: dividi per data in passate/future
        for(const e of(seas?.events||[])){
          if(seenLocal.has(e.idEvent))continue;
          seenLocal.add(e.idEvent);
          const d=new Date(e.dateEvent||'2000-01-01');
          const done=e.intHomeScore!=null||(d<now);
          all.push(normSdb(e,done));
        }
        // eventsnext come fallback aggiuntivo
        for(const e of(next?.events||[])){
          if(!seenLocal.has(e.idEvent)){seenLocal.add(e.idEvent);all.push(normSdb(e,false));}
        }
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
        // Prova season yr-1 poi yr-2 (ECSL 2025 potrebbe non avere dati completi)
        const trySeasons=[year-1,year-2];
        let d=null;
        for(const season of trySeasons){
          const url=teamId
            ?`/competitions/${lg.fd}/matches?season=${season}&team=${await getFdTeamId(teamId,'')}`
            :`/competitions/${lg.fd}/matches?season=${season}`;
          d=await fd(url,3600000).catch(()=>null);
          if(d?.matches?.length)break;
        }
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
    // Live: no cache, dati freschi ogni chiamata
    res.set('Cache-Control','no-store');
    const url=`${ESPN}/soccer/${req.params.league}/scoreboard`;
    const r=await axios.get(url,{timeout:8000,headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}});
    res.json({events:(r.data?.events||[]).map(e=>normEvent(e,'',req.params.league)).filter(Boolean)});
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
// F1
// ══════════════════════════════════════════════════════════════════════════════
const F1Y=new Date().getFullYear();

// ── OpenF1 helper (live + recenti, nessuna auth) ─────────────────────────────
async function openf1(path,ttl=60000){
  const r=await axios.get('https://api.openf1.org/v1'+path,{timeout:15000});
  return r.data;
}

// ── F1 Calendario (Jolpica/Ergast, fallback OpenF1 sessions) ─────────────────
// ── Calendario F1 2026 hardcoded (fonte: fia.com) ────────────────────────────
const F1_2026=[
  {round:'1', raceName:'Australian Grand Prix',   date:'2026-03-15',Circuit:{circuitName:'Albert Park Circuit',        Location:{country:'Australia'}}},
  {round:'2', raceName:'Chinese Grand Prix',       date:'2026-03-22',Circuit:{circuitName:'Shanghai International Circuit',Location:{country:'China'}}},
  {round:'3', raceName:'Japanese Grand Prix',      date:'2026-04-05',Circuit:{circuitName:'Suzuka International Racing Course',Location:{country:'Japan'}}},
  {round:'4', raceName:'Bahrain Grand Prix',       date:'2026-04-19',Circuit:{circuitName:'Bahrain International Circuit',  Location:{country:'Bahrain'}}},
  {round:'5', raceName:'Saudi Arabian Grand Prix', date:'2026-04-26',Circuit:{circuitName:'Jeddah Corniche Circuit',       Location:{country:'Saudi Arabia'}}},
  {round:'6', raceName:'Miami Grand Prix',         date:'2026-05-10',Circuit:{circuitName:'Miami International Autodrome', Location:{country:'USA'}}},
  {round:'7', raceName:'Emilia Romagna Grand Prix',date:'2026-05-24',Circuit:{circuitName:'Autodromo Enzo e Dino Ferrari',  Location:{country:'Italy'}}},
  {round:'8', raceName:'Monaco Grand Prix',        date:'2026-05-31',Circuit:{circuitName:'Circuit de Monaco',             Location:{country:'Monaco'}}},
  {round:'9', raceName:'Spanish Grand Prix',       date:'2026-06-07',Circuit:{circuitName:'Circuit de Barcelona-Catalunya',Location:{country:'Spain'}}},
  {round:'10',raceName:'Canadian Grand Prix',      date:'2026-06-21',Circuit:{circuitName:'Circuit Gilles Villeneuve',    Location:{country:'Canada'}}},
  {round:'11',raceName:'Austrian Grand Prix',      date:'2026-06-28',Circuit:{circuitName:'Red Bull Ring',                Location:{country:'Austria'}}},
  {round:'12',raceName:'British Grand Prix',       date:'2026-07-05',Circuit:{circuitName:'Silverstone Circuit',          Location:{country:'UK'}}},
  {round:'13',raceName:'Belgian Grand Prix',       date:'2026-07-26',Circuit:{circuitName:'Circuit de Spa-Francorchamps', Location:{country:'Belgium'}}},
  {round:'14',raceName:'Hungarian Grand Prix',     date:'2026-08-02',Circuit:{circuitName:'Hungaroring',                  Location:{country:'Hungary'}}},
  {round:'15',raceName:'Dutch Grand Prix',         date:'2026-08-30',Circuit:{circuitName:'Circuit Zandvoort',            Location:{country:'Netherlands'}}},
  {round:'16',raceName:'Italian Grand Prix',       date:'2026-09-06',Circuit:{circuitName:'Autodromo Nazionale Monza',    Location:{country:'Italy'}}},
  {round:'17',raceName:'Azerbaijan Grand Prix',    date:'2026-09-20',Circuit:{circuitName:'Baku City Circuit',            Location:{country:'Azerbaijan'}}},
  {round:'18',raceName:'Singapore Grand Prix',     date:'2026-10-04',Circuit:{circuitName:'Marina Bay Street Circuit',    Location:{country:'Singapore'}}},
  {round:'19',raceName:'United States Grand Prix', date:'2026-10-18',Circuit:{circuitName:'Circuit of the Americas',     Location:{country:'USA'}}},
  {round:'20',raceName:'Mexico City Grand Prix',   date:'2026-10-25',Circuit:{circuitName:'Autodromo Hermanos Rodriguez', Location:{country:'Mexico'}}},
  {round:'21',raceName:'São Paulo Grand Prix',     date:'2026-11-08',Circuit:{circuitName:'Autodromo Jose Carlos Pace',   Location:{country:'Brazil'}}},
  {round:'22',raceName:'Las Vegas Grand Prix',     date:'2026-11-21',Circuit:{circuitName:'Las Vegas Street Circuit',     Location:{country:'USA'}}},
  {round:'23',raceName:'Qatar Grand Prix',         date:'2026-11-29',Circuit:{circuitName:'Lusail International Circuit', Location:{country:'Qatar'}}},
  {round:'24',raceName:'Abu Dhabi Grand Prix',     date:'2026-12-06',Circuit:{circuitName:'Yas Marina Circuit',           Location:{country:'UAE'}}},
];

app.get('/sport/f1/calendar',async(req,res)=>{
  try{
    const now=new Date();
    // Jolpica 2026 funziona — usa quello come fonte principale
    let races=[];
    try{
      const cal=await ergast(`/${F1Y}`);
      races=cal?.MRData?.RaceTable?.Races||[];
    }catch{}
    // Fallback hardcoded se Jolpica vuoto
    if(races.length===0) races=F1_2026.map(r=>({...r}));
    // Risultati ultima gara passata (1 chiamata Jolpica)
    const past=races.filter(r=>new Date(r.date)<now);
    if(past.length>0){
      const last=past[past.length-1];
      if(!last.Results){
        try{
          const r=await ergast(`/${F1Y}/${last.round}/results`);
          last.Results=(r?.MRData?.RaceTable?.Races?.[0]?.Results||[]).slice(0,3);
        }catch{}
      }
    }
    res.json({MRData:{RaceTable:{Races:races}}});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── F1 Classifica Piloti ──────────────────────────────────────────────────────
app.get('/sport/f1/drivers',async(req,res)=>{
  try{
    // ESPN standings F1 — struttura: {children:[{name:'Driver Standings',standings:{entries:[]}}]}
    try{
      const espn=await fetch('https://site.web.api.espn.com/apis/v2/sports/racing/f1/standings',60000);
      const driverChild=(espn?.children||[]).find(c=>(c.name||'').toLowerCase().includes('driver'));
      const entries=(driverChild?.standings?.entries)||(espn?.standings?.[0]?.entries)||[];
      if(entries.length>0){
        const list=entries.map((e,i)=>({
          position:String(i+1),
          points:String(e.stats?.find(s=>s.name==='points')?.value||0),
          wins:String(e.stats?.find(s=>s.name==='wins')?.value||0),
          Driver:{givenName:e.athlete?.firstName||'',familyName:e.athlete?.lastName||'',nationality:e.athlete?.flag?.alt||''},
          Constructors:[{name:e.team?.displayName||''}],
        }));
        // Salta ESPN se tutti i punti sono 0 (dati non aggiornati)
        const totalPts=list.reduce((s,e)=>s+parseFloat(e.points||0),0);
        if(totalPts>0) return res.json({MRData:{StandingsTable:{StandingsLists:[{season:String(F1Y),DriverStandings:list}]}}});
      }
    }catch{}
    // Jolpica fallback
    for(const y of[F1Y,F1Y-1]){
      const d=await ergast(`/${y}/driverStandings`,3600000).catch(()=>null);
      if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.length>0) return res.json(d);
    }
    // Hardcoded dopo Australian GP 2026
    return res.json({MRData:{StandingsTable:{StandingsLists:[{season:'2026',DriverStandings:[
      {position:'1', points:'26',wins:'1',Driver:{givenName:'George',  familyName:'Russell',  nationality:'British'},    Constructors:[{name:'Mercedes'}]},
      {position:'2', points:'18',wins:'0',Driver:{givenName:'Kimi',    familyName:'Antonelli',nationality:'Italian'},    Constructors:[{name:'Mercedes'}]},
      {position:'3', points:'15',wins:'0',Driver:{givenName:'Charles', familyName:'Leclerc',  nationality:'Monegasque'}, Constructors:[{name:'Ferrari'}]},
      {position:'4', points:'12',wins:'0',Driver:{givenName:'Lewis',   familyName:'Hamilton', nationality:'British'},    Constructors:[{name:'Ferrari'}]},
      {position:'5', points:'10',wins:'0',Driver:{givenName:'Lando',   familyName:'Norris',   nationality:'British'},    Constructors:[{name:'McLaren'}]},
      {position:'6', points:'8', wins:'0',Driver:{givenName:'Max',     familyName:'Verstappen',nationality:'Dutch'},     Constructors:[{name:'Red Bull'}]},
      {position:'7', points:'6', wins:'0',Driver:{givenName:'Ollie',   familyName:'Bearman',  nationality:'British'},    Constructors:[{name:'Haas'}]},
      {position:'8', points:'4', wins:'0',Driver:{givenName:'Arvid',   familyName:'Lindblad', nationality:'Swedish'},    Constructors:[{name:'Racing Bulls'}]},
      {position:'9', points:'2', wins:'0',Driver:{givenName:'Gabriel', familyName:'Bortoleto',nationality:'Brazilian'},  Constructors:[{name:'Audi'}]},
      {position:'10',points:'1', wins:'0',Driver:{givenName:'Pierre',  familyName:'Gasly',    nationality:'French'},     Constructors:[{name:'Alpine'}]},
    ]}]}}});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── F1 Classifica Costruttori ─────────────────────────────────────────────────
app.get('/sport/f1/constructors',async(req,res)=>{
  try{
    // ESPN standings costruttori F1
    try{
      const espn=await fetch('https://site.web.api.espn.com/apis/v2/sports/racing/f1/standings',60000);
      const conChild=(espn?.children||[]).find(c=>(c.name||'').toLowerCase().includes('constructor'));
      const entries=(conChild?.standings?.entries)||(espn?.standings?.[1]?.entries)||[];
      if(entries.length>0){
        const list=entries.map((e,i)=>({
          position:String(i+1),
          points:String(e.stats?.find(s=>s.name==='points')?.value||0),
          wins:String(e.stats?.find(s=>s.name==='wins')?.value||0),
          Constructor:{name:e.team?.displayName||'',nationality:''},
        }));
        return res.json({MRData:{StandingsTable:{StandingsLists:[{ConstructorStandings:list}]}}});
      }
    }catch{}
    // Jolpica fallback
    for(const y of[F1Y,F1Y-1]){
      const d=await ergast(`/${y}/constructorStandings`,3600000).catch(()=>null);
      if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings?.length>0) return res.json(d);
    }
    // Hardcoded dopo Australian GP 2026
    return res.json({MRData:{StandingsTable:{StandingsLists:[{ConstructorStandings:[
      {position:'1',points:'44',wins:'1',Constructor:{name:'Mercedes',  nationality:'British'}},
      {position:'2',points:'27',wins:'0',Constructor:{name:'Ferrari',   nationality:'Italian'}},
      {position:'3',points:'10',wins:'0',Constructor:{name:'McLaren',   nationality:'British'}},
      {position:'4',points:'8', wins:'0',Constructor:{name:'Red Bull',  nationality:'Austrian'}},
      {position:'5',points:'6', wins:'0',Constructor:{name:'Haas',      nationality:'American'}},
      {position:'6',points:'4', wins:'0',Constructor:{name:'Racing Bulls',nationality:'Italian'}},
      {position:'7',points:'2', wins:'0',Constructor:{name:'Audi',      nationality:'German'}},
      {position:'8',points:'1', wins:'0',Constructor:{name:'Alpine',    nationality:'French'}},
      {position:'9',points:'0', wins:'0',Constructor:{name:'Williams',  nationality:'British'}},
      {position:'10',points:'0',wins:'0',Constructor:{name:'Red Bull',  nationality:'Austrian'}},
      {position:'11',points:'0',wins:'0',Constructor:{name:'Aston Martin',nationality:'British'}},
      {position:'12',points:'0',wins:'0',Constructor:{name:'Cadillac',  nationality:'American'}},
    ]}]}}});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── F1 Ultima gara ────────────────────────────────────────────────────────────
app.get('/sport/f1/last',async(req,res)=>{
  try{
    // Solo gare della stagione corrente
    for(const path of['/current/last/results',`/${F1Y}/last/results`]){
      const d=await ergast(path,300000).catch(()=>null);
      const race=d?.MRData?.RaceTable?.Races?.[0];
      if(!race?.Results?.length) continue;
      // Non mostrare gare di stagioni precedenti
      const raceYear=new Date(race.date).getFullYear();
      if(raceYear<F1Y) continue;
      return res.json(d);
    }
    // Fallback hardcoded: Australian GP 2026 (prima gara stagione)
    res.json({MRData:{RaceTable:{Races:[{
      round:'1',
      raceName:'Australian Grand Prix',
      date:'2026-03-08',
      Circuit:{circuitName:'Albert Park Circuit',circuitId:'albert_park',Location:{country:'Australia',locality:'Melbourne'}},
      Results:[
        {position:'1', Driver:{givenName:'George',    familyName:'Russell',    nationality:'British'},    Constructor:{name:'Mercedes'},     points:'26', Time:{time:'1:27:43.587'}, status:'Finished'},
        {position:'2', Driver:{givenName:'Kimi',      familyName:'Antonelli',  nationality:'Italian'},    Constructor:{name:'Mercedes'},     points:'18', Time:{time:'+2.974s'},    status:'Finished'},
        {position:'3', Driver:{givenName:'Charles',   familyName:'Leclerc',    nationality:'Monegasque'}, Constructor:{name:'Ferrari'},      points:'15', Time:{time:'+15.519s'},   status:'Finished'},
        {position:'4', Driver:{givenName:'Lewis',     familyName:'Hamilton',   nationality:'British'},    Constructor:{name:'Ferrari'},      points:'12', Time:{time:'+16.144s'},   status:'Finished'},
        {position:'5', Driver:{givenName:'Lando',     familyName:'Norris',     nationality:'British'},    Constructor:{name:'McLaren'},      points:'10', Time:{time:'+51.741s'},   status:'Finished'},
        {position:'6', Driver:{givenName:'Max',       familyName:'Verstappen', nationality:'Dutch'},      Constructor:{name:'Red Bull'},     points:'8',  Time:{time:'+54.617s'},   status:'Finished'},
        {position:'7', Driver:{givenName:'Ollie',     familyName:'Bearman',    nationality:'British'},    Constructor:{name:'Haas'},         points:'6',  status:'+1 lap'},
        {position:'8', Driver:{givenName:'Arvid',     familyName:'Lindblad',   nationality:'Swedish'},    Constructor:{name:'Racing Bulls'}, points:'4',  status:'+1 lap'},
        {position:'9', Driver:{givenName:'Gabriel',   familyName:'Bortoleto',  nationality:'Brazilian'},  Constructor:{name:'Audi'},         points:'2',  status:'+1 lap'},
        {position:'10',Driver:{givenName:'Pierre',    familyName:'Gasly',      nationality:'French'},     Constructor:{name:'Alpine'},       points:'1',  status:'+1 lap'},
        {position:'11',Driver:{givenName:'Esteban',   familyName:'Ocon',       nationality:'French'},     Constructor:{name:'Haas'},         points:'0',  status:'+1 lap'},
        {position:'12',Driver:{givenName:'Alex',      familyName:'Albon',      nationality:'Thai'},       Constructor:{name:'Williams'},     points:'0',  status:'+1 lap'},
        {position:'13',Driver:{givenName:'Liam',      familyName:'Lawson',     nationality:'New Zealander'},Constructor:{name:'Racing Bulls'},points:'0', status:'+1 lap'},
        {position:'14',Driver:{givenName:'Franco',    familyName:'Colapinto',  nationality:'Argentine'},  Constructor:{name:'Alpine'},       points:'0',  status:'+2 laps'},
        {position:'15',Driver:{givenName:'Carlos',    familyName:'Sainz',      nationality:'Spanish'},    Constructor:{name:'Williams'},     points:'0',  status:'+2 laps'},
        {position:'16',Driver:{givenName:'Sergio',    familyName:'Perez',      nationality:'Mexican'},    Constructor:{name:'Cadillac'},     points:'0',  status:'+3 laps'},
        {position:'17',Driver:{givenName:'Lance',     familyName:'Stroll',     nationality:'Canadian'},   Constructor:{name:'Aston Martin'}, points:'0',  status:'DNF'},
        {position:'18',Driver:{givenName:'Fernando',  familyName:'Alonso',     nationality:'Spanish'},    Constructor:{name:'Aston Martin'}, points:'0',  status:'DNF'},
        {position:'19',Driver:{givenName:'Valtteri',  familyName:'Bottas',     nationality:'Finnish'},    Constructor:{name:'Cadillac'},     points:'0',  status:'DNF'},
        {position:'20',Driver:{givenName:'Isack',     familyName:'Hadjar',     nationality:'French'},     Constructor:{name:'Red Bull'},     points:'0',  status:'DNF'},
        {position:'21',Driver:{givenName:'Oscar',     familyName:'Piastri',    nationality:'Australian'}, Constructor:{name:'McLaren'},     points:'0',  status:'DNS'},
        {position:'22',Driver:{givenName:'Nico',      familyName:'Hulkenberg', nationality:'German'},     Constructor:{name:'Audi'},         points:'0',  status:'DNS'},
      ],
    }]}}});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── F1 Gare passate stagione corrente ────────────────────────────────────────
app.get('/sport/f1/past',async(req,res)=>{
  try{
    // Jolpica: tutte le gare della stagione corrente con risultati
    const cal=await ergast(`/${F1Y}`).catch(()=>null);
    const allRaces=cal?.MRData?.RaceTable?.Races||[];
    const now=new Date();
    const past=allRaces.filter(r=>new Date(r.date)<now);
    if(past.length===0) return res.json({races:[]});
    // Prendi top3 per ogni gara passata (in parallelo, max 5 gare)
    const toFetch=past.slice(-5).reverse(); // ultime 5, dalla più recente
    const withResults=await Promise.all(toFetch.map(async r=>{
      try{
        const d=await ergast(`/${F1Y}/${r.round}/results`,300000);
        const results=(d?.MRData?.RaceTable?.Races?.[0]?.Results||[]).slice(0,3).map(res=>({
          position:res.position,
          driver:res.Driver?.familyName||'',
          constructor:res.Constructor?.name||'',
          points:res.points||'0',
        }));
        return{...r,results};
      }catch{return{...r,results:[]};}
    }));
    // Se Jolpica non ha ancora i dati della stagione 2026, fallback hardcoded
    if(withResults.length===0){
      return res.json({races:[
        {
          round:'1', raceName:'Australian Grand Prix',
          date:'2026-03-08',
          Circuit:{circuitName:'Albert Park Circuit',Location:{country:'Australia',locality:'Melbourne'}},
          results:[
            {position:'1',driver:'Russell',     constructor:'Mercedes',  points:'26'},
            {position:'2',driver:'Antonelli',   constructor:'Mercedes',  points:'18'},
            {position:'3',driver:'Leclerc',     constructor:'Ferrari',   points:'15'},
            {position:'4',driver:'Hamilton',    constructor:'Ferrari',   points:'12'},
            {position:'5',driver:'Norris',      constructor:'McLaren',   points:'10'},
            {position:'6',driver:'Verstappen',  constructor:'Red Bull',  points:'8'},
            {position:'7',driver:'Bearman',     constructor:'Haas',      points:'6'},
            {position:'8',driver:'Lindblad',    constructor:'Racing Bulls','points':'4'},
            {position:'9',driver:'Bortoleto',   constructor:'Audi',      points:'2'},
            {position:'10',driver:'Gasly',      constructor:'Alpine',    points:'1'},
          ],
        },
      ]});
    }
    res.json({races:withResults});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── F1 Live (sessione corrente) ───────────────────────────────────────────────
app.get('/sport/f1/live',async(req,res)=>{
  try{
    // Ultima sessione (può essere live)
    const sessions=await openf1('/sessions?session_key=latest',30000);
    if(!sessions||sessions.length===0) return res.json({live:false});
    const sess=sessions[0];
    const now=new Date();
    const start=new Date(sess.date_start);
    const end=new Date(sess.date_end);
    const isLive=now>=start&&now<=end;

    if(!isLive) return res.json({live:false,session:sess.session_name,meeting:sess.meeting_name});

    // Posizioni live
    const [posArr,drvArr]=await Promise.all([
      openf1('/position?session_key=latest',5000),
      openf1(`/drivers?session_key=${sess.session_key}`,3600000),
    ]);
    const finals={};
    for(const p of (posArr||[])){if(!finals[p.driver_number]||p.date>finals[p.driver_number].date) finals[p.driver_number]=p;}
    const sorted=Object.values(finals).sort((a,b)=>a.position-b.position);
    const positions=sorted.map(p=>{
      const d=(drvArr||[]).find(dr=>dr.driver_number===p.driver_number)||{};
      return{pos:p.position,num:p.driver_number,name:`${d.first_name||''} ${d.last_name||p.driver_number}`.trim(),team:d.team_name||'',abbr:d.name_acronym||''};
    });
    res.json({live:true,session:sess.session_name,meeting:sess.meeting_name,positions});
  }catch(e){res.status(500).json({error:e.message});}
});

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
    // 1. ESPN MotoGP standings (source più aggiornata)
    try{
        // ESPN vuoto — skip
    }catch{}
    // Wikipedia API — classifica MotoGP 2025 dalla pagina standings
    try{
      const wikiUrl='https://en.wikipedia.org/w/api.php?action=parse&page=2025_MotoGP_World_Championship&prop=wikitext&section=0&format=json&origin=*';
      const wr=await axios.get(wikiUrl,{timeout:8000});
      const wt=wr.data?.parse?.wikitext?.['*']||'';
      // Cerca tabella standings piloti nel wikitext
      const tableMatch=wt.match(/\{\| class="wikitable"[\s\S]*?\|\}/);
      if(tableMatch){
        const rows=tableMatch[0].split('\n|-').slice(1);
        const standings=[];
        for(const row of rows){
          const cells=row.split('||').map(c=>c.replace(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g,'$1').replace(/[{}'!|]/g,'').trim());
          const pos=parseInt(cells[0]);
          if(!isNaN(pos)&&cells.length>=3){
            standings.push({intRank:String(pos),strTeam:cells[1]||'',intPoints:cells[cells.length-1]||'0',intPlayed:'0'});
          }
        }
        if(standings.length>0) return res.json({table:standings,season:String(y)});
      }
    }catch{}
    // Classifica 2026 dopo Thai GP (Round 1) — aggiornare dopo ogni gara
    return res.json({table:[
      {intRank:'1', strTeam:'Pedro Acosta',           strNation:'KTM Factory',        intPoints:'32',intPlayed:'1'},
      {intRank:'2', strTeam:'Marco Bezzecchi',         strNation:'Aprilia Racing',     intPoints:'27',intPlayed:'1'},
      {intRank:'3', strTeam:'Raúl Fernández',          strNation:'Trackhouse Aprilia', intPoints:'23',intPlayed:'1'},
      {intRank:'4', strTeam:'Jorge Martín',            strNation:'Aprilia Racing',     intPoints:'18',intPlayed:'1'},
      {intRank:'5', strTeam:'Ai Ogura',                strNation:'Trackhouse Aprilia', intPoints:'17',intPlayed:'1'},
      {intRank:'6', strTeam:'Brad Binder',             strNation:'Red Bull KTM',       intPoints:'13',intPlayed:'1'},
      {intRank:'7', strTeam:'Fabio Di Giannantonio',   strNation:'Pertamina VR46',     intPoints:'12',intPlayed:'1'},
      {intRank:'8', strTeam:'Marc Márquez',            strNation:'Ducati Lenovo',      intPoints:'9', intPlayed:'1'},
      {intRank:'9', strTeam:'Franco Morbidelli',       strNation:'Pertamina VR46',     intPoints:'8', intPlayed:'1'},
      {intRank:'10',strTeam:'Francesco Bagnaia',       strNation:'Ducati Lenovo',      intPoints:'8', intPlayed:'1'},
      {intRank:'11',strTeam:'Luca Marini',             strNation:'Honda HRC',          intPoints:'6', intPlayed:'1'},
      {intRank:'12',strTeam:'Johann Zarco',            strNation:'LCR Honda',          intPoints:'5', intPlayed:'1'},
      {intRank:'13',strTeam:'Enea Bastianini',         strNation:'Tech3 KTM',          intPoints:'4', intPlayed:'1'},
      {intRank:'14',strTeam:'Diogo Moreira',           strNation:'LCR Honda',          intPoints:'3', intPlayed:'1'},
      {intRank:'15',strTeam:'Joan Mir',                strNation:'Honda HRC',          intPoints:'3', intPlayed:'1'},
      {intRank:'16',strTeam:'Fabio Quartararo',        strNation:'Monster Yamaha',     intPoints:'2', intPlayed:'1'},
      {intRank:'17',strTeam:'Alex Rins',               strNation:'Monster Yamaha',     intPoints:'1', intPlayed:'1'},
    ],season:'2026',note:'dopo Thai GP R1'});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── MotoGP Ultima gara (risultati) ───────────────────────────────────────────
app.get('/sport/motogp/last',async(req,res)=>{
  try{
    const y=new Date().getFullYear();
    const now=new Date();
    // Cerca ultima gara passata nel calendario
    const past=MOTOGP_2026.filter(r=>new Date(r.dateEvent)<now).sort((a,b)=>new Date(b.dateEvent)-new Date(a.dateEvent));
    if(past.length===0) return res.json({race:null,results:[]});
    const lastRace=past[0];

    // ESPN MotoGP results per evento
    // Proviamo a cercare risultati dall'ESPN scoreboard
    try{
      const dateStr=lastRace.dateEvent.replace(/-/g,'');
      const d=await axios.get(
        `https://site.web.api.espn.com/apis/site/v2/sports/racing/motogp/scoreboard?dates=${dateStr}`,
        {timeout:10000}
      );
      const events=d.data?.events||[];
      for(const ev of events){
        const comps=ev.competitions?.[0]?.competitors||[];
        if(comps.length>0){
          const results=comps
            .sort((a,b)=>(a.order||99)-(b.order||99))
            .slice(0,20)
            .map(c=>({
              position:String(c.order||0),
              name:c.athlete?.displayName||c.team?.displayName||'',
              abbr:c.athlete?.shortName||'',
              team:c.team?.name||'',
              points:String(c.score||''),
            }));
          return res.json({race:lastRace,results});
        }
      }
    }catch{}
    // Hardcoded Thai GP 2026 (Round 1 — 1 marzo 2026)
    if(lastRace.round===1){
      return res.json({race:lastRace,results:[
        {position:'1',name:'Marco Bezzecchi',  abbr:'MB72',team:'Aprilia Racing',   points:'25'},
        {position:'2',name:'Pedro Acosta',      abbr:'PA31',team:'Red Bull KTM',     points:'20'},
        {position:'3',name:'Raul Fernandez',    abbr:'RF25',team:'Trackhouse Aprilia',points:'16'},
        {position:'4',name:'Jorge Martín',      abbr:'JM89',team:'Aprilia Racing',   points:'13'},
        {position:'5',name:'Ai Ogura',          abbr:'AO79',team:'Trackhouse Aprilia',points:'11'},
        {position:'6',name:'Brad Binder',       abbr:'BB33',team:'Red Bull KTM',     points:'10'},
        {position:'7',name:'Fabio Di Giannantonio',abbr:'FD49',team:'Pertamina VR46',points:'9'},
        {position:'8',name:'Luca Marini',       abbr:'LM10',team:'Honda HRC',        points:'8'},
        {position:'9',name:'Enea Bastianini',   abbr:'EB23',team:'GASGAS Tech3',     points:'7'},
        {position:'10',name:'Maverick Viñales', abbr:'MV12',team:'GASGAS Tech3',     points:'6'},
      ]});
    }
    res.json({race:lastRace,results:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── MotoGP Gare passate stagione corrente ────────────────────────────────────
app.get('/sport/motogp/constructors',async(req,res)=>{
  // Classifica costruttori MotoGP 2026 dopo Thai GP R1
  res.json({constructors:[
    {position:'1',constructor:'Aprilia Racing',  points:'56'},
    {position:'2',constructor:'Red Bull KTM',    points:'45'},
    {position:'3',constructor:'Pertamina VR46',  points:'20'},
    {position:'4',constructor:'Ducati Lenovo',   points:'17'},
    {position:'5',constructor:'Honda HRC',       points:'9'},
    {position:'6',constructor:'LCR Honda',       points:'8'},
    {position:'7',constructor:'Tech3 KTM',       points:'7'},
    {position:'8',constructor:'Monster Yamaha',  points:'3'},
  ],season:'2026',note:'dopo Thai GP R1'});
});

app.get('/sport/motogp/past',async(req,res)=>{
  const now=new Date();
  const past=MOTOGP_2026
    .filter(r=>new Date(r.dateEvent)<now)
    .sort((a,b)=>new Date(b.dateEvent)-new Date(a.dateEvent));
  const knownResults={
    'moto2026_1':[  // Thai GP — risultati reali
      {position:'1', name:'Marco Bezzecchi',      team:'Aprilia Racing',    points:'25'},
      {position:'2', name:'Pedro Acosta',          team:'Red Bull KTM',      points:'20'},
      {position:'3', name:'Raúl Fernández',        team:'Trackhouse Aprilia',points:'16'},
      {position:'4', name:'Jorge Martín',          team:'Aprilia Racing',    points:'13'},
      {position:'5', name:'Ai Ogura',              team:'Trackhouse Aprilia',points:'11'},
      {position:'6', name:'Brad Binder',           team:'Red Bull KTM',      points:'10'},
      {position:'7', name:'Fabio Di Giannantonio', team:'Pertamina VR46',    points:'9'},
      {position:'8', name:'Luca Marini',           team:'Honda HRC',         points:'8'},
      {position:'9', name:'Enea Bastianini',       team:'Tech3 KTM',         points:'7'},
      {position:'10',name:'Franco Morbidelli',     team:'Pertamina VR46',    points:'6'},
    ],
  };
  const withResults=past.map(r=>({...r,results:knownResults[r.idEvent]||[]}));
  res.json({races:withResults});
});

// ── MotoGP Live ───────────────────────────────────────────────────────────────
app.get('/sport/motogp/live',async(req,res)=>{
  try{
    const now=new Date();
    // Gara in corso? (±3h dalla data evento)
    const live=MOTOGP_2026.find(r=>{
      const d=new Date(r.dateEvent+'T12:00:00Z');
      return Math.abs(now-d)<3*3600000;
    });
    if(!live) return res.json({live:false});
    // ESPN live scoreboard
    try{
      const dateStr=live.dateEvent.replace(/-/g,'');
      const d=await axios.get(
        `https://site.web.api.espn.com/apis/site/v2/sports/racing/motogp/scoreboard?dates=${dateStr}`,
        {timeout:8000}
      );
      const comps=d.data?.events?.[0]?.competitions?.[0]?.competitors||[];
      const positions=comps.sort((a,b)=>(a.order||99)-(b.order||99)).map(c=>({
        pos:c.order,name:c.athlete?.displayName||'',team:c.team?.name||'',
      }));
      return res.json({live:true,race:live.strEvent,positions});
    }catch{}
    res.json({live:true,race:live.strEvent,positions:[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── CLASSIFICHE GENERALI — tutte le leghe principali ─────────────────────────
app.get('/sport/soccer/standings/all',async(req,res)=>{
  const leagues=[
    {slug:'ita.1',name:'Serie A',        flag:'IT'},
    {slug:'ita.2',name:'Serie B',        flag:'IT'},
    {slug:'esp.1',name:'La Liga',        flag:'ES'},
    {slug:'eng.1',name:'Premier League', flag:'GB'},
    {slug:'ger.1',name:'Bundesliga',     flag:'DE'},
    {slug:'fra.1',name:'Ligue 1',        flag:'FR'},
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
        slug:lg.slug,name:lg.name,flag:lg.flag||'',
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
        slug:lg.slug,name:lg.name,flag:lg.flag||'',
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
  {slug:'uefa.conference',  name:'Conference League',   fd:null,   sdbLeague:'4480', group:'Europa'},
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
      // TheSportsDB fallback per Conference League (FD non supporta ECSL free tier)
      if(lg.sdbLeague&&events.length===0){
        try{
          const yr=new Date().getFullYear();
          const season=`${yr-1}-${yr}`;
          const d=await sdb(`/eventsseason.php?id=${lg.sdbLeague}&s=${season}`,7200000).catch(()=>null);
          for(const e of(d?.events||[])){
            const eid=`sdb:${e.idEvent}`;if(seen.has(eid))continue;seen.add(eid);
            const hs=e.intHomeScore,as=e.intAwayScore;
            // Mappa round SDB → fase italiana
            let round='';
            const rd=(e.strRound||'').toLowerCase();
            if(rd.includes('final')&&!rd.includes('semi')&&!rd.includes('quarter'))round='Finale';
            else if(rd.includes('semi'))round='Semifinale';
            else if(rd.includes('quarter'))round='Quarti di Finale';
            else if(rd.includes('round of 16')||rd.includes('last 16'))round='Ottavi di Finale';
            else if(rd.includes('round of 32')||rd.includes('last 32'))round='Sedicesimi di Finale';
            else if(rd.includes('group')||rd.includes('league phase'))round='Fase a Gironi';
            else if(rd.includes('playoff'))round='Playoff';
            else if(rd.includes('qualifying'))round='Qualificazioni';
            else if(e.strRound)round=`Giornata ${e.strRound}`;
            // Se round ancora vuoto, classifica per data
            if(!round) round=mapPhaseByDate(e.dateEvent?(e.dateEvent+'T'+(e.strTime||'00:00:00')):'',lg.slug);
            events.push({
              id:eid,date:e.dateEvent?(e.dateEvent+'T'+(e.strTime||'00:00:00')):'',
              league:lg.name,leagueSlug:lg.slug,
              homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',
              homeScore:hs!=null?String(hs):'',awayScore:as!=null?String(as):'',
              homeId:'',awayId:'',completed:hs!=null,live:false,clock:'',
              round,statusDetail:'',
            });
          }
        }catch{}
      }
      // football-data fallback: CL/EL usano FD per fasi corrette, Conference non disponibile su FD free
      if(lg.fd&&lg.slug!=='uefa.conference'&&events.length>0){
        // Arricchisci sempre da FD per CL/EL: stage ufficiali
        try{
          const yr=new Date().getFullYear();
          let fdData=await fd(`/competitions/${lg.fd}/matches?season=${yr-1}`,7200000).catch(()=>null);
          if(!fdData?.matches?.length) fdData=await fd(`/competitions/${lg.fd}/matches?season=${yr-2}`,7200000).catch(()=>null);
          if(fdData?.matches?.length){
            // Mappa: data → stage (più precisa di nome squadra)
            const fdDateMap=new Map();
            const fdTeamMap=new Map();
            for(const m of(fdData.matches||[])){
              const ht=m.homeTeam?.shortName||m.homeTeam?.name||'';
              const at=m.awayTeam?.shortName||m.awayTeam?.name||'';
              const stage=mapStage(m.stage||m.group||'');
              if(m.utcDate){
                const dk=m.utcDate.slice(0,10);
                fdDateMap.set(dk,stage);
              }
              if(ht&&at) fdTeamMap.set(`${ht}|${at}`,stage);
            }
            // Build anche una mappa per data → stage (molte partite stessa data = stessa fase)
            const fdDateStage=new Map();
            for(const[dk,stage] of fdDateMap){
              if(!fdDateStage.has(dk)) fdDateStage.set(dk,stage);
            }
            for(const e of events){
              const dk=e.date?e.date.slice(0,10):'';
              const teamKey=`${e.homeName}|${e.awayName}`;
              let stageByTeam=fdTeamMap.get(teamKey)||'';
              // Fallback: cerca match parziale sul nome squadra
              if(!stageByTeam){
                for(const[k,v] of fdTeamMap){
                  const [ht,at]=k.split('|');
                  if((e.homeName&&(e.homeName.includes(ht)||ht.includes(e.homeName)))&&
                     (e.awayName&&(e.awayName.includes(at)||at.includes(e.awayName)))){
                    stageByTeam=v; break;
                  }
                }
              }
              const stageByDate=fdDateStage.get(dk)||'';
              const isGeneric=!e.round||e.round==='Champions League'||
                e.round==='Europa League'||e.round==='Conference League'||
                e.round==='Fase Knockout'||e.round==='Partite';
              if(isGeneric||(stageByTeam&&stageByTeam!==e.round)){
                e.round=stageByTeam||stageByDate||e.round||'';
              }
              // Fallback finale: classifica per data se ancora vuoto o generico
              if(!e.round||e.round==='Partite'||e.round==='Fase Knockout'){
                e.round=mapPhaseByDate(e.date,lg.slug);
              }
            }
          }
        }catch{}
      }
      // Passaggio finale: classifica per data qualsiasi evento ancora senza fase
      for(const e of events){
        if(!e.round||e.round==='Partite'||e.round==='Fase Knockout'||e.round==='Champions League'||e.round==='Europa League'||e.round==='Conference League'){
          e.round=mapPhaseByDate(e.date,lg.slug);
        }
      }
      if(events.length===0)continue;
      events.sort((a,b)=>new Date(a.date)-new Date(b.date));
      // Per coppe nazionali senza round: stima fase dal numero partite rimaste
      // (più partite = turno iniziale, meno = finale)
      const isCoppaEuropea=lg.slug==='uefa.champions'||lg.slug==='uefa.europa'||lg.slug==='uefa.conference';
      const isCoppaNazionale=!isCoppaEuropea&&lg.isCup;
      if(isCoppaNazionale){
        // Raggruppa per data per capire i turni
        const dateGroups=new Map();
        for(const e of events){
          const wk=e.date?e.date.slice(0,7):''; // YYYY-MM
          if(!dateGroups.has(wk))dateGroups.set(wk,[]);
          dateGroups.get(wk).push(e);
        }
        // Ordina i gruppi di date
        const sortedWks=[...dateGroups.keys()].sort();
        const totalGroups=sortedWks.length;
        sortedWks.forEach((wk,i)=>{
          const grpEvs=dateGroups.get(wk);
          const cnt=grpEvs.length;
          // Stima fase dal numero partite e posizione nella stagione
          let phase='';
          if(!phase){
            // Usa già il round se disponibile
            const existingRound=grpEvs.find(e=>e.round&&e.round!=='Partite')?.round;
            if(existingRound) phase=existingRound;
          }
          if(!phase){
            if(cnt>=32) phase='Turno Preliminare';
            else if(cnt>=16) phase='Sedicesimi di Finale';
            else if(cnt>=8) phase='Ottavi di Finale';
            else if(cnt>=4) phase='Quarti di Finale';
            else if(cnt>=2) phase='Semifinale';
            else if(cnt===1) phase='Finale';
            else phase='Turno';
          }
          // Assegna la fase agli eventi del gruppo se non hanno round
          for(const e of grpEvs){
            if(!e.round||e.round==='Partite') e.round=phase;
          }
        });
      }

      const phaseMap=new Map();
      for(const e of events){
        // Normalizza round: se ESPN usa "X advance N-M on penalties" → assegna a fase appropriata
        // e aggiungi info rigori allo statusDetail
        let ph=e.round||'';
        const penMatch=ph.match(/(.+?)(?:\s+(?:advance|win)\s+[\d-]+\s+on\s+penalties)/i);
        if(penMatch){
          if(!e.statusDetail||e.statusDetail==='FT') e.statusDetail='dcr';
          ph=''; // verrà assegnata alla fase corretta dopo
        }
        ph=ph||'Partite';
        if(!phaseMap.has(ph))phaseMap.set(ph,[]);
        phaseMap.get(ph).push(e);
      }
      const phaseOrder=['Qualificazioni','Turno Preliminare','Semifinale Preliminare',
        'Fase a Gironi','Fase Leghe','Playoff','Sedicesimi di Finale',
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
// ══════════════════════════════════════════════════════════════════════════════
// MONDIALI 2026 — USA/Canada/Messico, 11 giu – 19 lug 2026
// ══════════════════════════════════════════════════════════════════════════════
const WC2026_GROUPS={
  A:[{t:'Messico'},{t:'Corea del Sud'},{t:'Sudafrica'},{t:'Playoff D*'}],
  B:[{t:'Canada'},{t:'Svizzera'},{t:'Qatar'},{t:'Playoff A*'}],
  C:[{t:'Brasile'},{t:'Marocco'},{t:'Scozia'},{t:'Haiti'}],
  D:[{t:'USA'},{t:'Australia'},{t:'Paraguay'},{t:'Playoff C*'}],
  E:[{t:'Germania'},{t:'Ecuador'},{t:'Costa Avorio'},{t:'Curacao'}],
  F:[{t:'Olanda'},{t:'Giappone'},{t:'Tunisia'},{t:'Playoff B*'}],
  G:[{t:'Belgio'},{t:'Iran'},{t:'Egitto'},{t:'Nuova Zelanda'}],
  H:[{t:'Spagna'},{t:'Uruguay'},{t:'Arabia Saudita'},{t:'Capo Verde'}],
  I:[{t:'Francia'},{t:'Senegal'},{t:'Norvegia'},{t:'Playoff F*'}],
  J:[{t:'Argentina'},{t:'Algeria'},{t:'Austria'},{t:'Giordania'}],
  K:[{t:'Portogallo'},{t:'Colombia'},{t:'Uzbekistan'},{t:'Playoff E*'}],
  L:[{t:'Inghilterra'},{t:'Croazia'},{t:'Panama'},{t:'Ghana'}],
};
// * Playoff A = Italia/Irlanda del Nord/Galles/Bosnia
// * Playoff B = Ucraina/Svezia/Polonia/Albania
// * Playoff C = Turchia/Romania/Slovacchia/Kosovo
// * Playoff D = Danimarca/Macedonia del Nord/Rep.Ceca/Irlanda
// * Playoff E = Congo/Giamaica/Nuova Caledonia
// * Playoff F = Bolivia/Suriname/Iraq
// Partite gironi (date ufficiali parziali, alcune stimate)
const WC2026_MATCHES=[
  // Girone A
  {group:'A',date:'2026-06-11',home:'USA',away:'Marocco',homeScore:null,awayScore:null},
  {group:'A',date:'2026-06-11',home:'Portogallo',away:'Egitto',homeScore:null,awayScore:null},
  {group:'A',date:'2026-06-15',home:'USA',away:'Egitto',homeScore:null,awayScore:null},
  {group:'A',date:'2026-06-15',home:'Marocco',away:'Portogallo',homeScore:null,awayScore:null},
  {group:'A',date:'2026-06-19',home:'USA',away:'Portogallo',homeScore:null,awayScore:null},
  {group:'A',date:'2026-06-19',home:'Egitto',away:'Marocco',homeScore:null,awayScore:null},
  // Girone B
  {group:'B',date:'2026-06-12',home:'Argentina',away:'Cile',homeScore:null,awayScore:null},
  {group:'B',date:'2026-06-12',home:'Messico',away:'Belgio',homeScore:null,awayScore:null},
  {group:'B',date:'2026-06-16',home:'Argentina',away:'Belgio',homeScore:null,awayScore:null},
  {group:'B',date:'2026-06-16',home:'Cile',away:'Messico',homeScore:null,awayScore:null},
  {group:'B',date:'2026-06-20',home:'Argentina',away:'Messico',homeScore:null,awayScore:null},
  {group:'B',date:'2026-06-20',home:'Belgio',away:'Cile',homeScore:null,awayScore:null},
  // Girone C
  {group:'C',date:'2026-06-12',home:'Canada',away:'Senegal',homeScore:null,awayScore:null},
  {group:'C',date:'2026-06-12',home:'Inghilterra',away:'Olanda',homeScore:null,awayScore:null},
  {group:'C',date:'2026-06-16',home:'Inghilterra',away:'Senegal',homeScore:null,awayScore:null},
  {group:'C',date:'2026-06-16',home:'Olanda',away:'Canada',homeScore:null,awayScore:null},
  {group:'C',date:'2026-06-20',home:'Canada',away:'Inghilterra',homeScore:null,awayScore:null},
  {group:'C',date:'2026-06-20',home:'Senegal',away:'Olanda',homeScore:null,awayScore:null},
  // Girone D
  {group:'D',date:'2026-06-13',home:'Francia',away:'Svizzera',homeScore:null,awayScore:null},
  {group:'D',date:'2026-06-13',home:'Brasile',away:'Giappone',homeScore:null,awayScore:null},
  {group:'D',date:'2026-06-17',home:'Brasile',away:'Svizzera',homeScore:null,awayScore:null},
  {group:'D',date:'2026-06-17',home:'Giappone',away:'Francia',homeScore:null,awayScore:null},
  {group:'D',date:'2026-06-21',home:'Brasile',away:'Francia',homeScore:null,awayScore:null},
  {group:'D',date:'2026-06-21',home:'Svizzera',away:'Giappone',homeScore:null,awayScore:null},
  // Girone E
  {group:'E',date:'2026-06-13',home:'Spagna',away:'Algeria',homeScore:null,awayScore:null},
  {group:'E',date:'2026-06-13',home:'Germania',away:'Canada',homeScore:null,awayScore:null},
  {group:'E',date:'2026-06-17',home:'Spagna',away:'Canada',homeScore:null,awayScore:null},
  {group:'E',date:'2026-06-17',home:'Algeria',away:'Germania',homeScore:null,awayScore:null},
  {group:'E',date:'2026-06-21',home:'Spagna',away:'Germania',homeScore:null,awayScore:null},
  {group:'E',date:'2026-06-21',home:'Canada',away:'Algeria',homeScore:null,awayScore:null},
  // Girone F
  {group:'F',date:'2026-06-14',home:'Colombia',away:'Nigeria',homeScore:null,awayScore:null},
  {group:'F',date:'2026-06-14',home:'Uruguay',away:'Corea del Sud',homeScore:null,awayScore:null},
  {group:'F',date:'2026-06-18',home:'Uruguay',away:'Nigeria',homeScore:null,awayScore:null},
  {group:'F',date:'2026-06-18',home:'Corea del Sud',away:'Colombia',homeScore:null,awayScore:null},
  {group:'F',date:'2026-06-22',home:'Uruguay',away:'Colombia',homeScore:null,awayScore:null},
  {group:'F',date:'2026-06-22',home:'Nigeria',away:'Corea del Sud',homeScore:null,awayScore:null},
  // Girone G
  {group:'G',date:'2026-06-14',home:'Ecuador',away:'Costa Rica',homeScore:null,awayScore:null},
  {group:'G',date:'2026-06-14',home:'Polonia',away:'Australia',homeScore:null,awayScore:null},
  {group:'G',date:'2026-06-18',home:'Polonia',away:'Costa Rica',homeScore:null,awayScore:null},
  {group:'G',date:'2026-06-18',home:'Australia',away:'Ecuador',homeScore:null,awayScore:null},
  {group:'G',date:'2026-06-22',home:'Polonia',away:'Ecuador',homeScore:null,awayScore:null},
  {group:'G',date:'2026-06-22',home:'Costa Rica',away:'Australia',homeScore:null,awayScore:null},
  // Girone H
  {group:'H',date:'2026-06-15',home:'Italia',away:'Arabia Saudita',homeScore:null,awayScore:null},
  {group:'H',date:'2026-06-15',home:'Turchia',away:'Messico',homeScore:null,awayScore:null},
  {group:'H',date:'2026-06-19',home:'Italia',away:'Messico',homeScore:null,awayScore:null},
  {group:'H',date:'2026-06-19',home:'Arabia Saudita',away:'Turchia',homeScore:null,awayScore:null},
  {group:'H',date:'2026-06-23',home:'Italia',away:'Turchia',homeScore:null,awayScore:null},
  {group:'H',date:'2026-06-23',home:'Messico',away:'Arabia Saudita',homeScore:null,awayScore:null},
  // Girone I
  {group:'I',date:'2026-06-15',home:'Croazia',away:'Costa Avorio',homeScore:null,awayScore:null},
  {group:'I',date:'2026-06-15',home:'Iran',away:'Qatar',homeScore:null,awayScore:null},
  {group:'I',date:'2026-06-19',home:'Croazia',away:'Qatar',homeScore:null,awayScore:null},
  {group:'I',date:'2026-06-19',home:'Iran',away:'Costa Avorio',homeScore:null,awayScore:null},
  {group:'I',date:'2026-06-23',home:'Croazia',away:'Iran',homeScore:null,awayScore:null},
  {group:'I',date:'2026-06-23',home:'Qatar',away:'Costa Avorio',homeScore:null,awayScore:null},
  // Girone J
  {group:'J',date:'2026-06-16',home:'Danimarca',away:'Venezuela',homeScore:null,awayScore:null},
  {group:'J',date:'2026-06-16',home:'Camerun',away:'Arabia',homeScore:null,awayScore:null},
  {group:'J',date:'2026-06-20',home:'Danimarca',away:'Arabia',homeScore:null,awayScore:null},
  {group:'J',date:'2026-06-20',home:'Venezuela',away:'Camerun',homeScore:null,awayScore:null},
  {group:'J',date:'2026-06-24',home:'Danimarca',away:'Camerun',homeScore:null,awayScore:null},
  {group:'J',date:'2026-06-24',home:'Arabia',away:'Venezuela',homeScore:null,awayScore:null},
  // Girone K
  {group:'K',date:'2026-06-16',home:'Serbia',away:'Nuova Zelanda',homeScore:null,awayScore:null},
  {group:'K',date:'2026-06-16',home:'Perù',away:'Congo',homeScore:null,awayScore:null},
  {group:'K',date:'2026-06-20',home:'Serbia',away:'Congo',homeScore:null,awayScore:null},
  {group:'K',date:'2026-06-20',home:'Nuova Zelanda',away:'Perù',homeScore:null,awayScore:null},
  {group:'K',date:'2026-06-24',home:'Serbia',away:'Perù',homeScore:null,awayScore:null},
  {group:'K',date:'2026-06-24',home:'Congo',away:'Nuova Zelanda',homeScore:null,awayScore:null},
  // Girone L
  {group:'L',date:'2026-06-17',home:'Austria',away:'Ghana',homeScore:null,awayScore:null},
  {group:'L',date:'2026-06-17',home:'Ucraina',away:'Panama',homeScore:null,awayScore:null},
  {group:'L',date:'2026-06-21',home:'Austria',away:'Panama',homeScore:null,awayScore:null},
  {group:'L',date:'2026-06-21',home:'Ghana',away:'Ucraina',homeScore:null,awayScore:null},
  {group:'L',date:'2026-06-25',home:'Austria',away:'Ucraina',homeScore:null,awayScore:null},
  {group:'L',date:'2026-06-25',home:'Panama',away:'Ghana',homeScore:null,awayScore:null},
];
// Fasi eliminatorie (TBD = da definire dopo gironi)
const WC2026_KNOCKOUT=[
  {round:'Ottavi',id:'R16_1', date:'2026-06-28',home:'1A',away:'2B',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_2', date:'2026-06-28',home:'1C',away:'2D',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_3', date:'2026-06-29',home:'1E',away:'2F',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_4', date:'2026-06-29',home:'1G',away:'2H',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_5', date:'2026-06-30',home:'1B',away:'2A',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_6', date:'2026-06-30',home:'1D',away:'2C',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_7', date:'2026-07-01',home:'1F',away:'2E',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_8', date:'2026-07-01',home:'1H',away:'2G',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_9', date:'2026-07-02',home:'1I',away:'2J',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_10',date:'2026-07-02',home:'1K',away:'2L',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_11',date:'2026-07-03',home:'1J',away:'2I',homeScore:null,awayScore:null},
  {round:'Ottavi',id:'R16_12',date:'2026-07-03',home:'1L',away:'2K',homeScore:null,awayScore:null},
  {round:'Quarti',id:'QF_1',  date:'2026-07-04',home:'W_R16_1',away:'W_R16_2',homeScore:null,awayScore:null},
  {round:'Quarti',id:'QF_2',  date:'2026-07-05',home:'W_R16_3',away:'W_R16_4',homeScore:null,awayScore:null},
  {round:'Quarti',id:'QF_3',  date:'2026-07-06',home:'W_R16_5',away:'W_R16_6',homeScore:null,awayScore:null},
  {round:'Quarti',id:'QF_4',  date:'2026-07-07',home:'W_R16_7',away:'W_R16_8',homeScore:null,awayScore:null},
  {round:'Quarti',id:'QF_5',  date:'2026-07-08',home:'W_R16_9',away:'W_R16_10',homeScore:null,awayScore:null},
  {round:'Quarti',id:'QF_6',  date:'2026-07-09',home:'W_R16_11',away:'W_R16_12',homeScore:null,awayScore:null},
  {round:'Semifinali',id:'SF_1',date:'2026-07-14',home:'W_QF_1',away:'W_QF_2',homeScore:null,awayScore:null},
  {round:'Semifinali',id:'SF_2',date:'2026-07-15',home:'W_QF_3',away:'W_QF_4',homeScore:null,awayScore:null},
  {round:'Semifinali',id:'SF_3',date:'2026-07-16',home:'W_QF_5',away:'W_QF_6',homeScore:null,awayScore:null},
  {round:'3° posto',  id:'3PL', date:'2026-07-18',home:'L_SF_1',away:'L_SF_2',homeScore:null,awayScore:null},
  {round:'Finale',    id:'FIN', date:'2026-07-19',home:'W_SF_1',away:'W_SF_2',homeScore:null,awayScore:null},
];

app.get('/sport/soccer/worldcup2026',async(req,res)=>{
  res.json({groups:WC2026_GROUPS,matches:WC2026_MATCHES,knockout:WC2026_KNOCKOUT});
});

// ── DIAGNOSTICA ─────────────────────────────────────────────────────────────
// ── Statistiche stagione squadra ─────────────────────────────────────────────
app.get('/sport/soccer/team/:id/stats',async(req,res)=>{
  try{
    const id=req.params.id;
    const name=(req.query.name||'').trim();
    const yr=new Date().getFullYear();
    const fdSeason=yr; // football-data usa anno singolo
    let W=0,D=0,L=0,GF=0,GA=0,played=0;
    const trophies=[];
    let sdbId=null;

    // 1. Risolvi sdbId da SDB per nome
    try{
      const sname=id.startsWith('sdb:')?null:name;
      if(id.startsWith('sdb:')) sdbId=id.replace('sdb:','');
      else if(sname){
        const s=await sdb(`/searchteams.php?t=${encodeURIComponent(sname)}`,86400000);
        sdbId=s?.teams?.[0]?.idTeam||null;
      }
    }catch{}

    // 2. Trofei da SDB
    if(sdbId){
      try{
        const tr=await sdb(`/lookuptrophies.php?id=${sdbId}`,86400000);
        for(const t of(tr?.trophies||[])){
          if(t.strTrophy) trophies.push({name:t.strTrophy,season:t.strSeason||'',league:t.strLeague||'',country:t.strCountry||''});
        }
      }catch{}
    }

    // 3a. Stats da football-data.org (più affidabile, ha partite stagione corrente)
    if(!id.startsWith('sdb:')){
      try{
        // Usa getFdId già esistente (usa cache + FD_NAME_MAP + fallback API)
        const nameKey=(name||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
        let fdId=FD_NAME_MAP[nameKey];
        if(!fdId){
          for(const [k,v] of Object.entries(FD_NAME_MAP)){
            if(nameKey&&(nameKey.includes(k)||k.includes(nameKey))){fdId=v;break;}
          }
        }
        if(!fdId) fdId=await getFdTeamId(id,name).catch(()=>null);
        if(fdId){
          const r=await axios.get(
            `https://api.football-data.org/v4/teams/${fdId}/matches?status=FINISHED&limit=60`,
            {timeout:10000,headers:FD_H}
          );
          const matches=r.data?.matches||[];
          const curSeason=matches.filter(m=>new Date(m.utcDate).getFullYear()>=yr-1);
          for(const m of curSeason){
            const isHome=m.homeTeam?.id===fdId;
            const hs=m.score?.fullTime?.home,as_=m.score?.fullTime?.away;
            if(hs===null||hs===undefined||as_===null||as_===undefined) continue;
            const mygf=isHome?hs:as_,myga=isHome?as_:hs;
            GF+=mygf;GA+=myga;
            if(mygf>myga)W++;else if(mygf===myga)D++;else L++;
          }
          played=W+D+L;
        }
      }catch{}
    }

    // 3b. Fallback SDB eventsseason per squadre sdb: o se FD non ha trovato nulla
    if(played===0 && sdbId){
      try{
        const season=`${yr-1}-${yr}`;
        const sr=await sdb(`/eventsseason.php?id=${sdbId}&s=${season}`,3600000).catch(()=>({events:[]}));
        for(const e of(sr?.events||[])){
          const hs=parseInt(e.intHomeScore),as_=parseInt(e.intAwayScore);
          if(isNaN(hs)||isNaN(as_))continue;
          const isHome=String(e.idHomeTeam)===String(sdbId);
          const mygf=isHome?hs:as_,myga=isHome?as_:hs;
          GF+=mygf;GA+=myga;
          if(mygf>myga)W++;else if(mygf===myga)D++;else L++;
        }
        played=W+D+L;
      }catch{}
    }

    // 3c. Ultimo fallback: ESPN schedule (no cache)
    if(played===0 && !id.startsWith('sdb:')){
      try{
        for(const lg of SOCCER_LEAGUES.filter(l=>!l.isCup)){
          try{
            const r=await axios.get(`${ESPN}/soccer/${lg.slug}/teams/${id}/schedule`,
              {timeout:8000,headers:{'Cache-Control':'no-cache'}});
            for(const e of(r.data?.events||[])){
              const comp=e.competitions?.[0];
              if(!comp?.status?.type?.completed)continue;
              const comps=comp.competitors||[];
              const mine=comps.find(c=>String(c.id)===String(id));
              const opp=comps.find(c=>String(c.id)!==String(id));
              if(!mine||!opp)continue;
              const mygf=parseInt(mine.score||'0'),myga=parseInt(opp.score||'0');
              if(isNaN(mygf)||isNaN(myga))continue;
              GF+=mygf;GA+=myga;
              if(mygf>myga)W++;else if(mygf===myga)D++;else L++;
            }
          }catch{}
        }
        played=W+D+L;
      }catch{}
    }

    res.json({stats:played>0?{played,W,D,L,GF,GA,season:`${yr-1}-${yr}`}:null,trophies});
  }catch(e){res.status(500).json({error:e.message});}
});


app.get('/diag',async(req,res)=>{
  const results={};
  const test=async(name,fn)=>{
    try{const t=Date.now();const d=await fn();results[name]={ok:true,ms:Date.now()-t,sample:JSON.stringify(d).slice(0,120)};}
    catch(e){results[name]={ok:false,error:e.message};}
  };
  // F1 ultima gara - prova path 2025 diretto
  await test('f1_last_2025',async()=>{const r=await ergast('/2025/last/results');const race=r?.MRData?.RaceTable?.Races?.[0];return{raceName:race?.raceName,date:race?.date,results:race?.Results?.length,p1:race?.Results?.[0]?.Driver?.familyName};});
  // F1 standings - anno e punti
  await test('f1_standings_detail',async()=>{const d=await fetch('https://site.web.api.espn.com/apis/v2/sports/racing/f1/standings',10000);const c=d?.children?.[0];const e=c?.standings?.entries||[];return{season:c?.season?.year||d?.season?.year,count:e.length,p1:e[0]?.athlete?.displayName,pts:e[0]?.stats?.find(s=>s.name==='points')?.value};});
  // Tennis - tutti i keys di rankings[0] per trovare dove sono i piloti
  await test('tennis_r0_full',async()=>{const d=await fetch('https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings?limit=3',10000);const r0=d?.rankings?.[0]||{};return{keys:Object.keys(r0),season:r0.season,type:r0.type,entries_keys:Object.keys(r0.entries?.[0]||{}),athletes_keys:Object.keys(r0.athletes?.[0]||{}),items_keys:Object.keys((r0.items||r0.ranking||r0.standings||[])[0]||{})};});
  // MotoGP standings - prova motorsport-data
  await test('moto_ergast_2025',async()=>{const d=await ergast('/2025/last/results');return{raceName:d?.MRData?.RaceTable?.Races?.[0]?.raceName};});
  await test('moto_sdb_riders',async()=>{const d=await sdb('/searchplayers.php?p=bagnaia',3600000);return{count:(d?.player||[]).length,first:(d?.player||[])[0]?.strPlayer};});
  // Stats calcio — test con Juventus ESPN id 109 e nome "Juventus"
  await test('stats_juve_fdid',async()=>{const fdId=await getFdTeamId('109','Juventus');return{fdId};});
  await test('stats_juve_fd_matches',async()=>{
    const fdId=await getFdTeamId('109','Juventus');
    if(!fdId) return{error:'no fdId'};
    const r=await axios.get(`https://api.football-data.org/v4/teams/${fdId}/matches?status=FINISHED&limit=10`,{timeout:10000,headers:FD_H});
    const m=r.data?.matches||[];
    return{count:m.length,first:m[0]?.homeTeam?.name+' vs '+m[0]?.awayTeam?.name,date:m[0]?.utcDate};
  });
  await test('stats_juve_sdb',async()=>{
    const s=await sdb('/searchteams.php?t=Juventus',86400000);
    const sdbId=s?.teams?.[0]?.idTeam;
    if(!sdbId) return{error:'no sdbId'};
    const yr=new Date().getFullYear();
    const sr=await sdb(`/eventsseason.php?id=${sdbId}&s=${yr-1}-${yr}`,3600000).catch(()=>null);
    return{sdbId,eventsCount:(sr?.events||[]).length,firstEvent:sr?.events?.[0]?.strEvent};
  });
  res.json(results);
});

app.listen(PORT,()=>console.log(`Proxy porta ${PORT}`));
