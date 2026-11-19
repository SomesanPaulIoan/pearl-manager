const $=id=>document.getElementById(id);let current=null;let sales=[];let archivedSales=[];let showArchived=false;let unifiedSales=false;let editingId=null;let salesPage=0;const salesPageSize=6;const fmt=(n,d=2)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
function render(){
 const w=current?.wallet?.ok?current.wallet.amount:null;
 const p=current?.price?.ok?current.price.amount:null;
 const fd=current?.fortune?.ok?current.fortune:null;
 const f=fd?fd.amount:null;
 $('wallet').textContent=w===null?'—':fmt(w,4);
 $('fortune').textContent=f===null?'—':fmt(f,4);
 $('fortuneBalance').textContent=fd?fmt(fd.balance,5)+' PRL':'—';
 $('fortunePending').textContent=fd?fmt(fd.pending,5)+' PRL':'—';
 $('walletStatus').textContent=current?.wallet?.ok?'Citit din PearlChain Live':current?.wallet?.error||'Se încarcă...';
 $('fortuneStatus').textContent=fd?'Fortune PPS · '+(fd.readAt?new Date(fd.readAt).toLocaleTimeString('ro-RO'):'actualizat') :current?.fortune?.error||'Se încarcă...';
 $('price').textContent=p===null?'—':'$'+fmt(p,4);
 $('priceStatus').textContent=current?.price?.ok?'CoinGecko · actualizat '+(current.price.quoteUpdatedAt?new Date(current.price.quoteUpdatedAt).toLocaleTimeString('ro-RO'):'recent')+' · 24h '+(current.price.change24h===null?'—':current.price.change24h.toFixed(2)+'%'):current?.price?.error||'Se încarcă...';
 $('total').textContent=p!==null&&w!==null&&f!==null?'$'+fmt((w+f)*p):'—';
 $('totalNote').textContent=p===null||w===null||f===null?'Total incomplet · așteptăm toate cele trei surse':'Wallet + Fortune Balance + Fortune Pending · valoare estimată';
 const received=current?.wallet?.ok?current.wallet.totalReceived:null;
 const soldPrl=sales.reduce((sum,x)=>sum+Number(x.quantity),0);
 const realized=sales.reduce((sum,x)=>sum+Number(x.usd)-Number(x.feeUsd||0),0);
 const inventory=w!==null&&f!==null?w+f:null;
 const produced=received!==null&&received!==undefined&&f!==null?received+f:null;
 const unsoldVal=inventory!==null&&p!==null?inventory*p:null;
 $('produced').textContent=produced===null?'—':fmt(produced,4)+' PRL';
 $('realized').textContent='$'+fmt(realized);
 $('soldAmount').textContent=fmt(soldPrl,4)+' PRL';
 $('unsold').textContent=unsoldVal===null?'—':'$'+fmt(unsoldVal);
 $('revenue').textContent=unsoldVal===null?'—':'$'+fmt(realized+unsoldVal);
 $('reconcile').textContent=produced===null||inventory===null?'Așteptăm sursele Wallet/Fortune pentru reconciliere.':`Verificare: produse ${fmt(produced,4)} PRL; vândute + deținute ${fmt(soldPrl+inventory,4)} PRL. Diferență ${fmt(produced-soldPrl-inventory,4)} PRL (transferuri, comisioane, alte adrese sau vânzări neînregistrate).`;

}
async function load(){try{$('status').textContent='● Se actualizează';const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw Error('Eroare server');current=await r.json();$('address').textContent=current.address;$('explorer').href='https://pearlchain.live/api/explorer/address/'+encodeURIComponent(current.address);$('status').textContent=current.wallet.ok&&current.price.ok&&current.fortune.ok?'● Online':'● Parțial';$('updated').textContent='Ultima verificare: '+new Date(current.updatedAt).toLocaleTimeString('ro-RO');}catch(e){current={wallet:{error:e.message},price:{error:e.message}};$('status').textContent='● Offline';$('updated').textContent='Nu s-a putut contacta serverul';}render()}

