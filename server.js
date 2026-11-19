import { readAlerts } from './rig-alerts.js';
import { createMiningHistory, dailyPearlRewards, monthlyMining } from './mining-history.js';
import { forwardFinance } from './finance/proxy.js';
import { estimateProfitability } from './profitability.js';
import { fleetStatus } from './rigs.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const address=process.env.PEARL_WALLET_ADDRESS?.trim().toLowerCase();
if(!/^prl1[a-z0-9]+$/.test(address||'')){
  console.error('Set PEARL_WALLET_ADDRESS to a public PRL wallet address.');
  process.exit(1);
}
const PORT=Number(process.env.PORT||3000);
const configuredOrigin=process.env.PEARL_FINANCE_ORIGIN ? new URL(process.env.PEARL_FINANCE_ORIGIN) : null;
const frontendHeaders={
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

const salesFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'data','sales.json');
const initialSales=[];
let salesWrite=Promise.resolve();
async function readSales(){try{const v=JSON.parse(await fs.readFile(salesFile,'utf8'));return Array.isArray(v)?v:initialSales;}catch(e){if(e.code==='ENOENT')return initialSales;throw e;}}
async function writeSales(items){await fs.mkdir(path.dirname(salesFile),{recursive:true});const tmp=salesFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(items,null,2));await fs.rename(tmp,salesFile);}
function serializeSalesUpdate(fn){const result=salesWrite.then(async()=>{const entries=await readSales();const next=fn(entries);await writeSales(next);return next;});salesWrite=result.catch(()=>{});return result;}
async function jsonBody(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)throw Error('Payload prea mare');}return JSON.parse(body);}
function validateSale(v){const quantity=Number(v?.quantity),usd=Number(v?.usd),date=String(v?.date||''),note=String(v?.note||'').trim();if(!Number.isFinite(quantity)||quantity<=0||quantity>1e10||!Number.isFinite(usd)||usd<0||usd>1e12)throw Error('Cantitate sau sumă invalidă');if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Dată invalidă');if(note.length>250)throw Error('Notița e prea lungă');return {date,quantity,usd,note};}
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const safeFetch=async(url,timeout=9000)=>{const response=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'PearlMonitor/1.0'}});if(!response.ok)throw Error(`HTTP ${response.status}`);return response;};
async function getWallet(){
  const url=`https://pearlchain.live/api/explorer/address/${address}`;
  const j=await (await safeFetch(url,10000)).json();
  if(String(j.address||'').toLowerCase()!==address.toLowerCase())throw Error('PearlChain: adresa din răspuns nu corespunde');
  const atomic=v=>(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)||(typeof v==='string'&&/^\d+$/.test(v));
  if(!atomic(j.balance)||!atomic(j.totalReceived))throw Error('PearlChain: sold sau totalReceived invalid');
  const amount=Number(j.balance)/1e8;
  const totalReceived=Number(j.totalReceived)/1e8;
  if(!Number.isFinite(amount)||!Number.isFinite(totalReceived))throw Error('PearlChain: valoare numerică invalidă');
  return {amount,totalReceived,transactions:Number.isInteger(j.txCount)?j.txCount:null,source:'PearlChain Live',url:`https://pearlchain.live/`,note:'Sold on-chain; totalReceived include toate intrările în adresă, nu numai mining.'};
}
async function getFortune(){
  const url=`https://pearlfortune.org/api/v1/miners/${address}/pps?status=pending`;
  const response=await safeFetch(url,12000);
  const raw=await response.text();
  let json;
  try { json=JSON.parse(raw); }
  catch { throw Error(`Fortune nu a returnat JSON (content-type: ${response.headers.get('content-type')||'necunoscut'}, început: ${raw.slice(0,90).replace(/\s+/g,' ')})`); }
  // API versions may wrap the ledger differently; inspect known envelopes.
  const candidates=[json?.data,json?.data?.ledger,json?.data?.account,json?.ledger,json?.result?.data,json?.result,json];
  const d=candidates.find(x=>x && typeof x==='object' && x.balance_atomic!==undefined && x.immature_q64!==undefined);
  if(!d){
    const keys=x=>x && typeof x==='object'?Object.keys(x).slice(0,18).join(','):'none';
    throw Error(`Fortune PPS: lipsesc balance_atomic / immature_q64; răspuns: root=[${keys(json)}], data=[${keys(json?.data)}], error=${String(json?.error?.message||json?.message||'niciuna').slice(0,120)}`);
  }
  if(d.address && String(d.address).toLowerCase()!==address.toLowerCase())throw Error('Fortune: adresa din răspuns este diferită');
  const integer=v=>typeof v==='bigint'||typeof v==='string'&&/^\d+$/.test(v)||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
  if(!integer(d.balance_atomic)||!integer(d.immature_q64))throw Error('Fortune: soldul și immature_q64 nu sunt întregi nenegativi');
  const scale=BigInt(d.atomic_units_per_coin ?? 100000000);
  if(scale<=0n)throw Error('Fortune: unități atomice invalide');
  const balance=Number(BigInt(d.balance_atomic))/Number(scale);
  const pending=Number(BigInt(d.immature_q64))/2**64/Number(scale);
  if(!Number.isFinite(balance)||!Number.isFinite(pending)||balance<0||pending<0)throw Error('Sume Fortune invalide');
  return {amount:balance+pending,balance,pending,mode:'PPS',source:'Pearl Fortune PPS',url:'https://pearlfortune.org/',readAt:d.read_at_ms?new Date(Number(d.read_at_ms)).toISOString():null,note:'Pending PPS calculat din immature_q64; poate varia în timp real.'};
}

