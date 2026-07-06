'use strict';
const express=require('express');
const axios=require('axios');
const cors=require('cors');
const app=express();
app.use(cors());

// CACHE
const cache=new Map();
function getC(k){const e=cache.get(k);if(!e||Date.now()>e.exp){cache.delete(k);return null;}return e.data;}
function setC(k,v,ms){cache.set(k,{data:v,exp:Date.now()+ms});}
async function cGet(url,ttl=300000,headers={}){const k=url+JSON.stringify(headers);const c=getC(k);if(c)return c;const r=await axios.get(url,{timeout:8000,headers});setC(k,r.data,ttl);return r.data;}

// COSTANTI
const ESPN='https://site.api.espn.com/apis/site/v2/sports';
const ESPN2='https://site.web.api.espn.com/apis/v2/sports';
const SDB='https://www.thesportsdb.com/api/v1/json/123';
const FD='https://api.football-data.org/v4';
const FD_H={'X-Auth-Token':'138a06978b4b4c11b8fada4a4b9247de'};
const VT='https://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT2='https://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno';
const VT_AGENTS=['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1','Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'];
function vtH(){return{'User-Agent':VT_AGENTS[Math.floor(Date.now()/30000)%3],'Referer':'https://www.viaggiatreno.it/','Origin':'https://www.viaggiatreno.it','Accept':'application/json, text/plain, */*','Accept-Language':'it-IT,it;q=0.9'};}
async function sdb(path,ttl=600000){const c=getC(path);if(c)return c;const r=await axios.get(`${SDB}${path}`,{timeout:8000});setC(path,r.data,ttl);return r.data;}
async function fd(path,ttl=3600000){return cGet(`${FD}${path}`,ttl,FD_H);}
async function ergast(path,ttl=3600000){const k=`erg:${path}`;const c=getC(k);if(c)return c;const r=await axios.get(`https://api.jolpi.ca/ergast/f1${path}.json`,{timeout:8000});setC(k,r.data,ttl);return r.data;}