// Native SVG line charts: no external JS libraries, no fabricated data.
const safeNum=v=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;
function drawLineChart(hostId,points,formatY,unit=''){
 const host=$(hostId); if(!points||points.length<2){host.innerHTML='<div class="chartErr">Date insuficiente pentru grafic.</div>';return;}
 const values=points.map(p=>p[1]);let lo=Math.min(...values),hi=Math.max(...values);if(lo===hi){lo-=Math.max(0.001,Math.abs(lo)*.02);hi+=Math.max(.001,Math.abs(hi)*.02);}
 const W=550,H=190,L=57,R=12,T=13,B=29;let xmin=points[0][0],xmax=points[points.length-1][0];if(xmin===xmax)xmax=xmin+1;
 const x=t=>L+(t-xmin)/(xmax-xmin)*(W-L-R);const y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
 const line=points.map((p,i)=>(i?'L':'M')+x(p[0]).toFixed(2)+','+y(p[1]).toFixed(2)).join(' ');
 const area=line+` L${x(points[points.length-1][0]).toFixed(2)},${H-B} L${x(points[0][0]).toFixed(2)},${H-B} Z`;
 const labels=[0,.5,1].map(f=>{const v=hi-(hi-lo)*f,yy=T+(H-T-B)*f;return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#294159" stroke-dasharray="3 5"/><text x="${L-7}" y="${yy+4}" fill="#99adc2" text-anchor="end" font-size="11">${formatY(v)}</text>`}).join('');
 const timeline=[0,.5,1].map(f=>{const t=xmin+(xmax-xmin)*f;return `<text x="${x(t)}" y="${H-5}" text-anchor="middle" fill="#9db1c6" font-size="11">${new Date(t).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})}</text>`}).join('');
 host.innerHTML=`<svg class="chartSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafic ${unit}"><defs><linearGradient id="grad-${hostId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#65e3c5" stop-opacity=".25"/><stop offset="1" stop-color="#65e3c5" stop-opacity="0"/></linearGradient></defs>${labels}<path d="${area}" fill="url(#grad-${hostId})"/><path d="${line}" fill="none" stroke="#65e3c5" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>${timeline}</svg><div class="chartLegend"><span>Primul: ${formatY(points[0][1])} ${unit}</span><span>Ultimul: ${formatY(points[points.length-1][1])} ${unit}</span></div>`;
}
function parseFortuneTimeseries(raw){
 // Summaries may have various schemas. Accept only actual time/value pairs with hashrate keys.
 const visited=new Set(),candidates=[];
 const timeKey=/^(timestamp|time|ts|date|datetime|bucket|bucket_start|bucket_start_ms|time_ms|start_ms|window_start_ms)$/i;
 const rateKey=/(hash.?rate|hashrate|rate_ph|ph_s|phs|hash_rate)/i;
 function convertTime(v){if(typeof v==='string'&&!/^\d+(\.\d+)?$/.test(v)){const t=Date.parse(v);return Number.isFinite(t)?t:NaN;}const n=safeNum(v);return Number.isFinite(n)?n>1e12?n:n>1e9?n*1000:NaN:NaN;}
 function convertRate(v,k){let n=safeNum(v);if(!Number.isFinite(n)||n<0)return NaN;const key=k.toLowerCase();if(key.includes('th'))return n/1000;if(key.includes('gh'))return n/1e6;if(key.includes('ph')||key.includes('hashrate_ph'))return n;if(key.includes('hashrate')||key.includes('hash_rate'))return n>1e12?n/1e15:n;return n;}
 function walk(obj,depth=0){if(depth>8||obj===null||typeof obj!=='object'||visited.has(obj))return;visited.add(obj);
  if(Array.isArray(obj)&&obj.length>=2){
   const pts=[];
   for(const row of obj){if(!row||typeof row!=='object'||Array.isArray(row))continue;const keys=Object.keys(row);const tk=keys.find(k=>timeKey.test(k));const vk=keys.find(k=>rateKey.test(k)&&!/(network|pool|net_|accept|reject)/i.test(k));if(!tk||!vk)continue;const t=convertTime(row[tk]);const v=convertRate(row[vk],vk);if(Number.isFinite(t)&&Number.isFinite(v))pts.push([t,v]);}
   if(pts.length>=2)candidates.push(pts);
  }
  for(const val of Object.values(obj))if(val&&typeof val==='object')walk(val,depth+1);
 }
 walk(raw);if(!candidates.length)return null;
 const pts=candidates.sort((a,b)=>b.length-a.length)[0].sort((a,b)=>a[0]-b[0]);return pts.filter((p,i)=>i===0||p[0]!==pts[i-1][0]);
}
async function loadCharts(){
 const results=await Promise.allSettled([fetch('/api/chart/price',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'CoinGecko indisponibil');return d;}),fetch('/api/chart/fortune',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Fortune indisponibil');return d;})]);
 if(results[0].status==='fulfilled'){
  const p=results[0].value.points;$('priceChartStatus').textContent='CoinGecko · '+p.length+' puncte · actualizare la 5 minute';$('priceChartCurrent').textContent='$'+fmt(p[p.length-1][1],4);drawLineChart('priceChartPlot',p,v=>'$'+v.toFixed(v>=1?2:4),'USD');
 }else{$('priceChartStatus').textContent='Istoric indisponibil';$('priceChartPlot').innerHTML='<div class="chartErr">'+escapeHtml(results[0].reason.message)+'</div>';}
 if(results[1].status==='fulfilled'){
  const pts=results[1].value.points;if(Array.isArray(pts)&&pts.length>=2){const rolling=results[1].value.rolling||[];const avg=rolling.find(x=>x.hours===24);$('fortuneChartStatus').textContent='Hashrate personal · '+pts.length+' puncte · '+(avg?'medie 24h '+avg.phs.toFixed(2)+' PH/s':'PH/s')+' · actualizare la 1 minut';drawLineChart('fortuneChartPlot',pts,v=>v.toFixed(2),'PH/s');}
  else{$('fortuneChartStatus').textContent='Datele Fortune au altă structură';$('fortuneChartPlot').innerHTML='<div class="chartErr">Nu am putut identifica seria hashrate din răspunsul API. Datele nu sunt inventate. Dacă graficul lipsește, trimite-mi răspunsul Network pentru cererea care conține adresa și parametrul hours=24.</div>';}
 }else{$('fortuneChartStatus').textContent='Istoric indisponibil';$('fortuneChartPlot').innerHTML='<div class="chartErr">'+escapeHtml(results[1].reason.message)+'</div>';}
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderSales(){
 const rows=showArchived?archivedSales:sales;
 const pages=Math.max(1,Math.ceil(rows.length/salesPageSize));
 salesPage=Math.min(salesPage,pages-1);
 const visibleSales=[...rows].reverse().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(salesPage*salesPageSize,(salesPage+1)*salesPageSize);
 $('salesPagination').hidden=pages<=1;
 $('salesArchive').classList.toggle('hidden',!unifiedSales||(!archivedSales.length&&!showArchived));
 $('salesArchive').textContent=showArchived?'Înapoi la vânzări':'Arhivate ('+archivedSales.length+')';
 $('saleCommission').classList.toggle('hidden',!unifiedSales);
 $('salesPage').textContent=`${salesPage+1} / ${pages}`;
 $('salesPrevious').disabled=salesPage===0;
 $('salesNext').disabled=salesPage>=pages-1;
 $('salesList').innerHTML=visibleSales.length?visibleSales.map(s=>`<div class="sales-row"><div><b>${fmt(Number(s.quantity),4)} PRL → $${fmt(Number(s.usd))}</b><div class="sales-meta">${s.date?escapeHtml(s.date):'<span class="warn">Data exactă lipsește — completeaz-o</span>'} · $${fmt(Number(s.usd)/Number(s.quantity),4)}/PRL</div>${s.feeUsd?`<div class="sales-meta">Comision: $${fmt(s.feeUsd)}</div>`:''}${s.note?`<div class="sales-meta">${escapeHtml(s.note)}</div>`:''}</div><div class="salesActions">${showArchived
 ? `<button class="mini" data-action="restore" data-id="${escapeHtml(s.id)}">Restaurează</button>`
 : `<button class="mini" data-action="edit" data-id="${escapeHtml(s.id)}">Editează</button><button class="mini danger" data-action="archive" data-id="${escapeHtml(s.id)}">${unifiedSales?'Arhivează':'Șterge'}</button>`}</div></div>`).join(''):showArchived?'Nicio vânzare arhivată.':'Nicio vânzare încă.';
 render();
}
function receiveSales(result){
 sales=result.sales;
 unifiedSales=Array.isArray(result.archived);
 archivedSales=result.archived||[];
 renderSales();
}
async function requestSales(method='GET',data=null,suffix=''){
 const response=await fetch('/api/sales'+suffix,{
  method,cache:'no-store',headers:data?{'Content-Type':'application/json'}:{},
  body:data?JSON.stringify(data):undefined,
 });
 const result=await response.json();
 if(!response.ok)throw Error(result.error?.message||result.error||'Nu s-au putut actualiza vânzările.');
 receiveSales(result);
}
async function loadSales(){try{await requestSales();}catch(e){$('salesList').textContent=e.message;}}
function resetForm(){editingId=null;$('saleForm').reset();$('saleDate').value=new Date().toLocaleDateString('en-CA');$('saleFormTitle').textContent='Înregistrează o vânzare';$('cancelEdit').classList.add('hidden');$('saveSale').textContent='Salvează vânzarea';}
resetForm();
$('salesPrevious').addEventListener('click',()=>{salesPage--;renderSales()});
$('salesNext').addEventListener('click',()=>{salesPage++;renderSales()});
$('salesArchive').addEventListener('click',()=>{showArchived=!showArchived;salesPage=0;renderSales()});
$('salesList').addEventListener('click',async e=>{
 const button=e.target.closest('button[data-action]');
 if(!button)return;
 const item=(showArchived?archivedSales:sales).find(s=>s.id===button.dataset.id);
 if(!item)return;
 const action=button.dataset.action;
 if(action==='edit'){
  editingId=item.id;
  $('saleDate').value=item.date||'';$('saleQuantity').value=item.quantity;$('saleUsd').value=item.usd;$('saleFee').value=item.feeUsd||'';
  $('saleNote').value=item.note||'';$('saleFormTitle').textContent='Editează vânzarea';$('saveSale').textContent='Salvează modificările';
  $('cancelEdit').classList.remove('hidden');$('saleForm').scrollIntoView({behavior:'smooth'});
  return;
 }
 if(action==='archive'&&!confirm(unifiedSales?'Arhivezi vânzarea? O poți restaura ulterior.':'Ștergi definitiv această vânzare?'))return;
 button.disabled=true;
 try{
  if(unifiedSales)await requestSales('POST',{action,id:item.id,version:item.version});
  else await requestSales('DELETE',null,'?id='+encodeURIComponent(item.id));
  if(editingId===item.id)resetForm();
 }catch(error){$('saleMessage').textContent=error.message;button.disabled=false;}
});
$('cancelEdit').addEventListener('click',resetForm);
$('saleForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const submit=$('saveSale');
 if(submit.disabled)return;
 submit.disabled=true;
 const previous=sales.find(s=>s.id===editingId);
 const data={date:$('saleDate').value,quantity:Number($('saleQuantity').value),usd:Number($('saleUsd').value),
  feeUsd:Number($('saleFee').value||0),note:$('saleNote').value,id:editingId,version:previous?.version,action:editingId?'update':'create'};
 try{
  await requestSales(unifiedSales||!editingId?'POST':'PUT',data);
  resetForm();
  $('saleMessage').textContent='Vânzarea a fost salvată.';
 }catch(error){$('saleMessage').textContent=error.message;}
 finally{submit.disabled=false;}
});
$('exportSales').addEventListener('click',()=>{
 const rows=[['Data','Cantitate PRL','USD brut','Comision USD','USD net','Notiță'],
  ...sales.map(s=>[s.date,s.quantity,s.usd,s.feeUsd||0,(s.usd-(s.feeUsd||0)).toFixed(2),s.note||''])];
 const csv=rows.map(row=>row.map(cell=>{
  const text=String(cell);
  const safe=typeof cell==='string'&&/^[\s]*[=+@-]|^[\t\r\n]/.test(text)?"'"+text:text;
  return '"'+safe.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n');
 const link=document.createElement('a');
 link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 link.download='pearl-sales.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),2000);
});
load();loadSales();loadCharts();setInterval(load,30000);setInterval(loadCharts,60000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
