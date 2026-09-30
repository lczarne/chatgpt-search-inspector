import {captureStatus} from './progress.js';
function domainRanges(query) {
  const pattern = /(?:\bsite:|^\s*)(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)(?:\/[^\s"'<>]*)?(?=[\s"'<>]|$)/gi;
  return [...query.matchAll(pattern)].map(m => ({start:m.index+m[0].length-m[0].trimStart().length,end:m.index+m[0].length}));
}
function csvText(rows) {
  const cell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
let state={turns:[],warnings:[]}, selected='', tab='queries', demo=false;
let lastLatest='';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const liveAPI=!!globalThis.chrome?.runtime?.id;
const rpc=async type=>{
  const windowId=type==='start'?(await chrome.windows.getCurrent()).id:undefined;
  return chrome.runtime.sendMessage({type,windowId});
};
function render(){
  const turns=state.turns||[];
  const latest=turns.at(-1)?.id||'';
  if(latest!==lastLatest && (!selected || selected===lastLatest))selected=latest;
  lastLatest=latest;
  if(!turns.some(t=>t.id===selected))selected=turns.at(-1)?.id||'';
  const t=turns.find(t=>t.id===selected), qs=t?.operations.flatMap(o=>o.queries)||[], sources=t?.sources||[];
  updateProgress();
  $('start').disabled=!!state.active || !liveAPI;$('stop').disabled=!state.active;
  $('error').textContent=state.failure||'';
  $('queriesCount').textContent=qs.length;$('sourcesCount').textContent=sources.filter(s=>s.kind==='search').length;
  $('turn').replaceChildren(...(turns.length?turns.map((t,i)=>{const n=el('option',`Response ${i+1} · ${t.finished?'finished':'partial capture'}`);n.value=t.id;return n;}):[el('option','No responses yet')]));$('turn').value=selected;
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
  $('filter').hidden=tab==='diagnostics';
  const host=$('content');host.replaceChildren();const filter=$('filter').value.toLowerCase();
  if(tab==='queries')for(const [i,o] of (t?.operations||[]).entries()){
    const queries=o.queries.filter(q=>q.toLowerCase().includes(filter));
    if(!queries.length)continue;
    for(const q of queries){
      const tile=el('section',undefined,`operation-tile tone-${i%3}`);
      tile.append(el('small',`OPERATION ${i+1}`,'operation-label'));
      const ranges=domainRanges(q), row=el('article',undefined,'query-row');
      const paragraph=el('p',undefined,'query');let cursor=0;
      for(const range of ranges){paragraph.append(document.createTextNode(q.slice(cursor,range.start)),el('mark',q.slice(range.start,range.end),'query-domain'));cursor=range.end;}
      paragraph.append(document.createTextNode(q.slice(cursor)));row.append(paragraph);
      const button=el('button','Copy','copy');button.onclick=async()=>{try{await navigator.clipboard.writeText(q);button.textContent='Copied';}catch{button.textContent='Could not copy';}};
      row.append(button);tile.append(row);host.append(tile);
    }
  }
  if(tab==='sources')for(const s of sources){
    if(!`${s.title} ${s.domain} ${s.url}`.toLowerCase().includes(filter))continue;
    const card=el('article',undefined,'card source');
    const address=el('a',s.url,'source-url');address.href=s.url;address.target='_blank';address.rel='noreferrer noopener';
    card.append(address,el('p',s.title,'source-title'));
    const meta=el('div',undefined,'source-meta');
    meta.append(el('span',s.kind==='view'?'Page reference':'Search result','tag'));
    if(s.linked)meta.append(el('span','Linked in answer','tag'));
    card.append(meta);host.append(card);
  }
  if(tab==='diagnostics'){
    host.append(el('p','Download data for the selected response.','note'));
    const actions=el('div',undefined,'footer-actions');
    for(const kind of ['queries','sources']){
      const button=el('button',`Export ${kind} CSV`);button.disabled=!t;
      button.onclick=()=>exportCSV(kind);actions.append(button);
    }
    host.append(actions);
  }
  if(!host.childElementCount){const n=el('div',undefined,'empty');
    const capturing=state.active && state.progress?.phase!=='done';
    n.append(el('b',filter?'No matching results':capturing?'Waiting for search results':state.progress?.phase==='done'?'No entries in this view':'Your search starts here'),el('span',filter?'Try a different filter.':capturing?'This list updates automatically when queries or sources arrive.':'Open ChatGPT, click Start and ask a question that needs a web search.'));host.append(n);}
}
function updateProgress(){
  const status=captureStatus(state,demo);
  $('status').textContent=status.label;$('status').className=`status-${status.color}`;
  $('capture-progress').hidden=!state.active;
  $('progress-detail').textContent=status.detail;
  $('progress-bar').hidden=!status.busy;
}
setInterval(updateProgress,1000);
for(const type of ['start','stop','clear'])$(type).onclick=async()=>{demo=false;if(!liveAPI){state={turns:[],warnings:[]};render();return;}try{state=await rpc(type);render();}catch(e){$('error').textContent=e.message;}};
$('turn').onchange=()=>{selected=$('turn').value;render();};$('filter').oninput=render;
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();});
function exportCSV(kind){
  const t=state.turns?.find(t=>t.id===selected);if(!t)return;
  const rows=kind==='queries'
    ?[['operation','query'],...t.operations.flatMap((o,i)=>o.queries.map(q=>[i+1,q]))]
    :[['domain','title','url','type','reference','linked_in_answer'],...t.sources.map(s=>[s.domain,s.title,s.url,s.kind,s.ref,s.linked?'yes':'no'])];
  const blob=new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');
  a.href=url;a.download=`search-inspector-${kind}-${selected}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Local development preview only; the extension has no demo control.
if(!liveAPI && new URLSearchParams(location.search).has('preview'))fetch('./demo.json').then(r=>r.json()).then(data=>{state=data;demo=true;render();});
if(globalThis.chrome?.storage){chrome.storage.session.get('inspector').then(x=>{if(x.inspector)state=x.inspector;render();});chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session' && changes.inspector && !demo){state=changes.inspector.newValue||{turns:[]};render();}});}else{$('start').disabled=true;}
render();