// Historical charts are read-only and cached to avoid exceeding public API limits.
const historyCache=new Map();
const historyRequests=new Map();
async function historyCached(key,ttl,fn){
 const cached=historyCache.get(key);
 if(cached && Date.now()-cached.at<ttl)return cached.value;
 if (!historyRequests.has(key)) {
   const request=fn().then(value=>{
     historyCache.set(key,{at:Date.now(),value});
     return value;
   }).finally(()=>historyRequests.delete(key));
   historyRequests.set(key,request);
 }
 return historyRequests.get(key);
}
async function priceHistory(){return historyCached('price24h',300000,async()=>{
 const url='https://api.coingecko.com/api/v3/coins/pearl-2/market_chart?vs_currency=usd&days=1';
 const json=await (await safeFetch(url,12000)).json();
 if(!Array.isArray(json.prices))throw Error('CoinGecko nu a returnat istoricul');
 const points=json.prices.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[1]>0).map(([t,v])=>[t,v]);
 if(points.length<2)throw Error('Prea puține puncte pentru grafic');
 return {points,source:'CoinGecko',updatedAt:new Date().toISOString()};
});}
async function fortuneSummary(){return historyCached('fortune24h',60000,async()=>{
 const url=`https://pearlfortune.org/api/v1/miners/${address}?hours=24&tz_offset_min=180`;
 const json=await (await safeFetch(url,12000)).json();
 return json?.data?.hourly_shares;
});}
async function fortuneRewardArchive(){
 const url=`https://pearlfortune.org/api/v1/miners/${address}?hours=360&tz_offset_min=0`;
 const json=await (await safeFetch(url,8000)).json();
 return json?.data?.hourly_shares;
}
async function fortuneHistory(){
 const summary=await fortuneSummary();
 const series=summary?.series;
 if(!Array.isArray(series))throw Error('Fortune nu a returnat data.hourly_shares.series');
 const points=series.map(row=>[Number(row.hour)*1000, Number(row?.share_statistics?.effective_hashrate)/1e15])
   .filter(([t,v])=>Number.isFinite(t)&&Number.isFinite(v)&&v>=0).sort((a,b)=>a[0]-b[0]);
 if(points.length<2)throw Error('Istoric hashrate insuficient');
 const rolling=Array.isArray(summary?.rolling_hashrates)?summary.rolling_hashrates.map(x=>({hours:x.hours,phs:Number(x.hashrate)/1e15})):[];
 return {points,rolling,source:'Pearl Fortune · hashrate personal',updatedAt:new Date().toISOString()};
}
async function getPrice(){return historyCached('prlQuote',300000,async()=>{
  const url='https://api.coingecko.com/api/v3/simple/price?ids=pearl-2&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true';
  const r=await safeFetch(url,9000); // public endpoint; demo key optional below
  const json=await r.json();const coin=json['pearl-2'];
  if(!coin || typeof coin.usd!=='number' || coin.usd<=0)throw Error('CoinGecko nu a returnat preț PRL valid');
  const updatedAt=coin.last_updated_at?new Date(coin.last_updated_at*1000).toISOString():null;
  if(updatedAt && Date.now()-Date.parse(updatedAt)>900000)throw Error('Cotația CoinGecko este mai veche de 15 minute');
  const data={amount:coin.usd,change24h:coin.usd_24h_change??null,quoteUpdatedAt:updatedAt,source:'CoinGecko (Pearl / pearl-2)',url:'https://www.coingecko.com/en/coins/pearl-research',note:'Preț orientativ agregat de piață.'};
  return data;
});}
let currentVastActivity;
let vastActivityRequest;
function vastActivity() {
  const port=process.env.PEARL_FINANCE_PORT;
  const token=process.env.PEARL_FINANCE_TOKEN;
  if(port && token && (!currentVastActivity || Date.now()-currentVastActivity.at>300_000) && !vastActivityRequest) {
    vastActivityRequest=fetch(`http://127.0.0.1:${port}/api/financial/rig-activity`,{
      signal:AbortSignal.timeout(8000),headers:{'X-Pearl-Finance-Key':token},
    }).then(async response=>{
      currentVastActivity={at:Date.now(),value:response.ok ? await response.json() : {}};
    }).catch(()=>{currentVastActivity={at:Date.now(),value:{}};}).finally(()=>{vastActivityRequest=undefined;});
  }
  return currentVastActivity?.value ?? {};
}
const miningHistory = createMiningHistory(new URL('./data/', import.meta.url), address, fortuneSummary, fleetStatus, vastActivity, fortuneRewardArchive);
async function profitability() {
  const results = await Promise.allSettled([
    fortuneSummary(), getPrice(),
    historyCached('usdRon', 3600000, async () =>
      (await safeFetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=RON')).json()),
    fleetStatus(),
  ]);
  const [summary, quote, fx, fleet] = results.map(result => result.value);
  return estimateProfitability({ pps: summary?.pps_income, quote, fx, fleet, tariff: 1.10, overhead: 0.15, history: miningHistory.read() });
}
async function status(){const results=await Promise.allSettled([getWallet(),getPrice(),getFortune()]);const data=results.map(x=>x.status==='fulfilled'?{ok:true,...x.value}:{ok:false,error:String(x.reason?.message||'Sursa indisponibilă')});return {address,wallet:data[0],price:data[1],fortune:data[2],updatedAt:new Date().toISOString()};}
async function readCreditedDays() {
 try {
   return JSON.parse(await fs.readFile(new URL('./data/pearl-credited-days.json', import.meta.url), 'utf8'));
 } catch (error) {
   if (error.code === 'ENOENT') return undefined;
   throw error;
 }
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
if(configuredOrigin && req.headers.host!==configuredOrigin.host)
 return sendJson(res,403,{error:{message:'Gazdă HTTP nepermisă.'}});
if(req.headers.origin && req.headers.origin!==(configuredOrigin?.origin??'http://'+req.headers.host))
 return sendJson(res,403,{error:{message:'Origine nepermisă.'}});
if(u.pathname==='/api/sales' && process.env.PEARL_FINANCE_PORT){
 return forwardFinance(req,res,new URL('/api/financial/pearl-sales',u),sendJson);
}
if(u.pathname==='/api/sales'){
 if(req.method!=='GET' && (req.headers['sec-fetch-site']==='cross-site' || req.headers['sec-fetch-site']==='same-site'))
  return sendJson(res,403,{error:'Origine nepermisă.'});
 if(req.method==='GET'){sendJson(res,200,{sales:await readSales()});return;}
 if(req.method==='POST'||req.method==='PUT'){
  try{const input=await jsonBody(req);const clean=validateSale(input);const rows=await serializeSalesUpdate(old=>{
    if(req.method==='PUT'){if(!old.some(x=>x.id===input.id))throw Error('Vânzare inexistentă');return old.map(x=>x.id===input.id?{id:x.id,...clean}:x);}
    return [...old,{id:globalThis.crypto.randomUUID(),...clean}];
   });sendJson(res,200,{sales:rows});}catch(e){sendJson(res,400,{error:e.message});}return;
 }
 if(req.method==='DELETE'){
  const id=u.searchParams.get('id');if(!id){sendJson(res,400,{error:'Lipsește ID'});return;}
  const rows=await serializeSalesUpdate(old=>old.filter(x=>x.id!==id));sendJson(res,200,{sales:rows});return;
 }
 sendJson(res,405,{error:'Metodă nepermisă'});return;
}
if(u.pathname.startsWith('/api/financial/')){forwardFinance(req,res,u,sendJson);return;}
if(u.pathname==='/api/profitability' && req.method==='GET'){sendJson(res,200,await profitability());return;}
if(u.pathname==='/api/mining/daily' && req.method==='GET'){
 const days=Number(u.searchParams.get('days')??30);
 if(![7,30,90,365].includes(days))return sendJson(res,400,{error:'Interval invalid.'});
 return sendJson(res,200,dailyPearlRewards(miningHistory.read(),days,Date.now(),await readCreditedDays()));
}
if(u.pathname==='/api/mining/monthly' && req.method==='GET'){
 const month=u.searchParams.get('month')??'';
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return sendJson(res,400,{error:'Lună invalidă.'});
 return sendJson(res,200,monthlyMining(miningHistory.read(),month,0.15,1.10));
}
if(u.pathname==='/api/alerts' && req.method==='GET'){sendJson(res,200,readAlerts(miningHistory.read()));return;}
if(u.pathname==='/api/rigs' && req.method==='GET'){sendJson(res,200,await fleetStatus());return;}
if(u.pathname==='/api/chart/price' || u.pathname==='/api/chart/fortune'){
 try {sendJson(res,200,await (u.pathname.endsWith('/price')?priceHistory():fortuneHistory()));}
 catch(e){sendJson(res,502,{error:String(e.message||e)});}return;
}
if(u.pathname==='/api/status'){const body=JSON.stringify(await status());res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);return;}
let p=u.pathname==='/'?'/index.html':u.pathname;const full=path.resolve(root,'.'+decodeURIComponent(p));if(!full.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const b=await fs.readFile(full);res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','Cache-Control':'no-cache',...frontendHeaders});res.end(b);
}catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end('Not found');}}).listen(PORT,process.env.PEARL_MONITOR_HOST||"127.0.0.1",()=>{
  console.log(`Pearl Monitor listening on port ${PORT}`);
  void miningHistory.refresh();
  setInterval(() => void miningHistory.refresh(), 30_000).unref();
});