// HEALTH
app.get('/',(req,res)=>res.send('OK '+new Date().toISOString()));
app.get('/cache/clear',(req,res)=>{const type=req.query.type||'all';let cleared=0;for(const[k] of cache){if(type==='all'||k.includes(type)){cache.delete(k);cleared++;}}res.json({cleared,remaining:cache.size});});
app.get('/og',async(req,res)=>{const url=req.query.url;if(!url)return res.status(400).json({error:'Missing url'});const ck=`og:${url}`;const cached=getC(ck);if(cached)return res.json(cached);try{const r=await axios.get(url,{timeout:10000,headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1)','Accept':'text/html'},maxRedirects:5});const html=r.data;const getMeta=(prop)=>{for(const p of[new RegExp(`<meta[^>]*property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`,'i')]){const m=html.match(p);if(m)return m[1].replace(/&amp;/g,'&').trim();}return null;};const titleM=html.match(/<title[^>]*>([^<]+)<\/title>/i);const result={title:getMeta('title')||(titleM?titleM[1].trim():null),description:getMeta('description'),image:getMeta('image'),url:getMeta('url')||url};setC(ck,result,86400000);res.json(result);}catch(err){res.status(500).json({error:err.message});}});
app.get('/news',async(req,res)=>{let query=req.query.q||'';if(!query&&req.query.tags)query=req.query.tags.split(',').map(t=>t.trim()).filter(Boolean).join(' OR ');if(!query)return res.status(400).json({error:'Missing q or tags'});const ck=`news:${query}`;const cached=getC(ck);if(cached)return res.json(cached);try{const r=await axios.get(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=it&gl=IT&ceid=IT:it`,{timeout:12000,headers:{'User-Agent':'Mozilla/5.0'}});const xml=r.data;const items=[];const itemRx=/<item>([\s\S]*?)<\/item>/g;let m;while((m=itemRx.exec(xml))!==null&&items.length<20){const b=m[1];const getTag=tag=>{const x=b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,'i'));return x?x[1].replace(/<[^>]+>/g,'').trim():null;};const linkM=b.match(/<link>(.*?)<\/link>/i);const rawTitle=getTag('title')||'';const srcM=rawTitle.match(/^(.*?)\s+-\s+([^-]+)$/);items.push({title:srcM?srcM[1].trim():rawTitle,source:srcM?srcM[2].trim():'',description:(getTag('description')||'').replace(/&lt;.*?&gt;/g,'').substring(0,200),url:linkM?linkM[1]:null,pubDate:getTag('pubDate')?new Date(getTag('pubDate')).toISOString():new Date().toISOString()});}const result={query,items,fetchedAt:new Date().toISOString()};setC(ck,result,1800000);res.json(result);}catch(err){res.status(500).json({error:err.message});}});

// ═══════════════════════════════════════════════════════════════════════════════
// TRENI
// ═══════════════════════════════════════════════════════════════════════════════
function italianMidnightMs(){const nowMs=Date.now();const year=new Date(nowMs).getUTCFullYear();const lsm=new Date(Date.UTC(year,2,31));while(lsm.getUTCDay()!==0)lsm.setUTCDate(lsm.getUTCDate()-1);lsm.setUTCHours(1,0,0,0);const lso=new Date(Date.UTC(year,9,31));while(lso.getUTCDay()!==0)lso.setUTCDate(lso.getUTCDate()-1);lso.setUTCHours(1,0,0,0);const isDST=nowMs>=lsm.getTime()&&nowMs<lso.getTime();const offsetH=isDST?2:1;const itDate=new Date(nowMs+offsetH*3600000);return Date.UTC(itDate.getUTCFullYear(),itDate.getUTCMonth(),itDate.getUTCDate(),0,0,0)-offsetH*3600000;}
function fmtOrario(ts){if(!ts)return'';try{const d=new Date(ts);return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');}catch{return'';}}
async function cercaTreno(n){let b='';try{const a=await axios.get(`${VT}/cercaNumeroTrenoTrenoAutocomplete/${n}`,{headers:vtH(),timeout:15000,responseType:'text'});b=(a.data||'').toString().trim();}catch{try{const a2=await axios.get(`${VT2}/cercaNumeroTrenoTrenoAutocomplete/${n}`,{headers:vtH(),timeout:15000,responseType:'text'});b=(a2.data||'').toString().trim();}catch{}}if(!b||!b.includes('|'))return[];return b.split('\n').filter(l=>l.includes('|')).map(line=>{const[before,after]=[line.split('|')[0]?.trim()||'',line.split('|')[1]?.trim()||''];const parts=after.split('-');if(parts.length<2)return null;const numTreno=parts[0],codOrigine=parts[1],dataP=parts[2]||String(italianMidnightMs());const stazOrigine=before.replace(/^\d+-/,'').trim();return{numTreno,codOrigine,dataP,label:`${numTreno} da ${stazOrigine}`,stazOrigine};}).filter(Boolean);}
async function andamentoTreno(codOrigine,numTreno,dataP){let b='';try{const r=await axios.get(`${VT}/andamentoTreno/${codOrigine}/${numTreno}/${dataP}`,{headers:vtH(),timeout:15000,responseType:'text'});b=(r.data||'').toString().trim();}catch{try{const r2=await axios.get(`${VT2}/andamentoTreno/${codOrigine}/${numTreno}/${dataP}`,{headers:vtH(),timeout:15000,responseType:'text'});b=(r2.data||'').toString().trim();}catch{}}if(!b||b.startsWith('<')||(!b.startsWith('{')&&b.length<10))return null;try{return JSON.parse(b);}catch{return null;}}
async function vtFetch(tipo,id,ts0){const midnight=italianMidnightMs(),now=Date.now();const midUTC=(()=>{const d=new Date();d.setUTCHours(0,0,0,0);return d.getTime();})();const variants=[ts0>0?ts0:0,midnight,midUTC,now,Math.floor(midnight/1000),Math.floor(midUTC/1000)].filter(t=>t>0);const tried=new Set(),errors=[];for(const ts of variants){const url=`${VT}/${tipo}/${id}/${ts}`;if(tried.has(url))continue;tried.add(url);try{const r=await axios.get(url,{headers:vtH(),timeout:12000,validateStatus:s=>true});if(r.status===200){const raw=(r.data||'').toString().trim();if(raw.startsWith('<')){errors.push(`HTML@${ts}`);continue;}if(Array.isArray(r.data)&&r.data.length>0)return{data:r.data};if(raw.startsWith('[')){try{const j=JSON.parse(raw);if(Array.isArray(j))return{data:j};}catch{}}}}catch(e){errors.push(`err@${ts}`);}}return{data:null,errors};}

app.get('/treno/:numero',async(req,res)=>{try{const opzioni=await cercaTreno(req.params.numero);if(!opzioni.length)return res.status(404).json({error:`Treno ${req.params.numero} non trovato.`});if(opzioni.length>1)return res.json({omonimi:true,opzioni:opzioni.map((o,i)=>({idx:i,label:o.label,stazOrigine:o.stazOrigine}))});const{codOrigine,numTreno,dataP}=opzioni[0];const p=await andamentoTreno(codOrigine,numTreno,dataP);if(!p)return res.status(404).json({error:`Dati treno ${req.params.numero} non disponibili.`});res.json(p);}catch(err){res.status(500).json({error:err.message});}});
app.get('/treno/:numero/scelta/:idx',async(req,res)=>{try{const opzioni=await cercaTreno(req.params.numero);if(!opzioni.length)return res.status(404).json({error:'Treno non trovato.'});const scelta=opzioni[parseInt(req.params.idx)||0]||opzioni[0];const p=await andamentoTreno(scelta.codOrigine,scelta.numTreno,scelta.dataP);if(!p)return res.status(404).json({error:'Dati non disponibili.'});res.json(p);}catch(err){res.status(500).json({error:err.message});}});
app.get('/stazione/cerca',async(req,res)=>{const q=(req.query.q||'').trim();if(q.length<2)return res.json({stazioni:[]});try{let stazioni=[];for(const base of[VT,VT2]){try{const r=await axios.get(`${base}/cercaStazioneAC/${encodeURIComponent(q)}`,{headers:vtH(),timeout:10000,responseType:'text'});const raw=(r.data||'').toString().trim();if(!raw||raw.startsWith('<'))continue;const parsed=raw.split('\n').filter(Boolean).map(line=>{const sep=line.indexOf('|');if(sep<1)return null;const nome=line.slice(0,sep).trim().toUpperCase(),afterPipe=line.slice(sep+1).trim(),parts=afterPipe.split('-'),id=parts[0].trim();const tsStr=parts.find(p=>/^\d{13}$/.test(p))||'',ts=tsStr?parseInt(tsStr):0;return(nome&&id.match(/^S\d{5}$/))?{nomeLungo:nome,id,ts}:null;}).filter(Boolean);if(parsed.length>0){stazioni=parsed;break;}}catch{}}res.json({stazioni:stazioni.slice(0,10)});}catch(e){res.status(500).json({error:e.message});}});
app.get('/stazione/:id/partenze',async(req,res)=>{try{const tsParam=req.query.ts?parseInt(req.query.ts):0;const result=await vtFetch('partenze',req.params.id.trim(),tsParam);if(!result.data)return res.json({partenze:[],message:'ViaggiatrEno non disponibile.'});res.json({partenze:result.data.slice(0,30).map(t=>({numero:t.compNumeroTreno||t.numeroTreno||'',categoria:t.categoria||'',destinazione:(t.destinazione||'').toUpperCase(),orario:t.compOrarioPartenza||fmtOrario(t.orarioPartenza),ritardo:t.ritardo||0,binarioProgrammato:t.binarioProgrammatoPartenzaDescrizione||'',binarioEffettivo:t.binarioEffettivoPartenzaDescrizione||'',inStazione:!!t.inStazione,nonPartito:!!t.nonPartito,cancelled:!!(t.provvedimento===1||t.tipoTreno==='CANC')}))});}catch(e){res.status(500).json({error:e.message});}});
app.get('/stazione/:id/arrivi',async(req,res)=>{try{const tsParam=req.query.ts?parseInt(req.query.ts):0;const result=await vtFetch('arrivi',req.params.id.trim(),tsParam);if(!result.data)return res.json({arrivi:[],message:'ViaggiatrEno non disponibile.'});res.json({arrivi:result.data.slice(0,30).map(t=>({numero:t.compNumeroTreno||t.numeroTreno||'',categoria:t.categoria||'',origine:(t.origine||'').toUpperCase(),orario:t.compOrarioArrivo||fmtOrario(t.orarioArrivo),ritardo:t.ritardo||0,binarioProgrammato:t.binarioProgrammatoArrivoDescrizione||'',binarioEffettivo:t.binarioEffettivoArrivoDescrizione||'',inStazione:!!t.inStazione,cancelled:!!(t.provvedimento===1||t.tipoTreno==='CANC')}))});}catch(e){res.status(500).json({error:e.message});}});

// ═══════════════════════════════════════════════════════════════════════════════
// CALCIO — helpers
// ═══════════════════════════════════════════════════════════════════════════════
const SOCCER_LEAGUES=[
  {slug:'ita.1',name:'Serie A',fd:'SA',isCup:false},{slug:'ita.2',name:'Serie B',fd:null,isCup:false},{slug:'ita.3',name:'Serie C',fd:null,isCup:false},
  {slug:'esp.1',name:'La Liga',fd:'PD',isCup:false},{slug:'eng.1',name:'Premier League',fd:'PL',isCup:false},{slug:'ger.1',name:'Bundesliga',fd:'BL1',isCup:false},{slug:'fra.1',name:'Ligue 1',fd:'FL1',isCup:false},
  {slug:'uefa.champions',name:'Champions League',fd:'CL',isCup:true},{slug:'uefa.europa',name:'Europa League',fd:'EL',isCup:true},{slug:'uefa.conference',name:'Conference League',fd:'ECSL',isCup:true},
  {slug:'ita.coppa_italia',name:'Coppa Italia',fd:null,isCup:true},{slug:'esp.copa_del_rey',name:'Copa del Rey',fd:null,isCup:true},{slug:'eng.fa',name:'FA Cup',fd:'FAC',isCup:true},
  {slug:'ger.dfb_pokal',name:'DFB Pokal',fd:'DFB',isCup:true},{slug:'fra.coupe_de_france',name:'Coppa di Francia',fd:'CDF',isCup:true},
  {slug:'ita.super_cup',name:'Supercoppa Italiana',fd:null,isCup:true},{slug:'esp.super_cup',name:'Supercoppa Spagnola',fd:null,isCup:true},{slug:'uefa.super_cup',name:'UEFA Super Cup',fd:null,isCup:true},
];
const FD_NAME_MAP={milan:98,'ac milan':98,fiorentina:99,roma:100,atalanta:102,bologna:103,cagliari:104,genoa:107,inter:108,internazionale:108,juventus:109,lazio:110,parma:112,napoli:113,udinese:115,verona:450,torino:586,lecce:5890,como:7397,sampdoria:489,venezia:523,brescia:3298,spezia:6212,sassuolo:471,palermo:488,bari:6226,cremonese:457,pisa:487,frosinone:6240,modena:2320,'real madrid':86,barcelona:81,'atletico madrid':78,'manchester city':65,'manchester united':66,liverpool:64,chelsea:61,arsenal:57,tottenham:73,'bayern munich':5,'borussia dortmund':4,psg:524,porto:4284,benfica:1903,ajax:610,'bayer leverkusen':3,'rb leipzig':721};
function normName(n){return(n||'').toLowerCase().replace(/(fc|cf|sc|ac|as|ssc|us|rc|afc|cd|real)/g,'').replace(/\s+/g,' ').trim();}
function parseScore(s){if(s==null)return'';if(typeof s==='object'&&s.value!=null)return String(Math.round(Number(s.value)));const n=Number(s);return(!isNaN(n)&&String(s).trim()!=='')?String(Math.round(n)):'';}
function translateStatus(st){if(!st)return'';const name=st.name||'',desc=(st.description||'').toLowerCase(),detail=st.detail||'';if(name==='STATUS_FULL_TIME'||detail==='FT')return'FT';if(name==='STATUS_EXTRA_TIME'||desc.includes('extra time'))return'dts';if(name==='STATUS_PENALTY'||desc.includes('penalt'))return'dcr';if(name==='STATUS_POSTPONED')return'Rinviata';if(name==='STATUS_CANCELED')return'Annullata';if(name==='STATUS_HALFTIME'||detail==='HT')return'HT';if(name==='STATUS_IN_PROGRESS')return desc||'In Corso';return'';}
function normEvent(e,leagueName,leagueSlug){try{if(!e||typeof e!=='object'||e.$ref)return null;const comp=(e.competitions||[])[0]||{};const comps=comp.competitors||[];if(comps.length<2)return null;let home=null,away=null;for(const c of comps){if(c.homeAway==='home')home=c;else away=c;}if(!home||!away)return null;const hName=home.team?.shortDisplayName||home.team?.displayName||'';const aName=away.team?.shortDisplayName||away.team?.displayName||'';if(!hName&&!aName)return null;const st=comp.status?.type||{};const completed=!!st.completed;let rawRound=comp.notes?.[0]?.headline||comp.type?.text||(e.week?.number?`Giornata ${e.week.number}`:'');if(/advance|on penalties|win \d|loses \d/i.test(rawRound))rawRound='';return{id:String(e.id||''),date:e.date||'',league:leagueName||'',leagueSlug:leagueSlug||'',homeName:hName,awayName:aName,homeScore:completed?parseScore(home.score):'',awayScore:completed?parseScore(away.score):'',homeId:String(home.team?.id||''),awayId:String(away.team?.id||''),completed,live:st.name==='STATUS_IN_PROGRESS',clock:comp.status?.displayClock||'',round:rawRound,statusDetail:translateStatus(comp.status?.type),homeScorePen:home.shootoutScore!=null?String(home.shootoutScore):'',awayScorePen:away.shootoutScore!=null?String(away.shootoutScore):''};}catch{return null;}}
function mapStage(s){if(!s)return'';const fdMap={FINAL:'Finale',SEMI_FINALS:'Semifinale',QUARTER_FINALS:'Quarti di Finale',ROUND_OF_16:'Ottavi di Finale',ROUND_OF_32:'Sedicesimi di Finale',ROUND_OF_64:'Trentaduesimi',GROUP_STAGE:'Fase a Gironi',LEAGUE_STAGE:'Fase Leghe','LEAGUE STAGE':'Fase Leghe',PLAYOFF_ROUND_ONE:'Playoff',PLAYOFFS:'Playoff',QUALIFYING:'Qualificazioni',QUALIFYING_ROUNDS:'Qualificazioni',PRELIMINARY_ROUND:'Turno Preliminare','1ST_LEG':'Andata','2ND_LEG':'Ritorno'};if(fdMap[s])return fdMap[s];const l=s.toLowerCase().trim();if(l.includes('final')||l==='finale')return'Finale';if(l.includes('semi'))return'Semifinale';if(l.includes('quarter')||l.includes('quarti'))return'Quarti di Finale';if(l.includes('round of 16')||l==='last 16')return'Ottavi di Finale';if(l.includes('round of 32')||l==='last 32')return'Sedicesimi di Finale';if(l.includes('league stage'))return'Fase Leghe';if(l.includes('group stage'))return'Fase a Gironi';if(l.includes('playoff'))return'Playoff';if(l.includes('qualifying'))return'Qualificazioni';const gm=l.match(/(?:matchday|giornata|round|md)\s*(\d+)/);if(gm)return`Giornata ${gm[1]}`;return s;}
function mapPhaseByDate(dateStr,slug){if(!dateStr)return'';const d=new Date(dateStr);if(isNaN(d.getTime()))return'';const inR=(y1,m1,d1,y2,m2,d2)=>{const ts=d.getTime();return ts>=new Date(y1,m1-1,d1,0,0,0).getTime()&&ts<=new Date(y2,m2-1,d2,23,59,59).getTime();};if(slug==='uefa.champions'){if(inR(2025,7,1,2025,9,15))return'Turni di Qualificazione';if(inR(2025,9,16,2026,1,31))return'Fase Campionato';if(inR(2026,2,10,2026,2,26))return'Spareggio';if(inR(2026,3,10,2026,3,19))return'Ottavi di Finale';if(inR(2026,4,7,2026,4,16))return'Quarti di Finale';if(inR(2026,4,28,2026,5,7))return'Semifinale';if(inR(2026,5,28,2026,5,31))return'Finale';}if(slug==='uefa.europa'){if(inR(2025,7,1,2025,9,24))return'Turni di Qualificazione';if(inR(2025,9,25,2026,1,31))return'Fase Campionato';if(inR(2026,2,12,2026,2,28))return'Spareggio';if(inR(2026,3,5,2026,3,21))return'Ottavi di Finale';if(inR(2026,4,9,2026,4,18))return'Quarti di Finale';if(inR(2026,4,29,2026,5,9))return'Semifinale';if(inR(2026,5,18,2026,5,22))return'Finale';}if(slug==='uefa.conference'){if(inR(2025,7,10,2025,8,29))return'Turni di Qualificazione';if(inR(2025,9,22,2025,12,21))return'Fase Campionato';if(inR(2026,2,17,2026,2,28))return'Spareggio';if(inR(2026,3,10,2026,3,21))return'Sedicesimi di Finale';if(inR(2026,4,7,2026,4,18))return'Quarti di Finale';if(inR(2026,4,28,2026,5,9))return'Semifinale';if(inR(2026,5,25,2026,5,29))return'Finale';}if(slug==='ita.coppa_italia'){if(inR(2025,8,9,2025,8,11))return'Turno Preliminare';if(inR(2025,8,15,2025,8,19))return'Trentaduesimi di Finale';if(inR(2025,9,22,2025,9,26))return'Sedicesimi di Finale';if(inR(2025,12,1,2026,1,28))return'Ottavi di Finale';if(inR(2026,2,3,2026,2,12))return'Quarti di Finale';if(inR(2026,3,2,2026,4,23))return'Semifinale';if(inR(2026,5,12,2026,5,14))return'Finale';}if(slug==='esp.copa_del_rey'){if(inR(2025,8,26,2025,10,27))return'Turno Preliminare';if(inR(2025,12,1,2025,12,5))return'Sedicesimi di Finale';if(inR(2026,1,3,2026,1,8))return'Ottavi di Finale';if(inR(2026,2,3,2026,2,7))return'Quarti di Finale';if(inR(2026,2,17,2026,4,8))return'Semifinale';if(inR(2026,4,24,2026,4,27))return'Finale';}if(slug==='eng.fa'){if(inR(2025,8,1,2025,10,30))return'Turni di Qualificazione';if(inR(2025,10,31,2025,11,15))return'Primo Turno';if(inR(2025,12,5,2025,12,18))return'Secondo Turno';if(inR(2026,1,8,2026,1,22))return'Terzo Turno';if(inR(2026,1,30,2026,2,12))return'Quarto Turno';if(inR(2026,2,24,2026,3,2))return'Quinto Turno';if(inR(2026,3,18,2026,3,23))return'Quarti di Finale';if(inR(2026,4,17,2026,4,20))return'Semifinale';if(inR(2026,5,15,2026,5,17))return'Finale';}if(slug==='eng.league_cup'){if(inR(2025,8,12,2025,8,15))return'Primo Turno';if(inR(2025,8,26,2025,8,29))return'Secondo Turno';if(inR(2025,9,16,2025,9,19))return'Terzo Turno';if(inR(2025,10,28,2025,10,31))return'Quarto Turno';if(inR(2025,12,16,2025,12,19))return'Quarti di Finale';if(inR(2026,1,6,2026,1,23))return'Semifinale';if(inR(2026,2,21,2026,3,17))return'Finale';}if(slug==='ger.dfb_pokal'){if(inR(2025,8,14,2025,8,19))return'Primo Turno';if(inR(2025,10,27,2025,10,31))return'Secondo Turno';if(inR(2025,12,1,2025,12,5))return'Ottavi di Finale';if(inR(2026,2,3,2026,2,10))return'Quarti di Finale';if(inR(2026,4,20,2026,4,23))return'Semifinale';if(inR(2026,5,22,2026,5,24))return'Finale';}if(slug==='fra.coupe_de_france'){if(inR(2025,8,1,2025,11,30))return'Turni Regionali';if(inR(2025,12,12,2025,12,15))return'Trentaduesimi di Finale';if(inR(2026,1,16,2026,1,19))return'Sedicesimi di Finale';if(inR(2026,2,6,2026,2,9))return'Ottavi di Finale';if(inR(2026,3,6,2026,3,10))return'Quarti di Finale';if(inR(2026,4,21,2026,4,23))return'Semifinale';if(inR(2026,5,22,2026,5,24))return'Finale';}if(['ita.super_cup','esp.super_cup','uefa.super_cup'].includes(slug))return'Finale';return'';}
const fdIdCache=new Map();
async function getFdTeamId(espnId,teamName){if(fdIdCache.has(String(espnId)))return fdIdCache.get(String(espnId));const norm=normName(teamName),words=norm.split(' ').filter(w=>w.length>2);if(FD_NAME_MAP[norm]){fdIdCache.set(String(espnId),FD_NAME_MAP[norm]);return FD_NAME_MAP[norm];}for(const[k,v] of Object.entries(FD_NAME_MAP)){if(words.some(w=>k.includes(w)||w.includes(k.split(' ')[0]))){fdIdCache.set(String(espnId),v);return v;}}const comps=['SA','CL','PD','PL','BL1','FL1','EL'];for(const comp of comps){try{const d=await fd('/competitions/'+comp+'/teams',86400000);for(const t of(d?.teams||[])){const tn=normName(t.name),ts=normName(t.shortName||'');if(words.some(w=>tn.includes(w)||ts===w)){fdIdCache.set(String(espnId),t.id);return t.id;}}}catch{}}return null;}
function mapPosition(p){const m={Goalkeeper:'Portiere',Defence:'Difensore',Midfielder:'Centrocampista',Offence:'Attaccante',Defender:'Difensore',Forward:'Attaccante',Winger:'Ala','Attacking Midfield':'Trequartista','Central Midfield':'Centrocampista','Defensive Midfield':'Mediano','Left Back':'Terzino Sinistro','Right Back':'Terzino Destro','Centre-Back':'Difensore Centrale','Centre-Forward':'Centravanti','Second Striker':'Seconda Punta'};return m[p]||p;}

// CALCIO — endpoint squadre
app.get('/sport/soccer/search',async(req,res)=>{try{const q=(req.query.q||'').toLowerCase().trim();if(q.length<2)return res.json({teams:[]});const seen=new Map();await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{try{const d=await cGet(`${ESPN}/soccer/${lg.slug}/teams`,86400000);for(const t of(d?.sports?.[0]?.leagues?.[0]?.teams||[])){const team=t.team,dn=(team.displayName||'').toLowerCase();if(!dn.includes(q)&&!(team.shortDisplayName||'').toLowerCase().includes(q))continue;if(!seen.has(dn))seen.set(dn,{id:String(team.id),name:team.displayName,shortName:team.shortDisplayName||team.displayName,league:lg.name,leagueSlug:lg.slug});}}catch{}}));if(seen.size===0){try{const d=await sdb(`/searchteams.php?t=${encodeURIComponent(q)}`,3600000);for(const t of(d?.teams||[])){if(!['soccer','football'].includes((t.strSport||'').toLowerCase()))continue;const dn=(t.strTeam||'').toLowerCase();if(!dn.includes(q))continue;if(!seen.has(dn))seen.set(dn,{id:`sdb:${t.idTeam}`,name:t.strTeam,shortName:t.strTeamShort||t.strTeam,league:t.strLeague||'Calcio',leagueSlug:'ita.1'});}}catch{}}res.json({teams:[...seen.values()]});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/soccer/team/:id/events',async(req,res)=>{try{const id=req.params.id;const allEvents=[];const seen=new Set();if(id.startsWith('sdb:')){const sdbId=id.replace('sdb:','');const yr=new Date().getFullYear(),season=`${yr-1}-${yr}`;const[last,next,seas]=await Promise.all([sdb(`/eventslast.php?id=${sdbId}`,1800000).catch(()=>({})),sdb(`/eventsnext.php?id=${sdbId}`,1800000).catch(()=>({})),sdb(`/eventsseason.php?id=${sdbId}&s=${season}`,3600000).catch(()=>({}))]);const normSdb=(e,isDone)=>({id:String(e.idEvent),date:e.dateEvent?(e.dateEvent+'T'+(e.strTime||'00:00:00')):'',league:e.strLeague||'',leagueSlug:'ita.3',homeName:e.strHomeTeam||'',awayName:e.strAwayTeam||'',homeScore:isDone&&e.intHomeScore!=null?String(e.intHomeScore):'',awayScore:isDone&&e.intAwayScore!=null?String(e.intAwayScore):'',homeId:String(e.idHomeTeam||''),awayId:String(e.idAwayTeam||''),completed:isDone,live:false,clock:'',round:e.intRound?`Giornata ${e.intRound}`:'',statusDetail:''});const now=new Date(),seenL=new Set(),all=[];for(const e of(last?.results||last?.events||[])){if(!seenL.has(e.idEvent)){seenL.add(e.idEvent);all.push(normSdb(e,true));}}for(const e of(seas?.events||[])){if(seenL.has(e.idEvent))continue;seenL.add(e.idEvent);all.push(normSdb(e,e.intHomeScore!=null||(new Date(e.dateEvent||'2000-01-01')<now)));}for(const e of(next?.events||[])){if(!seenL.has(e.idEvent)){seenL.add(e.idEvent);all.push(normSdb(e,false));}}all.sort((a,b)=>new Date(a.date)-new Date(b.date));return res.json({events:all});}await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{try{const d=await cGet(`${ESPN}/soccer/${lg.slug}/teams/${id}/schedule`,3600000);for(const e of(d?.events||[])){const ne=normEvent(e,lg.name,lg.slug);if(!ne||!ne.completed||seen.has(ne.id))continue;seen.add(ne.id);allEvents.push(ne);}}catch{}}));const now=new Date(),from=now.toISOString().slice(0,10).replace(/-/g,''),to=new Date(now.getTime()+90*864e5).toISOString().slice(0,10).replace(/-/g,'');await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{try{const d=await cGet(`${ESPN}/soccer/${lg.slug}/scoreboard?dates=${from}-${to}`,300000);for(const e of(d?.events||[])){const ne=normEvent(e,lg.name,lg.slug);if(!ne||seen.has(ne.id))continue;if(ne.homeId!==id&&ne.awayId!==id)continue;seen.add(ne.id);allEvents.push(ne);}}catch{}}));allEvents.sort((a,b)=>new Date(a.date)-new Date(b.date));const cupSlugs=new Set(['uefa.champions','uefa.europa','uefa.conference','ita.coppa_italia','esp.copa_del_rey','eng.fa','ger.dfb_pokal','fra.coupe_de_france']);for(const e of allEvents){if(!cupSlugs.has(e.leagueSlug)||!e.date)continue;const ph=mapPhaseByDate(e.date,e.leagueSlug);if(ph)e.round=ph;}res.json({events:allEvents});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/soccer/team/:id/leagues',async(req,res)=>{try{const id=req.params.id;const map=new Map();await Promise.all(SOCCER_LEAGUES.map(async(lg)=>{try{const d=await cGet(`${ESPN}/soccer/${lg.slug}/teams/${id}/schedule`,3600000);if((d?.events||[]).some(e=>e&&!e.$ref)){map.set(lg.slug,{slug:lg.slug,name:lg.name,isCup:lg.isCup||false});return;}}catch{}if(lg.isCup){try{const now=new Date(),from=new Date(now.getTime()-180*864e5).toISOString().slice(0,10).replace(/-/g,''),to=new Date(now.getTime()+180*864e5).toISOString().slice(0,10).replace(/-/g,'');const d=await cGet(`${ESPN}/soccer/${lg.slug}/scoreboard?dates=${from}-${to}`,3600000);const found=(d?.events||[]).some(e=>{const ne=normEvent(e,'','');return ne&&(ne.homeId===id||ne.awayId===id);});if(found)map.set(lg.slug,{slug:lg.slug,name:lg.name,isCup:true});}catch{}}}));const main=req.query.main;if(main&&!map.has(main)){const f=SOCCER_LEAGUES.find(l=>l.slug===main);if(f)map.set(main,{slug:main,name:f.name,isCup:f.isCup||false});}res.json({leagues:[...map.values()]});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/soccer/:league/standings',async(req,res)=>{try{const slug=req.params.league,yr=new Date().getFullYear();for(const y of[yr,yr-1]){for(const url of[`${ESPN2}/soccer/${slug}/standings?season=${y}`,`${ESPN}/soccer/${slug}/standings`]){try{const d=await cGet(url,3600000);let entries=[];for(const g of(d.children||[]))entries.push(...(g.standings?.entries||[]));if(!entries.length)entries=d.standings?.entries||[];if(entries.length>0)return res.json({standings:entries.map((e,i)=>{const stats={};for(const s of(e.stats||[]))stats[s.name]=s.value;return{rank:Math.round(stats['rank']||i+1),name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||e.team?.displayName||'',teamId:String(e.team?.id||''),played:Math.round(stats['gamesPlayed']||0),wins:Math.round(stats['wins']||0),draws:Math.round(stats['ties']||stats['draws']||0),losses:Math.round(stats['losses']||0),points:Math.round(stats['points']||0),gd:Math.round(stats['pointDifferential']||0)};})});}catch{}}}const lg=SOCCER_LEAGUES.find(l=>l.slug===slug);if(lg?.fd){try{const d=await fd(`/competitions/${lg.fd}/standings`,3600000);const table=d?.standings?.find(s=>s.type==='TOTAL')?.table||[];if(table.length>0)return res.json({standings:table.map(e=>({rank:e.position,name:e.team?.name||'',shortName:e.team?.shortName||'',teamId:'fd:'+e.team?.id,played:e.playedGames||0,wins:e.won||0,draws:e.draw||0,losses:e.lost||0,points:e.points||0,gd:e.goalDifference||0}))});}catch{}}res.json({standings:[]});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/soccer/:league/live',async(req,res)=>{try{res.set('Cache-Control','no-store');const r=await axios.get(`${ESPN}/soccer/${req.params.league}/scoreboard`,{timeout:8000,headers:{'Cache-Control':'no-cache'}});res.json({events:(r.data?.events||[]).map(e=>normEvent(e,'',req.params.league)).filter(Boolean)});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/soccer/team/:id/roster',async(req,res)=>{try{const espnId=String(req.params.id),name=(req.query.name||'').trim();if(espnId.startsWith('sdb:')){const sdbId=espnId.replace('sdb:','');const p=await sdb('/lookup_all_players.php?id='+sdbId,86400000).catch(()=>null);if((p?.player||[]).length>0)return res.json({player:p.player.map(pl=>({idPlayer:String(pl.idPlayer),strPlayer:pl.strPlayer||'',strPosition:mapPosition(pl.strPosition||''),strNationality:pl.strNationality||'',strNumber:pl.strNumber||''}))});return res.json({player:[]});}let fdId=null;const norm=normName(name),words=norm.split(' ').filter(w=>w.length>2);if(FD_NAME_MAP[norm])fdId=FD_NAME_MAP[norm];else for(const[k,v] of Object.entries(FD_NAME_MAP)){if(words.some(w=>k===w||k.startsWith(w)||w.startsWith(k.split(' ')[0]))){fdId=v;break;}}if(!fdId)fdId=await getFdTeamId(espnId,name).catch(()=>null);if(fdId){const d=await fd('/teams/'+fdId,86400000).catch(()=>null);const squad=d?.squad||[];if(squad.length>0)return res.json({player:squad.map(p=>({idPlayer:String(p.id),strPlayer:p.name||'',strPosition:mapPosition(p.position||''),strNationality:p.nationality||'',strNumber:'',dateOfBirth:p.dateOfBirth||''}))});}const sd=await sdb('/searchteams.php?t='+encodeURIComponent(name),3600000).catch(()=>null);const sdbTeams=(sd?.teams||[]).filter(t=>['soccer','football'].includes((t.strSport||'').toLowerCase()));if(sdbTeams.length>0){const p=await sdb('/lookup_all_players.php?id='+sdbTeams[0].idTeam,86400000).catch(()=>null);if((p?.player||[]).length>0)return res.json({player:p.player});}res.json({player:[]});}catch(e){res.status(500).json({error:e.message});}});

const IT_TROPHIES={juventus:{name:'Juventus',total:71,national:[{name:'Serie A',icon:'🏆',count:36},{name:'Coppa Italia',icon:'🏆',count:15},{name:'Supercoppa Italiana',icon:'🏆',count:9}],international:[{name:'Champions League',icon:'⭐',count:2},{name:'Coppa UEFA',icon:'⭐',count:3},{name:'Supercoppa UEFA',icon:'⭐',count:2},{name:'Coppa Intercontinentale',icon:'⭐',count:2},{name:'Coppa delle Coppe UEFA',icon:'⭐',count:1}]},inter:{name:'Inter',total:48,national:[{name:'Serie A',icon:'🏆',count:20},{name:'Coppa Italia',icon:'🏆',count:9},{name:'Supercoppa Italiana',icon:'🏆',count:7}],international:[{name:'Champions League',icon:'⭐',count:3},{name:'Coppa UEFA',icon:'⭐',count:3},{name:'Supercoppa UEFA',icon:'⭐',count:2},{name:'Coppa Intercontinentale',icon:'⭐',count:2}]},milan:{name:'Milan',total:49,national:[{name:'Serie A',icon:'🏆',count:19},{name:'Coppa Italia',icon:'🏆',count:5},{name:'Supercoppa Italiana',icon:'🏆',count:7}],international:[{name:'Champions League',icon:'⭐',count:7},{name:'Supercoppa UEFA',icon:'⭐',count:5},{name:'Coppa Intercontinentale',icon:'⭐',count:2},{name:'Coppa delle Coppe UEFA',icon:'⭐',count:2}]},roma:{name:'Roma',total:14,national:[{name:'Serie A',icon:'🏆',count:3},{name:'Coppa Italia',icon:'🏆',count:9},{name:'Supercoppa Italiana',icon:'🏆',count:2}],international:[{name:'Conference League',icon:'⭐',count:1}]},napoli:{name:'Napoli',total:12,national:[{name:'Serie A',icon:'🏆',count:3},{name:'Coppa Italia',icon:'🏆',count:6},{name:'Supercoppa Italiana',icon:'🏆',count:2}],international:[{name:'Coppa UEFA',icon:'⭐',count:1}]},lazio:{name:'Lazio',total:18,national:[{name:'Serie A',icon:'🏆',count:2},{name:'Coppa Italia',icon:'🏆',count:7},{name:'Supercoppa Italiana',icon:'🏆',count:5}],international:[{name:'Coppa delle Coppe UEFA',icon:'⭐',count:1},{name:'Supercoppa UEFA',icon:'⭐',count:1}]},fiorentina:{name:'Fiorentina',total:13,national:[{name:'Serie A',icon:'🏆',count:2},{name:'Coppa Italia',icon:'🏆',count:6},{name:'Supercoppa Italiana',icon:'🏆',count:1}],international:[{name:'Coppa delle Coppe UEFA',icon:'⭐',count:1},{name:'Coppa Mitropa',icon:'⭐',count:2}]},atalanta:{name:'Atalanta',total:3,national:[{name:'Coppa Italia',icon:'🏆',count:1}],international:[{name:'Europa League',icon:'⭐',count:1}]},torino:{name:'Torino',total:14,national:[{name:'Serie A',icon:'🏆',count:7},{name:'Coppa Italia',icon:'🏆',count:5},{name:'Supercoppa Italiana',icon:'🏆',count:1}],international:[]},sampdoria:{name:'Sampdoria',total:8,national:[{name:'Serie A',icon:'🏆',count:1},{name:'Coppa Italia',icon:'🏆',count:4},{name:'Supercoppa Italiana',icon:'🏆',count:1}],international:[{name:'Coppa delle Coppe UEFA',icon:'⭐',count:1}]},bologna:{name:'Bologna',total:10,national:[{name:'Serie A',icon:'🏆',count:7},{name:'Coppa Italia',icon:'🏆',count:2}],international:[{name:'Coppa Mitropa',icon:'⭐',count:1}]},genoa:{name:'Genoa',total:13,national:[{name:'Serie A',icon:'🏆',count:9},{name:'Coppa Italia',icon:'🏆',count:1}],international:[{name:'Coppa Mitropa',icon:'⭐',count:3}]},parma:{name:'Parma',total:11,national:[{name:'Coppa Italia',icon:'🏆',count:3},{name:'Supercoppa Italiana',icon:'🏆',count:2}],international:[{name:'Coppa UEFA',icon:'⭐',count:2},{name:'Coppa delle Coppe UEFA',icon:'⭐',count:1},{name:'Supercoppa UEFA',icon:'⭐',count:1}]},cagliari:{name:'Cagliari',total:1,national:[{name:'Serie A',icon:'🏆',count:1}],international:[]},verona:{name:'Verona',total:1,national:[{name:'Serie A',icon:'🏆',count:1}],international:[]}};
function getItTrophies(name){if(!name)return null;const n=name.toLowerCase().replace(/[^a-z0-9]/g,' ').trim();for(const[k,v] of Object.entries(IT_TROPHIES)){if(n===k||n.includes(k)||k.includes(n))return v;}const words=n.split(' ').filter(w=>w.length>3);for(const[k,v] of Object.entries(IT_TROPHIES)){if(words.some(w=>w===k||k.includes(w)||w.includes(k)))return v;}return null;}

app.get('/sport/soccer/team/:id/stats',async(req,res)=>{try{const id=req.params.id,name=(req.query.name||'').trim(),yr=new Date().getFullYear();let W=0,D=0,L=0,GF=0,GA=0,played=0;const trophies=[];let sdbId=null;try{if(id.startsWith('sdb:'))sdbId=id.replace('sdb:','');else{const s=await sdb(`/searchteams.php?t=${encodeURIComponent(name)}`,86400000);sdbId=s?.teams?.[0]?.idTeam||null;}}catch{}const itEntry=getItTrophies(name);if(itEntry)trophies.push({_itEntry:true,data:itEntry});else if(sdbId){try{const tr=await sdb(`/lookuptrophies.php?id=${sdbId}`,86400000);for(const t of(tr?.trophies||[]))if(t.strTrophy)trophies.push({name:t.strTrophy,season:t.strSeason||'',league:t.strLeague||''});}catch{}}if(!id.startsWith('sdb:')){try{const nameKey=(name||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();let fdId=FD_NAME_MAP[nameKey];if(!fdId)for(const[k,v] of Object.entries(FD_NAME_MAP)){if(nameKey&&(nameKey.includes(k)||k.includes(nameKey))){fdId=v;break;}}if(!fdId)fdId=await getFdTeamId(id,name).catch(()=>null);if(fdId){const r=await axios.get(`https://api.football-data.org/v4/teams/${fdId}/matches?status=FINISHED&limit=60`,{timeout:10000,headers:FD_H});for(const m of(r.data?.matches||[]).filter(m=>new Date(m.utcDate).getFullYear()>=yr-1)){const isHome=m.homeTeam?.id===fdId,hs=m.score?.fullTime?.home,as_=m.score?.fullTime?.away;if(hs==null||as_==null)continue;const mygf=isHome?hs:as_,myga=isHome?as_:hs;GF+=mygf;GA+=myga;if(mygf>myga)W++;else if(mygf===myga)D++;else L++;}played=W+D+L;}}catch{}}res.json({stats:played>0?{played,W,D,L,GF,GA,season:`${yr-1}-${yr}`}:null,trophies});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/soccer/standings/all',async(req,res)=>{
  const leagues=[{slug:'ita.1',name:'Serie A',flag:'IT'},{slug:'ita.2',name:'Serie B',flag:'IT'},{slug:'esp.1',name:'La Liga',flag:'ES'},{slug:'eng.1',name:'Premier League',flag:'GB'},{slug:'ger.1',name:'Bundesliga',flag:'DE'},{slug:'fra.1',name:'Ligue 1',flag:'FR'}];
  const results=await Promise.all(leagues.map(async(lg)=>{
    try{
      const yr=new Date().getFullYear();let entries=[];
      for(const y of[yr,yr-1]){
        for(const url of[`${ESPN2}/soccer/${lg.slug}/standings?season=${y}`,`${ESPN}/soccer/${lg.slug}/standings`]){
          try{const d=await cGet(url,3600000);for(const g of(d.children||[]))entries.push(...(g.standings?.entries||[]));if(!entries.length)entries=d.standings?.entries||[];if(entries.length)break;}catch{}
          if(entries.length)break;
        }
        if(entries.length)break;
      }
      if(!entries.length)return null;
      return{slug:lg.slug,name:lg.name,flag:lg.flag||'',standings:entries.map((e,i)=>{
        const stats={};for(const s of(e.stats||[]))stats[s.name]=s.value;
        return{rank:Math.round(stats['rank']||i+1),name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||e.team?.displayName||'',teamId:String(e.team?.id||''),played:Math.round(stats['gamesPlayed']||0),wins:Math.round(stats['wins']||0),draws:Math.round(stats['ties']||stats['draws']||0),losses:Math.round(stats['losses']||0),points:Math.round(stats['points']||0),gd:Math.round(stats['pointDifferential']||0)};
      })};
    }catch{return null;}
  }));
  res.json({leagues:results.filter(Boolean)});
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALCIO — COPPE
// ═══════════════════════════════════════════════════════════════════════════════
const CUP_CALENDARS=[
  {slug:'uefa.champions',name:'Champions League',group:'Europa',fd:'CL',phases:[{name:'Turni di Qualificazione',from:'20250701',to:'20250916'},{name:'Fase Campionato',from:'20250917',to:'20260129'},{name:'Spareggio',from:'20260210',to:'20260227'},{name:'Ottavi di Finale',from:'20260304',to:'20260320'},{name:'Quarti di Finale',from:'20260401',to:'20260417'},{name:'Semifinale',from:'20260428',to:'20260508'},{name:'Finale',from:'20260527',to:'20260601'}]},
  {slug:'uefa.europa',name:'Europa League',group:'Europa',fd:'EL',phases:[{name:'Turni di Qualificazione',from:'20250701',to:'20250925'},{name:'Fase Campionato',from:'20250926',to:'20260130'},{name:'Spareggio',from:'20260211',to:'20260227'},{name:'Ottavi di Finale',from:'20260305',to:'20260321'},{name:'Quarti di Finale',from:'20260409',to:'20260419'},{name:'Semifinale',from:'20260430',to:'20260510'},{name:'Finale',from:'20260521',to:'20260522'}]},
  {slug:'uefa.conference',name:'Conference League',group:'Europa',fd:'ECSL',sofaId:116,phases:[{name:'Turni di Qualificazione',from:'20250701',to:'20250829'},{name:'Fase Campionato',from:'20250922',to:'20251221'},{name:'Spareggio',from:'20260212',to:'20260228'},{name:'Sedicesimi di Finale',from:'20260305',to:'20260321'},{name:'Quarti di Finale',from:'20260409',to:'20260419'},{name:'Semifinale',from:'20260430',to:'20260510'},{name:'Finale',from:'20260526',to:'20260528'}]},
  {slug:'uefa.super_cup',name:'Supercoppa UEFA',group:'Europa',fd:null,phases:[{name:'Finale',from:'20250812',to:'20250814'}]},
  {slug:'ita.coppa_italia',name:'Coppa Italia',group:'Italia',fd:null,sofaId:285,sofaSeason:67913,phases:[{name:'Turno Preliminare',from:'20250809',to:'20250811'},{name:'Trentaduesimi di Finale',from:'20250815',to:'20250819'},{name:'Sedicesimi di Finale',from:'20250922',to:'20250926'},{name:'Ottavi di Finale',from:'20251128',to:'20260122'},{name:'Quarti di Finale',from:'20260203',to:'20260213'},{name:'Semifinale',from:'20260302',to:'20260425'},{name:'Finale',from:'20260513',to:'20260514'}]},
  {slug:'ita.super_cup',name:'Supercoppa Italiana',group:'Italia',fd:null,phases:[{name:'Finale',from:'20260101',to:'20260120'}]},
  {slug:'esp.copa_del_rey',name:'Copa del Rey',group:'Spagna',fd:null,sofaId:329,phases:[{name:'Turno Preliminare',from:'20250826',to:'20251025'},{name:'Sedicesimi di Finale',from:'20251126',to:'20251130'},{name:'Ottavi di Finale',from:'20260102',to:'20260109'},{name:'Quarti di Finale',from:'20260113',to:'20260123'},{name:'Semifinale',from:'20260218',to:'20260411'},{name:'Finale',from:'20260425',to:'20260427'}]},
  {slug:'esp.super_cup',name:'Supercoppa Spagnola',group:'Spagna',fd:null,phases:[{name:'Finale',from:'20260108',to:'20260113'}]},
  {slug:'eng.fa',name:'FA Cup',group:'Inghilterra',fd:'FAC',phases:[{name:'Turni di Qualificazione',from:'20250801',to:'20251030'},{name:'Primo Turno',from:'20251031',to:'20251114'},{name:'Secondo Turno',from:'20251204',to:'20251214'},{name:'Terzo Turno',from:'20260108',to:'20260122'},{name:'Quarto Turno',from:'20260130',to:'20260215'},{name:'Quinto Turno',from:'20260224',to:'20260302'},{name:'Quarti di Finale',from:'20260317',to:'20260323'},{name:'Semifinale',from:'20260416',to:'20260421'},{name:'Finale',from:'20260515',to:'20260517'}]},
  {slug:'eng.league_cup',name:'EFL Cup',group:'Inghilterra',fd:null,phases:[{name:'Primo Turno',from:'20250812',to:'20250815'},{name:'Secondo Turno',from:'20250826',to:'20250829'},{name:'Terzo Turno',from:'20250916',to:'20250919'},{name:'Quarto Turno',from:'20251028',to:'20251031'},{name:'Quarti di Finale',from:'20251216',to:'20251219'},{name:'Semifinale',from:'20260106',to:'20260123'},{name:'Finale',from:'20260309',to:'20260317'}]},
  {slug:'ger.dfb_pokal',name:'DFB Pokal',group:'Germania',fd:'DFB',phases:[{name:'Primo Turno',from:'20250814',to:'20250818'},{name:'Secondo Turno',from:'20251027',to:'20251031'},{name:'Ottavi di Finale',from:'20251201',to:'20251206'},{name:'Quarti di Finale',from:'20260201',to:'20260210'},{name:'Semifinale',from:'20260420',to:'20260424'},{name:'Finale',from:'20260522',to:'20260524'}]},
  {slug:'fra.coupe_de_france',name:'Coupe de France',group:'Francia',fd:'CDF',phases:[{name:'Turni Regionali',from:'20250801',to:'20251130'},{name:'Trentaduesimi di Finale',from:'20251218',to:'20251222'},{name:'Sedicesimi di Finale',from:'20260110',to:'20260122'},{name:'Ottavi di Finale',from:'20260201',to:'20260215'},{name:'Quarti di Finale',from:'20260304',to:'20260310'},{name:'Semifinale',from:'20260420',to:'20260424'},{name:'Finale',from:'20260522',to:'20260524'}]},
];

function dateChunks(from, to, days) {
  const chunks = [];
  let cur = new Date(parseInt(from.slice(0,4)), parseInt(from.slice(4,6))-1, parseInt(from.slice(6,8)));
  const end = new Date(parseInt(to.slice(0,4)), parseInt(to.slice(4,6))-1, parseInt(to.slice(6,8)));
  const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  while (cur <= end) {
    const ce = new Date(cur.getTime() + days * 86400000);
    chunks.push([fmt(cur), fmt(ce > end ? end : ce)]);
    cur = new Date(ce.getTime() + 86400000);
  }
  return chunks;
}

async function fetchSofascore(cup) {
  if (!cup.sofaId) return [];
  const ck = `sofa:${cup.slug}`;
  const cached = getC(ck);
  if (cached) return cached;
  const events = [], seen = new Set();
  try {
    const headers = {'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1','Referer':'https://www.sofascore.com/','Accept':'application/json'};
    let sofaSeason = cup.sofaSeason || 0;
    if (!sofaSeason) {
      try {
        const sr = await axios.get(`https://api.sofascore.com/api/v1/unique-tournament/${cup.sofaId}/seasons`, {headers, timeout:8000});
        const seasons = sr.data?.seasons || [];
        const cur = seasons.find(s => (s.year||'').includes('25/26') || (s.year||'').includes('2025'));
        sofaSeason = cur ? cur.id : (seasons[0] ? seasons[0].id : 0);
      } catch {}
    }
    if (!sofaSeason) return [];
    for (const type of ['last','next']) {
      try {
        const r = await axios.get(`https://api.sofascore.com/api/v1/unique-tournament/${cup.sofaId}/season/${sofaSeason}/events/${type}/0`, {headers, timeout:10000});
        for (const e of (r.data?.events || [])) {
          const eid = `sofa:${e.id}`;
          if (seen.has(eid)) continue;
          seen.add(eid);
          const dt = e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : '';
          const mDate = dt.replace(/-/g,'').slice(0,8);
          const phase = cup.phases.find(p => mDate >= p.from && mDate <= p.to);
          if (!phase) continue;
          events.push({id:eid,date:dt,league:cup.name,leagueSlug:cup.slug,homeName:e.homeTeam?.name||'',awayName:e.awayTeam?.name||'',homeScore:e.homeScore?.current!=null?String(e.homeScore.current):'',awayScore:e.awayScore?.current!=null?String(e.awayScore.current):'',homeId:'',awayId:'',completed:e.status?.type==='finished',live:e.status?.type==='inprogress',clock:'',round:phase.name,statusDetail:e.status?.description?.includes('penalties')?'dcr':e.status?.description?.includes('extra')?'dts':''});
        }
      } catch {}
    }
  } catch {}
  setC(ck, events, 1800000);
  return events;
}

const KNOWN_MATCHES = [
  {slug:'eng.league_cup',round:'Finale',date:'2026-03-16T16:30:00Z',home:'Man City',away:'Arsenal',hs:'2',as_:'1',done:true},
  {slug:'eng.fa',round:'Quinto Turno',date:'2026-02-25T19:45:00Z',home:'Arsenal',away:'Newcastle',hs:'2',as_:'0',done:true},
  {slug:'eng.fa',round:'Quinto Turno',date:'2026-02-25T19:45:00Z',home:'Man City',away:'Burnley',hs:'4',as_:'0',done:true},
  {slug:'eng.fa',round:'Quinto Turno',date:'2026-02-26T19:45:00Z',home:'Liverpool',away:'Southampton',hs:'3',as_:'1',done:true},
  {slug:'eng.fa',round:'Quinto Turno',date:'2026-02-26T19:45:00Z',home:'Chelsea',away:'Leeds',hs:'1',as_:'0',done:true},
  {slug:'eng.fa',round:'Quarti di Finale',date:'2026-03-21T15:00:00Z',home:'Arsenal',away:'Man City',hs:'1',as_:'0',done:true},
  {slug:'eng.fa',round:'Quarti di Finale',date:'2026-03-21T17:30:00Z',home:'Aston Villa',away:'Liverpool',hs:'0',as_:'2',done:true},
  {slug:'eng.fa',round:'Quarti di Finale',date:'2026-03-22T14:00:00Z',home:'Fulham',away:'Newcastle',hs:'1',as_:'3',done:true},
  {slug:'eng.fa',round:'Quarti di Finale',date:'2026-03-22T16:30:00Z',home:'Chelsea',away:'Wolves',hs:'2',as_:'0',done:true},
  {slug:'eng.fa',round:'Semifinale',date:'2026-04-18T14:00:00Z',home:'Arsenal',away:'Newcastle',hs:'',as_:'',done:false},
  {slug:'eng.fa',round:'Semifinale',date:'2026-04-19T14:00:00Z',home:'Liverpool',away:'Chelsea',hs:'',as_:'',done:false},
  {slug:'eng.fa',round:'Finale',date:'2026-05-16T14:00:00Z',home:'TBD',away:'TBD',hs:'',as_:'',done:false},
  {slug:'esp.copa_del_rey',round:'Finale',date:'2026-04-25T19:00:00Z',home:'TBD',away:'TBD',hs:'',as_:'',done:false},
  {slug:'ita.coppa_italia',round:'Finale',date:'2026-05-14T19:00:00Z',home:'TBD',away:'TBD',hs:'',as_:'',done:false},
  {slug:'ger.dfb_pokal',round:'Finale',date:'2026-05-23T17:00:00Z',home:'TBD',away:'TBD',hs:'',as_:'',done:false},
  {slug:'uefa.europa',round:'Finale',date:'2026-05-21T19:00:00Z',home:'TBD',away:'TBD',hs:'',as_:'',done:false},
];

app.get('/sport/soccer/cups', async (req, res) => {
  try {
    const results = [];
    for (const cup of CUP_CALENDARS) {
      const phaseNames = cup.phases.map(p => p.name);
      const byKey = new Map();
      const addEv = (e, prio) => {
        if (!e || !e.homeName || !e.awayName) return;
        const dk = (e.date||'').slice(0,10);
        const hk = e.homeName.toLowerCase().replace(/\s+/g,'').slice(0,6);
        const ak = e.awayName.toLowerCase().replace(/\s+/g,'').slice(0,6);
        const key = `${dk}_${hk}_${ak}`;
        const ex = byKey.get(key);
        if (!ex || prio > (ex._prio||0) || (e.homeScore && !ex.homeScore)) {
          e._prio = prio;
          byKey.set(key, e);
        }
      };

      // Fonte 0: hardcoded
      for (const km of KNOWN_MATCHES) {
        if (km.slug !== cup.slug) continue;
        addEv({id:`known_${km.slug}_${km.date}`,date:km.date,league:cup.name,leagueSlug:cup.slug,homeName:km.home,awayName:km.away,homeScore:km.hs,awayScore:km.as_,homeId:'',awayId:'',completed:km.done,live:false,clock:'',round:km.round,statusDetail:''}, 4);
      }

      // Fonte 1: Football-Data
      if (cup.fd) {
        try {
          const yr = new Date().getFullYear();
          let allFd = [];
          for (const season of [yr-1, yr-2]) {
            const d = await fd(`/competitions/${cup.fd}/matches?season=${season}`, 1800000).catch(() => null);
            if (d?.matches?.length) { allFd = d.matches; break; }
          }
          for (const status of ['SCHEDULED','TIMED','FINISHED']) {
            try {
              const d = await fd(`/competitions/${cup.fd}/matches?status=${status}`, 900000).catch(() => null);
              const existIds = new Set(allFd.map(m => m.id));
              for (const m of (d?.matches || [])) {
                if (!existIds.has(m.id)) { existIds.add(m.id); allFd.push(m); }
              }
            } catch {}
          }
          for (const m of allFd) {
            const mDate = (m.utcDate||'').replace(/-/g,'').slice(0,8);
            const phase = cup.phases.find(p => mDate >= p.from && mDate <= p.to);
            if (!phase) continue;
            addEv({id:`fd:${m.id}`,date:m.utcDate||'',league:cup.name,leagueSlug:cup.slug,homeName:m.homeTeam?.shortName||m.homeTeam?.name||'',awayName:m.awayTeam?.shortName||m.awayTeam?.name||'',homeScore:m.score?.fullTime?.home!=null?String(m.score.fullTime.home):'',awayScore:m.score?.fullTime?.away!=null?String(m.score.fullTime.away):'',homeId:'',awayId:'',completed:['FINISHED','AWARDED'].includes(m.status),live:m.status==='IN_PLAY',clock:'',round:phase.name,statusDetail:m.score?.duration==='PENALTY_SHOOTOUT'?'dcr':m.score?.duration==='EXTRA_TIME'?'dts':''}, 3);
          }
        } catch {}
      }

      // Fonte 2: ESPN — GUARD anti-timeout: salta fasi chiuse da >90gg
      for (const phase of cup.phases) {
        const phEnd = new Date(parseInt(phase.to.slice(0,4)), parseInt(phase.to.slice(4,6))-1, parseInt(phase.to.slice(6,8)));
        if ((Date.now() - phEnd.getTime()) / 86400000 > 90) continue;
        const chunks = dateChunks(phase.from, phase.to, 7);
        for (const [cfrom, cto] of chunks) {
          try {
            const d = await cGet(`${ESPN}/soccer/${cup.slug}/scoreboard?dates=${cfrom}-${cto}`, 900000);
            for (const e of (d?.events || [])) {
              const ne = normEvent(e, cup.name, cup.slug);
              if (!ne) continue;
              ne.round = phase.name;
              addEv(ne, 2);
            }
          } catch {}
        }
      }

      // Fonte 3: Sofascore
      if (cup.sofaId) {
        try {
          const evs = await fetchSofascore(cup);
          for (const e of evs) addEv(e, 2);
        } catch {}
      }

      const allEvents = [...byKey.values()];
      if (allEvents.length === 0) {
        const isEur = ['uefa.champions','uefa.europa','uefa.conference'].includes(cup.slug);
        if (!isEur) continue;
        results.push({slug:cup.slug,name:cup.name,group:cup.group,phases:[{name:'Dati in caricamento',events:[]}],totalEvents:0});
        continue;
      }

      const phaseMap = new Map();
      for (const ph of phaseNames) phaseMap.set(ph, []);
      for (const e of allEvents) {
        const ph = e.round || '';
        if (phaseMap.has(ph)) phaseMap.get(ph).push(e);
        else { if (!phaseMap.has('Altre')) phaseMap.set('Altre',[]); phaseMap.get('Altre').push(e); }
      }
      const phases = [...phaseMap.entries()]
        .filter(([, evs]) => evs.length > 0)
        .sort((a, b) => { const ai=phaseNames.indexOf(a[0]),bi=phaseNames.indexOf(b[0]); if(ai>=0&&bi>=0)return ai-bi; if(ai>=0)return-1; if(bi>=0)return 1; return 0; })
        .map(([name, evs]) => ({name, events: evs.sort((a,b)=>new Date(a.date)-new Date(b.date)).map(e=>{delete e._prio;return e;})}));

      results.push({slug:cup.slug,name:cup.name,group:cup.group,phases,totalEvents:allEvents.length});
    }
    res.json({cups: results});
  } catch (e) { res.status(500).json({error: e.message}); }
});

// Mondiali 2026 — gironi statici (senza segnaposto playoff)
const WC2026_GROUPS={A:[{t:'Messico'},{t:'Corea del Sud'},{t:'Rep. Ceca'},{t:'Sudafrica'}],B:[{t:'Canada'},{t:'Bosnia-Erz.'},{t:'Qatar'},{t:'Svizzera'}],C:[{t:'Brasile'},{t:'Marocco'},{t:'Haiti'},{t:'Scozia'}],D:[{t:'USA'},{t:'Turchia'},{t:'Australia'},{t:'Paraguay'}],E:[{t:'Germania'},{t:'Curacao'},{t:'Costa d\'Avorio'},{t:'Ecuador'}],F:[{t:'Olanda'},{t:'Giappone'},{t:'Svezia'},{t:'Tunisia'}],G:[{t:'Belgio'},{t:'Egitto'},{t:'Iran'},{t:'Nuova Zelanda'}],H:[{t:'Spagna'},{t:'Capo Verde'},{t:'Arabia Saudita'},{t:'Uruguay'}],I:[{t:'Francia'},{t:'Senegal'},{t:'Iraq'},{t:'Norvegia'}],J:[{t:'Argentina'},{t:'Algeria'},{t:'Austria'},{t:'Giordania'}],K:[{t:'Portogallo'},{t:'Congo RD'},{t:'Uzbekistan'},{t:'Colombia'}],L:[{t:'Inghilterra'},{t:'Croazia'},{t:'Ghana'},{t:'Panama'}]};
const WC_IT_MAP={'Mexico':'Messico','South Korea':'Corea del Sud','South Africa':'Sudafrica','Czech Republic':'Rep. Ceca','Czechia':'Rep. Ceca','Switzerland':'Svizzera','United States':'USA','Morocco':'Marocco','Scotland':'Scozia','Germany':'Germania','Ecuador':'Ecuador','Ivory Coast':'Costa d\'Avorio','Cote d\'Ivoire':'Costa d\'Avorio','Netherlands':'Olanda','Japan':'Giappone','Sweden':'Svezia','Tunisia':'Tunisia','Belgium':'Belgio','Egypt':'Egitto','Spain':'Spagna','Uruguay':'Uruguay','Saudi Arabia':'Arabia Saudita','Cape Verde':'Capo Verde','France':'Francia','Senegal':'Senegal','Norway':'Norvegia','Argentina':'Argentina','Algeria':'Algeria','Austria':'Austria','Jordan':'Giordania','Portugal':'Portogallo','Colombia':'Colombia','England':'Inghilterra','Croatia':'Croazia','Panama':'Panama','Ghana':'Ghana','Canada':'Canada','Qatar':'Qatar','Brazil':'Brasile','Haiti':'Haiti','Australia':'Australia','Paraguay':'Paraguay','Turkey':'Turchia','Türkiye':'Turchia','New Zealand':'Nuova Zelanda','Curacao':'Curacao','Curaçao':'Curacao','Cameroon':'Camerun','Venezuela':'Venezuela','Congo DR':'Congo RD','Congo DRC':'Congo RD','Uzbekistan':'Uzbekistan','Iraq':'Iraq','Bosnia and Herzegovina':'Bosnia-Erz.','Bosnia Herzegovina':'Bosnia-Erz.','Bosnia-Herzegovina':'Bosnia-Erz.','Indonesia':'Indonesia','Serbia':'Serbia'};
function wcIt(n){return WC_IT_MAP[n]||n;}
app.get('/sport/soccer/worldcup2026',async(req,res)=>{
  const enrichedGroups={};
  for(const[letter,teams]of Object.entries(WC2026_GROUPS)) enrichedGroups[letter]=teams.map(t=>({...t}));
  try{
    const ESPN_WC='https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
    // Costruisci teamToGroup dai dati statici
    const teamToGroup={};
    for(const[letter,entries]of Object.entries(WC2026_GROUPS)){
      for(const e of entries){
        if(e.t&&!e.t.startsWith('Playoff')&&e.t!=='-'){
          teamToGroup[e.t.toLowerCase()]=letter;
          const enKey=Object.keys(WC_IT_MAP).find(k=>WC_IT_MAP[k]===e.t);
          if(enKey) teamToGroup[enKey.toLowerCase()]=letter;
        }
      }
    }
    // Partite fase a gironi da ESPN
    const matches=[];
    try{
      const md=await cGet(`${ESPN_WC}/scoreboard?dates=20260611-20260628&limit=300`,300000);
      for(const ev of(md?.events||[])){
        const c=ev.competitions?.[0];if(!c)continue;
        const h=c.competitors?.find(t=>t.homeAway==='home');
        const a=c.competitors?.find(t=>t.homeAway==='away');
        if(!h||!a)continue;
        const hn=h.team?.displayName||'',an=a.team?.displayName||'';
        const group=teamToGroup[wcIt(hn).toLowerCase()]||teamToGroup[hn.toLowerCase()]
          ||teamToGroup[wcIt(an).toLowerCase()]||teamToGroup[an.toLowerCase()];
        if(!group)continue;
        const played=c.status?.type?.completed===true;
        matches.push({group,date:ev.date,home:wcIt(hn)||hn,away:wcIt(an)||an,
          homeScore:played?(h.score??null):null,awayScore:played?(a.score??null):null});
      }
    }catch{}
    matches.sort((a,b)=>new Date(a.date)-new Date(b.date));
    // Classifica gironi da ESPN
    try{
      const sd=await cGet('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings',300000);
      for(const grp of(sd?.children||[])){
        const entries=grp.standings?.entries||[];
        for(const e of entries){
          const dn=e.team?.displayName||'';
          const itName=wcIt(dn)||dn;
          const stats={};for(const s of(e.stats||[]))stats[s.name]=s.value;
          for(const[letter,teams]of Object.entries(enrichedGroups)){
            const team=teams.find(t=>t.t&&(t.t.toLowerCase()===itName.toLowerCase()||t.t.toLowerCase()===dn.toLowerCase()));
            if(team){
              team.p=Math.round(stats.points||0);
              team.gp=Math.round(stats.gamesPlayed||0);
              team.w=Math.round(stats.wins||0);
              team.d=Math.round(stats.ties||stats.draws||0);
              team.l=Math.round(stats.losses||0);
              team.gd=Math.round(stats.pointDifferential||0);
              team.gf=Math.round(stats.pointsFor||0);
              break;
            }
          }
        }
      }
      // Ordina ogni girone per punti desc, poi GD desc, poi GF desc
      for(const letter of Object.keys(enrichedGroups)){
        enrichedGroups[letter].sort((a,b)=>(b.p||0)-(a.p||0)||(b.gd||0)-(a.gd||0)||(b.gf||0)-(a.gf||0));
      }
    }catch{}
    // Tabellone knockout (dal 29 giu)
    // Il round si determina dalla data della partita (calendario ufficiale del turno)
    // e non dal testo delle note ESPN: quel testo esiste solo per gli slot futuri
    // non ancora determinati (es. "Round of 16 5 Winner") e manca del tutto per le
    // partite con squadre reali già note, che finivano scartate.
    const roundByDate=(dateStr)=>{
      const t=new Date(dateStr).getTime();
      if(isNaN(t))return'';
      if(t<Date.UTC(2026,5,28))return'';
      if(t<Date.UTC(2026,6,4,12))return'Sedicesimi';
      if(t<Date.UTC(2026,6,9))return'Ottavi';
      if(t<Date.UTC(2026,6,14))return'Quarti';
      if(t<Date.UTC(2026,6,18))return'Semifinali';
      if(t<Date.UTC(2026,6,19))return'3° posto';
      return'Finale';
    };
    const knockout=[];
    try{
      const kd=await cGet(`${ESPN_WC}/scoreboard?dates=20260629-20260720&limit=200`,300000);
      for(const ev of(kd?.events||[])){
        const c=ev.competitions?.[0];if(!c)continue;
        const h=c.competitors?.find(t=>t.homeAway==='home');
        const a=c.competitors?.find(t=>t.homeAway==='away');
        if(!h||!a)continue;
        const hn=h.team?.displayName||h.team?.name||'';
        const an=a.team?.displayName||a.team?.name||'';
        const round=roundByDate(ev.date);
        if(!round)continue;
        const played=c.status?.type?.completed===true;
        knockout.push({round,date:ev.date,home:wcIt(hn)||hn,away:wcIt(an)||an,
          homeScore:played?(h.score??null):null,awayScore:played?(a.score??null):null});
      }
    }catch{}
    res.json({groups:enrichedGroups,matches,knockout});
  }catch(e){res.json({groups:enrichedGroups&&Object.keys(enrichedGroups).length?enrichedGroups:WC2026_GROUPS,matches:[],knockout:[]});}
});


// Fasi coppa per squadra specifica
app.get('/sport/soccer/:league/phases', async (req, res) => {
  try {
    const slug = req.params.league, teamId = req.query.teamId || '';
    const allEvents = [], seen = new Set();
    if (teamId) {
      try {
        const d = await cGet(`${ESPN}/soccer/${slug}/teams/${teamId}/schedule`, 3600000);
        for (const e of (d?.events || [])) {
          const ne = normEvent(e, slug, slug);
          if (!ne || seen.has(ne.id)) continue;
          const comp = (e.competitions || [])[0] || {};
          ne.round = (comp.notes?.[0]?.headline || comp.type?.text || '') ? mapStage(comp.notes?.[0]?.headline || comp.type?.text || '') : '';
          seen.add(ne.id); allEvents.push(ne);
        }
      } catch {}
    }
    const now = new Date(), from = now.toISOString().slice(0,10).replace(/-/g,'');
    const to = new Date(now.getTime()+180*864e5).toISOString().slice(0,10).replace(/-/g,'');
    try {
      const d = await cGet(`${ESPN}/soccer/${slug}/scoreboard?dates=${from}-${to}`, 300000);
      for (const e of (d?.events || [])) {
        const ne = normEvent(e, slug, slug);
        if (!ne) continue;
        if (teamId && ne.homeId !== teamId && ne.awayId !== teamId) continue;
        const comp = (e.competitions || [])[0] || {};
        ne.round = mapStage(comp.notes?.[0]?.headline || comp.type?.text || '');
        if (!seen.has(ne.id)) { seen.add(ne.id); allEvents.push(ne); }
      }
    } catch {}
    const lg = SOCCER_LEAGUES.find(l => l.slug === slug);
    if (lg?.fd) {
      try {
        const yr = new Date().getFullYear();
        let d = null;
        for (const s of [yr-1, yr-2]) {
          const url = teamId
            ? `/competitions/${lg.fd}/matches?season=${s}&team=${await getFdTeamId(teamId,'')}`
            : `/competitions/${lg.fd}/matches?season=${s}`;
          d = await fd(url, 3600000).catch(() => null);
          if (d?.matches?.length) break;
        }
        for (const m of (d?.matches || [])) {
          const eid = `fd:${m.id}`;
          if (seen.has(eid)) continue;
          seen.add(eid);
          allEvents.push({id:eid,date:m.utcDate||'',league:lg.name,leagueSlug:slug,homeName:m.homeTeam?.shortName||m.homeTeam?.name||'',awayName:m.awayTeam?.shortName||m.awayTeam?.name||'',homeScore:m.score?.fullTime?.home!=null?String(m.score.fullTime.home):'',awayScore:m.score?.fullTime?.away!=null?String(m.score.fullTime.away):'',homeId:'',awayId:'',completed:m.status==='FINISHED',live:m.status==='IN_PLAY',clock:'',round:mapStage(m.stage||''),statusDetail:m.score?.duration==='PENALTY_SHOOTOUT'?'dcr':m.score?.duration==='EXTRA_TIME'?'dts':''});
        }
      } catch {}
    }
    allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
    const phaseOrder = ['Turni Regionali','Turni di Qualificazione','Primo Turno Qualificazione','Secondo Turno Qualificazione','Terzo Turno Qualificazione','Play-off Qualificazione','Turno Preliminare','Trentaduesimi di Finale','Primo Turno','Secondo Turno','Sedicesimi di Finale','Ottavi di Finale','Terzo Turno','Quarto Turno','Quarti di Finale','Quinto Turno','Fase a Gironi','Fase Leghe','Fase Campionato','Spareggio','Playoff','Semifinale','Andata','Ritorno','Finale','Fase a Eliminazione','Fase Knockout','Altra Fase'];
    const phaseMap = new Map();
    for (const e of allEvents) {
      let ph = e.round || '';
      if (!ph) ph = SOCCER_LEAGUES.find(l => l.slug === slug)?.isCup ? 'Fase a Eliminazione' : 'Altra Fase';
      if (!phaseMap.has(ph)) phaseMap.set(ph, []);
      phaseMap.get(ph).push(e);
    }
    const sortedPhases = [...phaseMap.entries()].sort((a, b) => {
      const ai = phaseOrder.indexOf(a[0]), bi = phaseOrder.indexOf(b[0]);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1; if (bi >= 0) return 1;
      return a[0].localeCompare(b[0]);
    });
    // Standings gironi
    let standings = [];
    try {
      const yr = new Date().getFullYear();
      for (const y of [yr, yr-1]) {
        for (const url of [`${ESPN2}/soccer/${slug}/standings?season=${y}`, `${ESPN}/soccer/${slug}/standings`]) {
          try {
            const d = await cGet(url, 3600000);
            let entries = [];
            for (const g of (d.children || [])) entries.push(...(g.standings?.entries || []));
            if (!entries.length) entries = d.standings?.entries || [];
            if (entries.length > 0) {
              standings = entries.map((e, i) => { const stats={}; for(const s of(e.stats||[]))stats[s.name]=s.value; return{rank:Math.round(stats['rank']||i+1),name:e.team?.displayName||'',shortName:e.team?.shortDisplayName||'',teamId:String(e.team?.id||''),played:Math.round(stats['gamesPlayed']||0),wins:Math.round(stats['wins']||0),draws:Math.round(stats['ties']||0),losses:Math.round(stats['losses']||0),points:Math.round(stats['points']||0),gd:Math.round(stats['pointDifferential']||0)}; });
              break;
            }
          } catch {}
          if (standings.length) break;
        }
        if (standings.length) break;
      }
    } catch {}
    res.json({phases: sortedPhases.map(([name, events]) => ({name, events})), standings});
  } catch (e) { res.status(500).json({error: e.message}); }
});

// Match detail
app.get('/sport/soccer/match/:league/:id',async(req,res)=>{
  try{
    res.set('Cache-Control','no-store');
    const{league,id}=req.params;
    let d=null;
    try{const r=await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${id}`,{timeout:12000,headers:{'Cache-Control':'no-cache'}});if(r.data&&typeof r.data==='object')d=r.data;}
    catch{try{const sb=await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`,{timeout:8000});const ev=(sb.data?.events||[]).find(e=>String(e.id)===String(id));if(ev){const comp=(ev.competitions||[])[0]||{};d={header:{competitions:[{competitors:(comp.competitors||[]).map(c=>({homeAway:c.homeAway,score:c.score,team:c.team,statistics:c.statistics||[]})),status:comp.status,notes:comp.notes||[],details:[]}]},boxScore:{},keyEvents:[],commentary:[]};}}catch{}}
    const noDataResp=(h,a)=>res.json({match:{id:String(id),league,home:h?.team?.displayName||'',homeId:String(h?.team?.id||''),homeColor:'#'+(h?.team?.color||'3a7bd5'),homeLogo:h?.team?.logo||'',homeScore:h?.score||'?',away:a?.team?.displayName||'',awayId:String(a?.team?.id||''),awayColor:'#'+(a?.team?.color||'e74c3c'),awayLogo:a?.team?.logo||'',awayScore:a?.score||'?',status:'Dati non disponibili',clock:'',state:'post',period:1},teamStats:[],events:[],commentary:[],hasKeyEvents:false,noData:true});
    if(!d)return noDataResp(null,null);
    const header=d.header?.competitions?.[0],competitors=header?.competitors||[];
    const home=competitors.find(c=>c.homeAway==='home'),away=competitors.find(c=>c.homeAway==='away');
    if(!home?.team?.displayName&&!away?.team?.displayName)return noDataResp(home,away);
    const bs=d.boxScore||d.boxscore||{};
    const STAT_KEYS=['possessionPct','totalShots','shotsOnTarget','wonCorners','foulsCommitted','yellowCards','redCards','offsides','saves','totalPasses','passPct','effectiveTackles','interceptions','effectiveClearance'];
    const LABEL_IT={possessionPct:'Possesso',totalShots:'Tiri',shotsOnTarget:'Tiri in porta',wonCorners:'Corner',foulsCommitted:'Falli',yellowCards:'Gialli',redCards:'Rossi',offsides:'Fuorigioco',saves:'Parate',totalPasses:'Passaggi',passPct:'% Passaggi',effectiveTackles:'Contrasti',interceptions:'Intercettamenti',effectiveClearance:'Respinte'};
    let teamStats=(bs.teams||[]).map(t=>({team:t.team?.displayName,teamId:String(t.team?.id||''),color:t.team?.color||'',stats:Object.fromEntries((t.statistics||[]).filter(s=>STAT_KEYS.includes(s.name)).map(s=>[s.name,{label:LABEL_IT[s.name]||s.label,value:s.displayValue,raw:s.value}]))}));
    if(!teamStats.length||teamStats.every(t=>!Object.keys(t.stats).length))teamStats=(competitors||[]).map(c=>({team:c.team?.displayName||'',teamId:String(c.team?.id||''),color:c.team?.color||'',stats:Object.fromEntries((c.statistics||c.stats||[]).filter(s=>STAT_KEYS.includes(s.name||s.abbreviation)).map(s=>[s.name||s.abbreviation,{label:LABEL_IT[s.name||s.abbreviation]||s.label||s.displayName,value:s.displayValue||String(s.value||0),raw:s.value??0}]))}));
    const typeMap={'Goal':'goal','Yellow Card':'yellow','Red Card':'red','Yellow-Red Card':'red2','Substitution':'sub','Offside':'offside','Corner':'corner','Foul':'foul','Penalty':'penalty','VAR':'var','Shot':'shot','Shot on Target':'shot_on','Save':'save','Missed Penalty':'pen_miss','Own Goal':'own_goal'};
    const typeIT={goal:'Gol',own_goal:'Autogol',penalty:'Rigore',yellow:'Ammonizione',red:'Espulsione',red2:'Doppio giallo',sub:'Sostituzione',corner:"Calcio d'angolo",foul:'Fallo',offside:'Fuorigioco',save:'Parata',shot:'Tiro',shot_on:'Tiro in porta',pen_miss:'Rigore sbagliato',var:'VAR',other:''};
    const normType=t=>{if(!t)return'other';for(const[k,v] of Object.entries(typeMap))if(t.includes(k))return v;return'other';};
    const normPN=raw=>{if(!raw)return'';const cm=raw.match(/^([^,]{2,20}),\s*(.+)$/);return cm?(cm[2].trim()+' '+cm[1].trim()).trim():raw.trim();};
    const mapEv=ev=>({clock:ev.clock?.displayValue||ev.time?.displayValue||'',type:normType(ev.type?.text||ev.shortName),typeLabel:typeIT[normType(ev.type?.text||ev.shortName)]||'',players:(()=>{const ath=ev.athletesInvolved||ev.athletes||[];if(ath.length>0){const n=normPN(ath[0].displayName||ath[0].shortName||'');if(n)return[n];}for(const k of['shortText','athleteName','shortName']){const v=(ev[k]||'').trim();if(v&&v.length>2&&!/^\d/.test(v))return[normPN(v)];}return[];})(),team:ev.team?.displayName||'',teamId:String(ev.team?.id||''),homeScore:ev.homeScore??null,awayScore:ev.awayScore??null,scoringPlay:!!ev.scoringPlay,text:ev.text||ev.description||''});
    const detailEvents=(header?.details||[]).map(mapEv),keyEvents=(d.keyEvents||[]).map(mapEv);
    const spMap=new Map();
    for(const sp of(d.scoringPlays||[])){const clock=(sp.clock?.displayValue||'').trim();let name='';if(sp.athletesInvolved?.length)name=normPN(sp.athletesInvolved[0].displayName||sp.athletesInvolved[0].shortName||'');if(!name)for(const k of['shortText','athleteName']){const v=(sp[k]||'').trim();if(v&&v.length>2&&!/^\d/.test(v)){name=normPN(v);break;}}if(name&&name.length>1){const mn=clock.replace(/\D/g,'');for(const v of[clock,mn+"'",mn])if(v)spMap.set(v,name);}}
    const enrichG=evs=>evs.map(ev=>{if(ev.type!=='goal'&&ev.type!=='own_goal'&&ev.type!=='penalty')return ev;if((ev.players||[]).filter(p=>p&&p.trim().length>2).length>0)return ev;const clock=(ev.clock||'').trim(),mn=clock.replace(/\D/g,'');let name='';for(const lk of[clock,mn+"'",mn])if(lk&&spMap.has(lk)){name=spMap.get(lk);break;}if(name&&name.length>1)return{...ev,players:[name]};return ev;});
    const pC=s=>{const m=parseInt((s||'0').replace(/\D.*$/,''));return isNaN(m)?0:m;};
    let events=enrichG(keyEvents.length>0?keyEvents:detailEvents).sort((a,b)=>pC(a.clock)-pC(b.clock));
    const commentary=(d.commentary||[]).slice(0,60).map(c=>({clock:c.time?.displayValue||'',type:normType(c.type?.text||c.shortName),typeLabel:typeIT[normType(c.type?.text||c.shortName)]||'',text:c.text||'',team:c.team?.displayName||'',players:[],teamId:'',homeScore:null,awayScore:null,scoringPlay:false}));
    res.json({match:{id:String(id),league,home:home?.team?.displayName||'',homeId:String(home?.team?.id||''),homeColor:'#'+(home?.team?.color||'cccccc'),homeAlternateColor:'#'+(home?.team?.alternateColor||''),homeLogo:home?.team?.logo||'',homeScore:home?.score||'0',away:away?.team?.displayName||'',awayId:String(away?.team?.id||''),awayColor:'#'+(away?.team?.color||'cccccc'),awayAlternateColor:'#'+(away?.team?.alternateColor||''),awayLogo:away?.team?.logo||'',awayScore:away?.score||'0',status:header?.status?.type?.shortDetail||'',clock:header?.status?.displayClock||'',state:header?.status?.type?.state||'pre',period:header?.status?.period||1},teamStats,events,commentary,hasKeyEvents:keyEvents.length>0});
  }catch(e){res.status(500).json({error:e.message});}
});

// ═══════════════════════════════════════════════════════════════════════════════
// F1
// ═══════════════════════════════════════════════════════════════════════════════
const F1Y=new Date().getFullYear();
async function openf1(path){const r=await axios.get('https://api.openf1.org/v1'+path,{timeout:15000});return r.data;}

const F1_CAL_2026=[
  {round:'1',raceName:'Australian Grand Prix',date:'2026-03-15',Circuit:{circuitName:'Albert Park Circuit',Location:{country:'Australia'}}},
  {round:'2',raceName:'Chinese Grand Prix',date:'2026-03-22',Circuit:{circuitName:'Shanghai International Circuit',Location:{country:'China'}}},
  {round:'3',raceName:'Japanese Grand Prix',date:'2026-04-05',Circuit:{circuitName:'Suzuka Circuit',Location:{country:'Japan'}}},
  {round:'4',raceName:'Bahrain Grand Prix',date:'2026-04-19',Circuit:{circuitName:'Bahrain International Circuit',Location:{country:'Bahrain'}}},
  {round:'5',raceName:'Saudi Arabian Grand Prix',date:'2026-04-26',Circuit:{circuitName:'Jeddah Corniche Circuit',Location:{country:'Saudi Arabia'}}},
  {round:'6',raceName:'Miami Grand Prix',date:'2026-05-10',Circuit:{circuitName:'Miami International Autodrome',Location:{country:'USA'}}},
  {round:'7',raceName:'Emilia Romagna Grand Prix',date:'2026-05-24',Circuit:{circuitName:'Autodromo Enzo e Dino Ferrari',Location:{country:'Italy'}}},
  {round:'8',raceName:'Monaco Grand Prix',date:'2026-05-31',Circuit:{circuitName:'Circuit de Monaco',Location:{country:'Monaco'}}},
  {round:'9',raceName:'Spanish Grand Prix',date:'2026-06-07',Circuit:{circuitName:'Circuit de Barcelona-Catalunya',Location:{country:'Spain'}}},
  {round:'10',raceName:'Canadian Grand Prix',date:'2026-06-21',Circuit:{circuitName:'Circuit Gilles Villeneuve',Location:{country:'Canada'}}},
  {round:'11',raceName:'Austrian Grand Prix',date:'2026-06-28',Circuit:{circuitName:'Red Bull Ring',Location:{country:'Austria'}}},
  {round:'12',raceName:'British Grand Prix',date:'2026-07-05',Circuit:{circuitName:'Silverstone Circuit',Location:{country:'UK'}}},
  {round:'13',raceName:'Belgian Grand Prix',date:'2026-07-26',Circuit:{circuitName:'Circuit de Spa-Francorchamps',Location:{country:'Belgium'}}},
  {round:'14',raceName:'Hungarian Grand Prix',date:'2026-08-02',Circuit:{circuitName:'Hungaroring',Location:{country:'Hungary'}}},
  {round:'15',raceName:'Dutch Grand Prix',date:'2026-08-30',Circuit:{circuitName:'Circuit Zandvoort',Location:{country:'Netherlands'}}},
  {round:'16',raceName:'Italian Grand Prix',date:'2026-09-06',Circuit:{circuitName:'Autodromo Nazionale Monza',Location:{country:'Italy'}}},
  {round:'17',raceName:'Azerbaijan Grand Prix',date:'2026-09-20',Circuit:{circuitName:'Baku City Circuit',Location:{country:'Azerbaijan'}}},
  {round:'18',raceName:'Singapore Grand Prix',date:'2026-10-04',Circuit:{circuitName:'Marina Bay Street Circuit',Location:{country:'Singapore'}}},
  {round:'19',raceName:'United States Grand Prix',date:'2026-10-18',Circuit:{circuitName:'Circuit of the Americas',Location:{country:'USA'}}},
  {round:'20',raceName:'Mexico City Grand Prix',date:'2026-10-25',Circuit:{circuitName:'Autodromo Hermanos Rodriguez',Location:{country:'Mexico'}}},
  {round:'21',raceName:'São Paulo Grand Prix',date:'2026-11-08',Circuit:{circuitName:'Autodromo Jose Carlos Pace',Location:{country:'Brazil'}}},
  {round:'22',raceName:'Las Vegas Grand Prix',date:'2026-11-21',Circuit:{circuitName:'Las Vegas Street Circuit',Location:{country:'USA'}}},
  {round:'23',raceName:'Qatar Grand Prix',date:'2026-11-29',Circuit:{circuitName:'Lusail International Circuit',Location:{country:'Qatar'}}},
  {round:'24',raceName:'Abu Dhabi Grand Prix',date:'2026-12-06',Circuit:{circuitName:'Yas Marina Circuit',Location:{country:'UAE'}}},
];

app.get('/sport/f1/calendar',async(req,res)=>{try{let races=[];try{const cal=await ergast(`/${F1Y}`);races=cal?.MRData?.RaceTable?.Races||[];}catch{}if(!races.length)races=F1_CAL_2026.map(r=>({...r}));const todayStr=new Date().toISOString().slice(0,10);const past=races.filter(r=>r.date<todayStr);await Promise.all(past.map(async race=>{if(race.Results?.length>0)return;try{const r=await ergast(`/${F1Y}/${race.round}/results`,300000);race.Results=(r?.MRData?.RaceTable?.Races?.[0]?.Results||[]).slice(0,3);}catch{};}));res.json({MRData:{RaceTable:{Races:races}}});}catch(e){res.status(500).json({error:e.message});}});

// Classifica piloti F1 — si aggiorna automaticamente via ESPN/Jolpica
app.get('/sport/f1/drivers',async(req,res)=>{try{try{const espn=await cGet('https://site.web.api.espn.com/apis/v2/sports/racing/f1/standings',60000);const child=(espn?.children||[]).find(c=>(c.name||'').toLowerCase().includes('driver'));const entries=(child?.standings?.entries)||(espn?.standings?.[0]?.entries)||[];if(entries.length>0){const list=entries.map((e,i)=>({position:String(i+1),points:String(e.stats?.find(s=>s.name==='points')?.value||0),wins:String(e.stats?.find(s=>s.name==='wins')?.value||0),Driver:{givenName:e.athlete?.firstName||'',familyName:e.athlete?.lastName||'',nationality:e.athlete?.flag?.alt||''},Constructors:[{name:e.team?.displayName||''}]}));if(list.reduce((s,e)=>s+parseFloat(e.points||0),0)>0)return res.json({MRData:{StandingsTable:{StandingsLists:[{season:String(F1Y),DriverStandings:list}]}}});}}catch{}for(const y of[F1Y,F1Y-1]){const d=await ergast(`/${y}/driverStandings`,3600000).catch(()=>null);if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.length>0)return res.json(d);}res.json({MRData:{StandingsTable:{StandingsLists:[{season:'2026',DriverStandings:[{position:'1',points:'26',wins:'1',Driver:{givenName:'George',familyName:'Russell',nationality:'British'},Constructors:[{name:'Mercedes'}]},{position:'2',points:'18',wins:'0',Driver:{givenName:'Kimi',familyName:'Antonelli',nationality:'Italian'},Constructors:[{name:'Mercedes'}]},{position:'3',points:'15',wins:'0',Driver:{givenName:'Charles',familyName:'Leclerc',nationality:'Monegasque'},Constructors:[{name:'Ferrari'}]}]}]}}});}catch(e){res.status(500).json({error:e.message});}});

// Classifica costruttori F1 — si aggiorna automaticamente
app.get('/sport/f1/constructors',async(req,res)=>{try{try{const espn=await cGet('https://site.web.api.espn.com/apis/v2/sports/racing/f1/standings',60000);const child=(espn?.children||[]).find(c=>(c.name||'').toLowerCase().includes('constructor'));const entries=(child?.standings?.entries)||(espn?.standings?.[1]?.entries)||[];if(entries.length>0){const list=entries.map((e,i)=>({position:String(i+1),points:String(e.stats?.find(s=>s.name==='points')?.value||0),wins:String(e.stats?.find(s=>s.name==='wins')?.value||0),Constructor:{name:e.team?.displayName||'',nationality:''}}));return res.json({MRData:{StandingsTable:{StandingsLists:[{ConstructorStandings:list}]}}});}}catch{}for(const y of[F1Y,F1Y-1]){const d=await ergast(`/${y}/constructorStandings`,3600000).catch(()=>null);if(d?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings?.length>0)return res.json(d);}res.json({MRData:{StandingsTable:{StandingsLists:[{ConstructorStandings:[{position:'1',points:'44',wins:'1',Constructor:{name:'Mercedes',nationality:'British'}},{position:'2',points:'27',wins:'0',Constructor:{name:'Ferrari',nationality:'Italian'}},{position:'3',points:'10',wins:'0',Constructor:{name:'McLaren',nationality:'British'}}]}]}}});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/f1/last',async(req,res)=>{try{for(const path of['/current/last/results',`/${F1Y}/last/results`]){const d=await ergast(path,300000).catch(()=>null);const race=d?.MRData?.RaceTable?.Races?.[0];if(race?.Results?.length&&new Date(race.date).getFullYear()>=F1Y)return res.json(d);}res.json({MRData:{RaceTable:{Races:[]}}});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/f1/past',async(req,res)=>{try{const cal=await ergast(`/${F1Y}`).catch(()=>null);const allRaces=cal?.MRData?.RaceTable?.Races||[];const past=allRaces.filter(r=>new Date(r.date)<new Date());if(!past.length)return res.json({races:[]});const withResults=await Promise.all(past.slice(-5).reverse().map(async r=>{try{const d=await ergast(`/${F1Y}/${r.round}/results`,300000);const results=(d?.MRData?.RaceTable?.Races?.[0]?.Results||[]).slice(0,3).map(res=>({position:res.position,driver:res.Driver?.familyName||'',constructor:res.Constructor?.name||'',points:res.points||'0'}));return{...r,results};}catch{return{...r,results:[]};}}));res.json({races:withResults});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/f1/live',async(req,res)=>{try{const sessions=await openf1('/sessions?session_key=latest');if(!sessions?.length)return res.json({live:false});const sess=sessions[0],now=new Date();const isLive=now>=new Date(sess.date_start)&&now<=new Date(sess.date_end);if(!isLive)return res.json({live:false,session:sess.session_name,meeting:sess.meeting_name});const[posArr,drvArr]=await Promise.all([openf1('/position?session_key=latest'),openf1(`/drivers?session_key=${sess.session_key}`)]);const finals={};for(const p of(posArr||[])){if(!finals[p.driver_number]||p.date>finals[p.driver_number].date)finals[p.driver_number]=p;}const positions=Object.values(finals).sort((a,b)=>a.position-b.position).map(p=>{const d=(drvArr||[]).find(dr=>dr.driver_number===p.driver_number)||{};return{pos:p.position,num:p.driver_number,name:`${d.first_name||''} ${d.last_name||p.driver_number}`.trim(),team:d.team_name||'',abbr:d.name_acronym||''};});res.json({live:true,session:sess.session_name,meeting:sess.meeting_name,positions});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/f1/race/:round/results',async(req,res)=>{try{
  // Jolpica primary
  try{
    const d=await ergast(`/${F1Y}/${req.params.round}/results`,300000);
    const results=(d?.MRData?.RaceTable?.Races?.[0]?.Results||[]).slice(0,10).map(r=>({position:r.position,driver:`${r.Driver?.givenName||''} ${r.Driver?.familyName||''}`.trim(),constructor:r.Constructor?.name||'',points:r.points||'0',time:r.Time?.time||r.status||'',grid:r.grid||''}));
    if(results.length>0)return res.json({results,raceName:d?.MRData?.RaceTable?.Races?.[0]?.raceName||''});
  }catch{}
  // ESPN fallback
  const raceInfo=F1_CAL_2026.find(r=>r.round===req.params.round);
  if(raceInfo?.date){try{
    const dateStr=raceInfo.date.replace(/-/g,'');
    const ed=await cGet(`https://site.web.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard?dates=${dateStr}`,300000);
    const comps=(ed?.events?.[0]?.competitions?.[0]?.competitors||[]);
    if(comps.length){
      const results=comps.sort((a,b)=>(a.order||99)-(b.order||99)).slice(0,10).map(c=>({position:String(c.order||0),driver:c.athlete?.displayName||'',constructor:c.team?.displayName||c.team?.name||'',points:String(c.score||''),time:'',grid:''}));
      if(results.length>0)return res.json({results,raceName:raceInfo.raceName});
    }
  }catch{}}
  res.json({results:[],raceName:raceInfo?.raceName||''});
}catch(e){res.status(500).json({error:e.message});}});

// Sprint F1 — da Jolpica automaticamente (3 sprint nel 2026: Miami R6, Austria R11, Qatar R23)
app.get('/sport/f1/race/:round/sprint',async(req,res)=>{try{const round=req.params.round;const d=await ergast(`/${F1Y}/${round}/sprint`,300000).catch(()=>null);const sr=d?.MRData?.RaceTable?.Races?.[0]?.SprintResults||[];if(sr.length>0)return res.json({results:sr.slice(0,20).map(r=>({position:r.position,driver:`${r.Driver?.givenName||''} ${r.Driver?.familyName||''}`.trim(),constructor:r.Constructor?.name||'',points:r.points||'0',time:r.Time?.time||r.status||''})),raceName:d?.MRData?.RaceTable?.Races?.[0]?.raceName||''});res.status(404).json({error:`Nessuna sprint per round ${round}`});}catch(e){res.status(500).json({error:e.message});}});

const NEWS_PAYWALL=['motorsport.com','motorsport','oa sport','oasport','oasport.it','moto.it','paddock-live','motormaniacs','gpone.com','gazzetta','gazzettadelsport'];
const isPaywall=src=>NEWS_PAYWALL.some(b=>(src||'').toLowerCase().includes(b));
app.get('/sport/f1/news',async(req,res)=>{try{const feeds=['https://news.google.com/rss/search?q=Formula+1&hl=it&gl=IT&ceid=IT:it','https://www.formulapassion.it/feed/'];const items=[];for(const url of feeds){try{const r=await axios.get(url,{timeout:8000,headers:{'User-Agent':'Mozilla/5.0'}});const xml=r.data.toString();const itemRx=/<item>([\s\S]*?)<\/item>/g;let m;while((m=itemRx.exec(xml))!==null&&items.length<20){const b=m[1];const getTag=tag=>{const x=b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,'i'));return x?x[1].replace(/<[^>]+>/g,'').trim():null;};const title=getTag('title'),linkM=b.match(/<link\s*\/?>\s*([^<]*)<\/link>/i)||b.match(/<guid[^>]*>([^<]*)<\/guid>/i),pub=getTag('pubDate');const link=linkM?linkM[1].trim():null;const src=url.includes('google')?getTag('source')||'Google News':'FormulaPassion';if(title&&link&&!isPaywall(src))items.push({title,link,pubDate:pub?new Date(pub).toISOString():null,source:src});}if(items.length>=8)break;}catch{}}res.json({items:items.slice(0,15)});}catch(e){res.status(500).json({error:e.message});}});

// ═══════════════════════════════════════════════════════════════════════════════
// MOTOGP
// Classifiche piloti e team: HARDCODED, aggiornare dopo ogni GP
// Calendario: hardcoded MOTOGP_2026
// ═══════════════════════════════════════════════════════════════════════════════
const MOTOGP_2026=[
  {round:1, strEvent:'Thai GP',       dateEvent:'2026-03-01',strVenue:'Chang International Circuit',            strCountry:'THA'},
  {round:2, strEvent:'Brazilian GP',  dateEvent:'2026-03-22',strVenue:'Autódromo Internacional Ayrton Senna',  strCountry:'BRA'},
  {round:3, strEvent:'Americas GP',   dateEvent:'2026-03-29',strVenue:'Circuit of the Americas',               strCountry:'USA'},
  {round:4, strEvent:'Spanish GP',    dateEvent:'2026-04-26',strVenue:'Circuito de Jerez',                     strCountry:'ESP'},
  {round:5, strEvent:'French GP',     dateEvent:'2026-05-10',strVenue:'Bugatti Circuit',                       strCountry:'FRA'},
  {round:6, strEvent:'Catalan GP',    dateEvent:'2026-05-17',strVenue:'Circuit de Barcelona-Catalunya',        strCountry:'CAT'},
  {round:7, strEvent:'Italian GP',    dateEvent:'2026-05-31',strVenue:'Autodromo del Mugello',                 strCountry:'ITA'},
  {round:8, strEvent:'Hungarian GP',  dateEvent:'2026-06-07',strVenue:'Balaton Park Circuit',                  strCountry:'HUN'},
  {round:9, strEvent:'Czech GP',      dateEvent:'2026-06-21',strVenue:'Automotodrom Brno',                     strCountry:'CZE'},
  {round:10,strEvent:'Dutch GP',      dateEvent:'2026-06-28',strVenue:'TT Circuit Assen',                      strCountry:'NED'},
  {round:11,strEvent:'German GP',     dateEvent:'2026-07-12',strVenue:'Sachsenring',                           strCountry:'GER'},
  {round:12,strEvent:'British GP',    dateEvent:'2026-08-09',strVenue:'Silverstone Circuit',                   strCountry:'GBR'},
  {round:13,strEvent:'Aragon GP',     dateEvent:'2026-08-30',strVenue:'MotorLand Aragon',                      strCountry:'ESP'},
  {round:14,strEvent:'San Marino GP', dateEvent:'2026-09-13',strVenue:'Misano World Circuit',                  strCountry:'ITA'},
  {round:15,strEvent:'Austrian GP',   dateEvent:'2026-09-20',strVenue:'Red Bull Ring',                         strCountry:'AUT'},
  {round:16,strEvent:'Japanese GP',   dateEvent:'2026-10-04',strVenue:'Twin Ring Motegi',                      strCountry:'JPN'},
  {round:17,strEvent:'Australian GP', dateEvent:'2026-10-25',strVenue:'Phillip Island Grand Prix Circuit',     strCountry:'AUS'},
  {round:18,strEvent:'Malaysian GP',  dateEvent:'2026-11-01',strVenue:'Sepang International Circuit',          strCountry:'MAS'},
  {round:19,strEvent:'Qatar GP',      dateEvent:'2026-11-08',strVenue:'Lusail International Circuit',          strCountry:'QAT'},
  {round:20,strEvent:'Portuguese GP', dateEvent:'2026-11-22',strVenue:'Algarve International Circuit',         strCountry:'POR'},
  {round:21,strEvent:'Valencian GP',  dateEvent:'2026-11-29',strVenue:'Circuit Ricardo Tormo',                 strCountry:'ESP'},
].map(r=>({...r,strLeague:'MotoGP',idEvent:`moto2026_${r.round}`}));

app.get('/sport/motogp/calendar',(req,res)=>{
  const todayStr=new Date().toISOString().slice(0,10);
  res.json({past:MOTOGP_2026.filter(r=>r.dateEvent<todayStr),upcoming:MOTOGP_2026.filter(r=>r.dateEvent>=todayStr)});
});

// ── CLASSIFICA PILOTI — ESPN primary, Wikipedia secondary, hardcoded fallback ──
app.get('/sport/motogp/table',async(req,res)=>{
  try{
    // ESPN primary
    try{
      const espn=await cGet('https://site.web.api.espn.com/apis/v2/sports/racing/motogp/standings',60000);
      const child=(espn?.children||[]).find(c=>/(rider|pilot|driver)/i.test(c.name||''));
      const entries=(child?.standings?.entries)||(espn?.standings?.[0]?.entries)||[];
      if(entries.length>0){
        const list=entries.map((e,i)=>({intRank:String(i+1),strTeam:e.athlete?.displayName||`${e.athlete?.firstName||''} ${e.athlete?.lastName||''}`.trim()||'',strNation:e.team?.displayName||'',intPoints:String(e.stats?.find(s=>s.name==='points')?.value||0),intPlayed:'0'}));
        if(list.reduce((s,e)=>s+parseFloat(e.intPoints||0),0)>0)return res.json({table:list,season:'2026',source:'espn'});
      }
    }catch{}
    // PulseLive secondary
    try{
      const year=new Date().getFullYear();
      const pl=await cGet(`${PULSE}/standings?seasonYear=${year}&categoryId=${MOTO_CAT}`,900000);
      const cls=pl?.classification||[];
      if(cls.length>0){
        const list=cls.map(e=>({intRank:String(e.position||0),strTeam:e.rider?.full_name||'',strNation:e.team?.name||'',intPoints:String(e.points||0),intPlayed:String(e.total_participated_races||0)}));
        if(list.reduce((s,e)=>s+parseFloat(e.intPoints||0),0)>0)return res.json({table:list,season:String(year),source:'pulselive'});
      }
    }catch{}
    // Wikipedia tertiary
    try{
      const wr=await axios.get('https://en.wikipedia.org/w/api.php?action=parse&page=2026_MotoGP_World_Championship&prop=wikitext&section=0&format=json&origin=*',{timeout:6000});
      const wt=wr.data?.parse?.wikitext?.['*']||'';
      const tm=wt.match(/\{\| class="wikitable"[\s\S]*?\|\}/);
      if(tm){const rows=tm[0].split('\n|-').slice(1);const standings=[];for(const row of rows){const cells=row.split('||').map(c=>c.replace(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g,'$1').replace(/[{}'!|]/g,'').trim());const pos=parseInt(cells[0]);if(!isNaN(pos)&&cells.length>=3)standings.push({intRank:String(pos),strTeam:cells[1]||'',strNation:'',intPoints:cells[cells.length-1]||'0',intPlayed:'0'});}if(standings.length>0)return res.json({table:standings,season:'2026',source:'wikipedia'});}
    }catch{}
  res.json({table:[
    {intRank:'1', strTeam:'Marco Bezzecchi',        strNation:'Aprilia Racing',              intPoints:'180',intPlayed:'8'},
    {intRank:'2', strTeam:'Jorge Martín',            strNation:'Aprilia Racing',              intPoints:'160',intPlayed:'8'},
    {intRank:'3', strTeam:'Fabio Di Giannantonio',   strNation:'Pertamina Enduro VR46 Ducati',intPoints:'138',intPlayed:'8'},
    {intRank:'4', strTeam:'Pedro Acosta',            strNation:'Red Bull KTM Factory Racing', intPoints:'132',intPlayed:'8'},
    {intRank:'5', strTeam:'Marc Márquez',            strNation:'Ducati Lenovo Team',          intPoints:'108',intPlayed:'8'},
    {intRank:'6', strTeam:'Ai Ogura',                strNation:'Aprilia Trackhouse Racing',   intPoints:'105',intPlayed:'8'},
    {intRank:'7', strTeam:'Francesco Bagnaia',       strNation:'Ducati Lenovo Team',          intPoints:'99', intPlayed:'8'},
    {intRank:'8', strTeam:'Raúl Fernández',          strNation:'Aprilia Trackhouse Racing',   intPoints:'93', intPlayed:'8'},
    {intRank:'9', strTeam:'Alex Márquez',            strNation:'Gresini Racing MotoGP',       intPoints:'67', intPlayed:'8'},
    {intRank:'10',strTeam:'Fermin Aldeguer',         strNation:'Gresini Racing MotoGP',       intPoints:'64', intPlayed:'8'},
    {intRank:'11',strTeam:'Luca Marini',             strNation:'Castrol Honda Team',          intPoints:'57', intPlayed:'8'},
    {intRank:'12',strTeam:'Enea Bastianini',         strNation:'Red Bull KTM Tech3',          intPoints:'48', intPlayed:'8'},
    {intRank:'13',strTeam:'Brad Binder',             strNation:'Red Bull KTM Factory Racing', intPoints:'48', intPlayed:'8'},
    {intRank:'14',strTeam:'Franco Morbidelli',       strNation:'Pertamina Enduro VR46 Ducati',intPoints:'40', intPlayed:'8'},
    {intRank:'15',strTeam:'Fabio Quartararo',        strNation:'Monster Energy Yamaha',       intPoints:'37', intPlayed:'8'},
    {intRank:'16',strTeam:'Diogo Moreira',           strNation:'LCR Honda',                   intPoints:'36', intPlayed:'8'},
    {intRank:'17',strTeam:'Johann Zarco',            strNation:'LCR Honda',                   intPoints:'34', intPlayed:'8'},
    {intRank:'18',strTeam:'Joan Mir',                strNation:'Castrol Honda Team',          intPoints:'15', intPlayed:'8'},
    {intRank:'19',strTeam:'Alex Rins',               strNation:'Monster Energy Yamaha',       intPoints:'12', intPlayed:'8'},
    {intRank:'20',strTeam:'Jack Miller',             strNation:'Prima Pramac Racing',         intPoints:'11', intPlayed:'8'},
    {intRank:'21',strTeam:'Iker Lecuona',            strNation:'Gresini Racing MotoGP',       intPoints:'9',  intPlayed:'8'},
    {intRank:'22',strTeam:'Toprak Razgatlioglu',     strNation:'Prima Pramac Racing',         intPoints:'9',  intPlayed:'8'},
    {intRank:'23',strTeam:'Maverick Viñales',        strNation:'Red Bull KTM Tech3',          intPoints:'6',  intPlayed:'8'},
    {intRank:'24',strTeam:'Augusto Fernández',       strNation:'Yamaha Factory Racing',       intPoints:'4',  intPlayed:'8'},
  ],season:'2026',note:'dopo Hungarian GP R8 — Balaton Park 7 giu 2026'});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── CLASSIFICA TEAM — PulseLive primary, hardcoded fallback ────────────────────
app.get('/sport/motogp/constructors',async(req,res)=>{
  const year=new Date().getFullYear();
  // PulseLive team standings
  for(const type of['team','constructor']){
    try{
      const pl=await cGet(`${PULSE}/standings?seasonYear=${year}&categoryId=${MOTO_CAT}&type=${type}`,900000);
      const cls=pl?.classification||pl?.standings||[];
      if(cls.length>0){
        const list=cls.map((e,i)=>({
          position:String(e.position||i+1),
          constructor:e.team?.name||e.constructor?.name||e.name||'',
          points:String(e.points||0),
          team_riders:(e.riders||e.team_riders||[]).map(r=>r.full_name||r.name||r).filter(Boolean),
        })).filter(e=>e.constructor);
        if(list.length>0)return res.json({constructors:list,season:String(year),source:`pulselive-${type}`});
      }
    }catch{}
  }
  // Hardcoded fallback R8
  res.json({constructors:[
    {position:'1', constructor:'Aprilia Racing',              team_riders:['Marco Bezzecchi','Jorge Martín'],              points:'340'},
    {position:'2', constructor:'Ducati Lenovo Team',          team_riders:['Marc Márquez','Francesco Bagnaia'],            points:'207'},
    {position:'3', constructor:'Aprilia Trackhouse Racing',   team_riders:['Ai Ogura','Raúl Fernández'],                   points:'198'},
    {position:'4', constructor:'Red Bull KTM Factory Racing', team_riders:['Pedro Acosta','Brad Binder'],                  points:'180'},
    {position:'5', constructor:'Pertamina Enduro VR46 Ducati',team_riders:['Fabio Di Giannantonio','Franco Morbidelli'],   points:'178'},
    {position:'6', constructor:'Gresini Racing MotoGP',       team_riders:['Alex Márquez','Fermin Aldeguer','Iker Lecuona'],points:'140'},
    {position:'7', constructor:'Castrol Honda Team',          team_riders:['Luca Marini','Joan Mir'],                      points:'72'},
    {position:'8', constructor:'LCR Honda',                   team_riders:['Johann Zarco','Diogo Moreira'],                points:'70'},
    {position:'9', constructor:'Red Bull KTM Tech3',          team_riders:['Enea Bastianini','Maverick Viñales'],          points:'54'},
    {position:'10',constructor:'Monster Energy Yamaha',       team_riders:['Fabio Quartararo','Alex Rins'],                points:'49'},
    {position:'11',constructor:'Prima Pramac Racing',         team_riders:['Toprak Razgatlioglu','Jack Miller'],           points:'20'},
    {position:'12',constructor:'Yamaha Factory Racing',       team_riders:['Augusto Fernández'],                           points:'4'},
  ],season:'2026',note:'dopo Hungarian GP R8 — Balaton Park 7 giu 2026'});
});

// ── MotoGP risultati gara — PulseLive (API ufficiale) + ESPN fallback ──────────
const MOTO_CAT='e8c110ad-64aa-4e8e-8a86-f2f152f6a942';
const PULSE='https://api.motogp.pulselive.com/motogp/v1/results';
const PULSE_SEASON_UUID={
  2026:'e88b4e43-2209-47aa-8e83-0e0b1cedde6e',
  2025:'ae6c6f0d-c652-44f8-94aa-420fc5b3dab4',
};

async function pulseSeasonUuid(year){
  if(PULSE_SEASON_UUID[year])return PULSE_SEASON_UUID[year];
  const s=await cGet(`${PULSE}/seasons`,86400000);
  const found=(Array.isArray(s)?s:[]).find(x=>x.year===year);
  if(found?.id)PULSE_SEASON_UUID[year]=found.id;
  return found?.id||null;
}
async function pulseEvents(year){
  const uuid=await pulseSeasonUuid(year);
  if(!uuid)return[];
  const data=await cGet(`${PULSE}/events?seasonUuid=${uuid}`,3*3600000);
  return Array.isArray(data)?data:[];
}
async function pulseSessionResults(dateEvent,sessionTypeRx){
  const target=dateEvent.slice(0,10);
  const year=parseInt(target.slice(0,4));
  try{
    const events=await pulseEvents(year);
    const ev=events.find(e=>{
      const s=(e.date_start||'').slice(0,10),en=(e.date_end||e.date_start||'').slice(0,10);
      return target>=s&&target<=en;
    });
    if(!ev)return null;
    const sessions=await cGet(`${PULSE}/sessions?eventUuid=${ev.id}&categoryUuid=${MOTO_CAT}`,3*3600000);
    const sessArr=Array.isArray(sessions)?sessions:[];
    const ses=sessArr.find(s=>sessionTypeRx.test(s.type||''));
    if(!ses)return null;
    const resData=await cGet(`${PULSE}/session/${ses.id}/classification`,3*3600000);
    const cls=resData?.classification||[];
    if(!cls.length)return null;
    return cls.slice(0,10).map(r=>({
      position:String(r.position||0),
      name:r.rider?.full_name||'',
      team:r.team?.name||'',
      points:String(r.points||''),
    }));
  }catch{return null;}
}
async function pulseRaceResults(dateEvent){return pulseSessionResults(dateEvent,/^RAC$/i);}
async function pulseSprintResults(dateEvent){return pulseSessionResults(dateEvent,/^SPR$/i);}

async function espnMotoResults(dateEvent){
  const d0=new Date(dateEvent);const d1=new Date(d0);d1.setDate(d1.getDate()+1);
  const ds=d0.toISOString().slice(0,10).replace(/-/g,'');
  const ds1=d1.toISOString().slice(0,10).replace(/-/g,'');
  for(const url of[
    `https://site.web.api.espn.com/apis/site/v2/sports/racing/motogp/scoreboard?dates=${ds}-${ds1}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/racing/motogp/scoreboard?dates=${ds}`,
    `https://site.api.espn.com/apis/site/v2/sports/racing/motogp/scoreboard?dates=${ds}`,
  ]){try{
    const data=await cGet(url,3600000);
    for(const ev of(data?.events||[])){
      const comps=ev?.competitions?.[0]?.competitors||[];
      if(comps.length){return comps.sort((a,b)=>(a.order||99)-(b.order||99)).slice(0,10).map(c=>({position:String(c.order||0),name:c.athlete?.displayName||c.team?.displayName||'',team:c.team?.name||'',points:String(c.score||'')}));}
    }
  }catch{}}
  return null;
}

// PulseLive primary, ESPN fallback
async function motoRaceResults(dateEvent){
  const pl=await pulseRaceResults(dateEvent).catch(()=>null);
  if(pl?.length)return pl;
  return espnMotoResults(dateEvent).catch(()=>null);
}

// ── GARE PASSATE — aggiornare knownResults dopo ogni GP ────────────────────────
app.get('/sport/motogp/past',async(req,res)=>{
  try{
  const todayStr=new Date().toISOString().slice(0,10);
  const past=MOTOGP_2026.filter(r=>r.dateEvent<todayStr).sort((a,b)=>new Date(b.dateEvent)-new Date(a.dateEvent));
  const knownResults={
    'moto2026_1':[{position:'1',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'25'},{position:'2',name:'Pedro Acosta',team:'Red Bull KTM',points:'20'},{position:'3',name:'Raúl Fernández',team:'Trackhouse Aprilia',points:'16'},{position:'4',name:'Jorge Martín',team:'Aprilia Racing',points:'13'},{position:'5',name:'Ai Ogura',team:'Trackhouse Aprilia',points:'11'},{position:'6',name:'Brad Binder',team:'Red Bull KTM',points:'10'},{position:'7',name:'Fabio Di Giannantonio',team:'Pertamina VR46',points:'9'},{position:'8',name:'Luca Marini',team:'Honda HRC',points:'8'},{position:'9',name:'Enea Bastianini',team:'Tech3 KTM',points:'7'},{position:'10',name:'Franco Morbidelli',team:'Pertamina VR46',points:'6'}],
    'moto2026_2':[{position:'1',name:'Pedro Acosta',team:'Red Bull KTM',points:'25'},{position:'2',name:'Jorge Martín',team:'Aprilia Racing',points:'20'},{position:'3',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'16'},{position:'4',name:'Brad Binder',team:'Red Bull KTM',points:'13'},{position:'5',name:'Ai Ogura',team:'Trackhouse Aprilia',points:'11'},{position:'6',name:'Raúl Fernández',team:'Trackhouse Aprilia',points:'10'},{position:'7',name:'Marc Márquez',team:'Ducati Lenovo',points:'9'},{position:'8',name:'Fabio Di Giannantonio',team:'Pertamina VR46',points:'8'},{position:'9',name:'Francesco Bagnaia',team:'Ducati Lenovo',points:'7'},{position:'10',name:'Enea Bastianini',team:'Tech3 KTM',points:'6'}],
    'moto2026_3':[{position:'1',name:'Jorge Martín',team:'Aprilia Racing',points:'25'},{position:'2',name:'Pedro Acosta',team:'Red Bull KTM',points:'20'},{position:'3',name:'Marc Márquez',team:'Ducati Lenovo',points:'16'},{position:'4',name:'Ai Ogura',team:'Trackhouse Aprilia',points:'13'},{position:'5',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'11'},{position:'6',name:'Francesco Bagnaia',team:'Ducati Lenovo',points:'10'},{position:'7',name:'Brad Binder',team:'Red Bull KTM',points:'9'},{position:'8',name:'Raúl Fernández',team:'Trackhouse Aprilia',points:'8'},{position:'9',name:'Johann Zarco',team:'Castrol Honda LCR',points:'7'},{position:'10',name:'Luca Marini',team:'Honda HRC',points:'6'}],
    'moto2026_4':[{position:'1',name:'Alex Márquez',team:'BK8 Gresini Ducati',points:'25'},{position:'2',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'20'},{position:'3',name:'Fabio Di Giannantonio',team:'Pertamina VR46',points:'16'},{position:'4',name:'Ai Ogura',team:'Trackhouse Aprilia',points:'13'},{position:'5',name:'Raúl Fernández',team:'Trackhouse Aprilia',points:'11'},{position:'6',name:'Johann Zarco',team:'Castrol Honda LCR',points:'10'},{position:'7',name:'Enea Bastianini',team:'Tech3 KTM',points:'9'},{position:'8',name:'Jorge Martín',team:'Aprilia Racing',points:'8'},{position:'9',name:'Brad Binder',team:'Red Bull KTM',points:'7'},{position:'10',name:'Luca Marini',team:'Honda HRC',points:'6'}],
  };
  // Per i round senza dati statici, tenta ESPN in real-time
  const enriched=await Promise.all(past.map(async r=>{
    if(knownResults[r.idEvent]!==undefined)return{...r,results:knownResults[r.idEvent]};
    const res=await motoRaceResults(r.dateEvent).catch(()=>null);
    return{...r,results:res||[]};
  }));
  res.json({races:enriched});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/sport/motogp/last',async(req,res)=>{
  try{
    const todayStr=new Date().toISOString().slice(0,10);
    const past=MOTOGP_2026.filter(r=>r.dateEvent<todayStr).sort((a,b)=>new Date(b.dateEvent)-new Date(a.dateEvent));
    if(!past.length)return res.json({race:null,results:[]});
    const lastRace=past[0];
    try{const r=await motoRaceResults(lastRace.dateEvent);if(r?.length)return res.json({race:lastRace,results:r});}catch{}
    const hc={
      'moto2026_1':[{position:'1',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'25'},{position:'2',name:'Pedro Acosta',team:'Red Bull KTM Factory Racing',points:'20'},{position:'3',name:'Raúl Fernández',team:'Aprilia Trackhouse Racing',points:'16'}],
      'moto2026_2':[{position:'1',name:'Pedro Acosta',team:'Red Bull KTM Factory Racing',points:'25'},{position:'2',name:'Jorge Martín',team:'Aprilia Racing',points:'20'},{position:'3',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'16'}],
      'moto2026_3':[{position:'1',name:'Jorge Martín',team:'Aprilia Racing',points:'25'},{position:'2',name:'Pedro Acosta',team:'Red Bull KTM Factory Racing',points:'20'},{position:'3',name:'Marc Márquez',team:'Ducati Lenovo Team',points:'16'}],
      'moto2026_4':[],
      'moto2026_5':[{position:'1',name:'Alex Márquez',team:'Gresini Racing MotoGP',points:'25'},{position:'2',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'20'},{position:'3',name:'Fabio Di Giannantonio',team:'Pertamina Enduro VR46 Ducati',points:'16'}],
    };
    res.json({race:lastRace,results:hc[lastRace.idEvent]||[]});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── SPRINT — R1-R5 hardcoded, R6+ via PulseLive automatico ────────────────────
app.get('/sport/motogp/race/:round/sprint',async(req,res)=>{
  const round=parseInt(req.params.round)||0;
  const SR={
    1:{raceName:'Thai GP Sprint',results:[{position:'1',name:'Jorge Martín',team:'Aprilia Racing',points:'12'},{position:'2',name:'Pedro Acosta',team:'Red Bull KTM',points:'9'},{position:'3',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'7'},{position:'4',name:'Raúl Fernández',team:'Trackhouse Aprilia',points:'6'},{position:'5',name:'Brad Binder',team:'Red Bull KTM',points:'5'},{position:'6',name:'Ai Ogura',team:'Trackhouse Aprilia',points:'4'},{position:'7',name:'Fabio Di Giannantonio',team:'Pertamina VR46',points:'3'},{position:'8',name:'Enea Bastianini',team:'Tech3 KTM',points:'2'},{position:'9',name:'Marc Márquez',team:'Ducati Lenovo',points:'1'},{position:'10',name:'Luca Marini',team:'Honda HRC',points:'1'}]},
    2:{raceName:'Brazilian GP Sprint',results:[{position:'1',name:'Pedro Acosta',team:'Red Bull KTM',points:'12'},{position:'2',name:'Jorge Martín',team:'Aprilia Racing',points:'9'},{position:'3',name:'Brad Binder',team:'Red Bull KTM',points:'7'},{position:'4',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'6'},{position:'5',name:'Ai Ogura',team:'Trackhouse Aprilia',points:'5'},{position:'6',name:'Marc Márquez',team:'Ducati Lenovo',points:'4'},{position:'7',name:'Raúl Fernández',team:'Trackhouse Aprilia',points:'3'},{position:'8',name:'Francesco Bagnaia',team:'Ducati Lenovo',points:'2'},{position:'9',name:'Fabio Di Giannantonio',team:'Pertamina VR46',points:'1'},{position:'10',name:'Franco Morbidelli',team:'Pertamina VR46',points:'1'}]},
    3:{raceName:'Americas GP Sprint',results:[{position:'1',name:'Jorge Martín',team:'Aprilia Racing',points:'12'},{position:'2',name:'Marc Márquez',team:'Ducati Lenovo',points:'9'},{position:'3',name:'Pedro Acosta',team:'Red Bull KTM',points:'7'},{position:'4',name:'Francesco Bagnaia',team:'Ducati Lenovo',points:'6'},{position:'5',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'5'},{position:'6',name:'Ai Ogura',team:'Trackhouse Aprilia',points:'4'},{position:'7',name:'Brad Binder',team:'Red Bull KTM',points:'3'},{position:'8',name:'Raúl Fernández',team:'Trackhouse Aprilia',points:'2'},{position:'9',name:'Enea Bastianini',team:'Tech3 KTM',points:'1'},{position:'10',name:'Johann Zarco',team:'Castrol Honda LCR',points:'1'}]},
    4:{raceName:'Spanish GP Sprint',results:[{position:'1',name:'Marc Márquez',team:'Ducati Lenovo',points:'12'},{position:'2',name:'Francesco Bagnaia',team:'Ducati Lenovo',points:'9'},{position:'3',name:'Franco Morbidelli',team:'Pertamina VR46',points:'7'},{position:'4',name:'Pedro Acosta',team:'Red Bull KTM',points:'6'},{position:'5',name:'Johann Zarco',team:'Castrol Honda LCR',points:'5'},{position:'6',name:'Marco Bezzecchi',team:'Aprilia Racing',points:'4'},{position:'7',name:'Jorge Martín',team:'Aprilia Racing',points:'3'},{position:'8',name:'Enea Bastianini',team:'Tech3 KTM',points:'2'},{position:'9',name:'Brad Binder',team:'Red Bull KTM',points:'1'},{position:'10',name:'Luca Marini',team:'Honda HRC',points:'1'}]},
  };
  const sr=SR[round];if(sr?.results?.length>0)return res.json(sr);
  try{
    const raceInfo=MOTOGP_2026.find(r=>r.round===round);
    if(raceInfo?.dateEvent){
      const results=await pulseSprintResults(raceInfo.dateEvent);
      if(results?.length)return res.json({raceName:`${raceInfo.strEvent} Sprint`,results});
    }
  }catch{}
  res.status(404).json({error:`Nessuna sprint per round ${round}`});
});

app.get('/sport/motogp/live',async(req,res)=>{try{const todayStr=new Date().toISOString().slice(0,10);const live=MOTOGP_2026.find(r=>r.dateEvent===todayStr);if(!live)return res.json({live:false});const dateStr=live.dateEvent.replace(/-/g,'');const urls=[`https://site.web.api.espn.com/apis/site/v2/sports/racing/motogp/scoreboard?dates=${dateStr}`,`https://site.web.api.espn.com/apis/v2/sports/racing/motogp/scoreboard`];for(const url of urls){try{const r=await axios.get(url,{timeout:10000});const events=r.data?.events||[];for(const ev of events){const comps=ev.competitions?.[0]?.competitors||[];if(!comps.length)continue;const positions=comps.sort((a,b)=>(a.order||99)-(b.order||99)).slice(0,20).map((c,i)=>({pos:c.order||i+1,name:c.athlete?.displayName||c.team?.displayName||'',team:c.team?.name||'',gap:c.linescores?.[0]?.value||''}));if(positions.length)return res.json({live:true,race:ev.name||live.strEvent,positions});}}catch{}}res.json({live:true,race:live.strEvent,positions:[],note:'Gara in corso — dati non ancora disponibili.'});}catch(e){res.status(500).json({error:e.message});}});

app.get('/sport/motogp/news',async(req,res)=>{try{const feeds=['https://news.google.com/rss/search?q=MotoGP&hl=it&gl=IT&ceid=IT:it','https://www.motosprint.it/feed/'];const items=[];for(const url of feeds){try{const r=await axios.get(url,{timeout:8000,headers:{'User-Agent':'Mozilla/5.0'}});const xml=r.data.toString();const itemRx=/<item>([\s\S]*?)<\/item>/g;let m;while((m=itemRx.exec(xml))!==null&&items.length<20){const b=m[1];const getTag=tag=>{const x=b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,'i'));return x?x[1].replace(/<[^>]+>/g,'').trim():null;};const title=getTag('title'),linkM=b.match(/<link\s*\/?>\s*([^<]*)<\/link>/i)||b.match(/<guid[^>]*>([^<]*)<\/guid>/i),pub=getTag('pubDate');const link=linkM?linkM[1].trim():null;const src=url.includes('google')?getTag('source')||'Google News':'Motosprint';if(title&&link&&!isPaywall(src))items.push({title,link,pubDate:pub?new Date(pub).toISOString():null,source:src});}if(items.length>=8)break;}catch{}}res.json({items:items.slice(0,15)});}catch(e){res.status(500).json({error:e.message});}});

// AVVIO
const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Proxy avviato su porta ${PORT}`));
