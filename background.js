import {Inspector} from './parser.js';
import {ResponseStream} from './response-stream.js';
let inspector = new Inspector(), tabId=null, active=false, failure='', requests=new Map(), timer, cached=null;
let progress={phase:'idle',since:Date.now()}, baseline='';
const signature=()=>JSON.stringify(inspector.snapshot().turns.at(-1)||null);
function phase(value){if(progress.phase!==value)progress={phase:value,since:Date.now()};publish();}
function begin(){baseline=signature();phase('recording');}
function settle(){
  const latest=inspector.snapshot().turns.at(-1);
  const hasResults=latest && (latest.sources.length || latest.operations.some(o=>o.queries.length));
  if(latest?.finished && hasResults && signature()!==baseline)phase('done');
  else phase('waiting');
}
const view=()=>cached || ({...inspector.snapshot(),active,tabId,failure,progress});
function publish(){if(timer)return;timer=setTimeout(()=>{timer=null;chrome.storage.session.set({inspector:view()}).catch(()=>{});},100);}
const debug=(source,method,params={})=>chrome.debugger.sendCommand(source,method,params);
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
async function stop(){const id=tabId;active=false;tabId=null;requests.clear();phase('idle');if(id!==null)try{await chrome.debugger.detach({tabId:id});}catch{}publish();}
async function start(windowId){
  const query=Number.isInteger(windowId)?{active:true,windowId}:{active:true,lastFocusedWindow:true};
  const [tab]=await chrome.tabs.query(query);
  if(!Number.isInteger(tab?.id))throw new Error('No active tab found in this panel’s window. Select your ChatGPT tab and try again.');
  let address=tab.url;
  // activeTab can be unavailable when the side panel is reopened. Resolve only
  // the selected tab, never another ChatGPT tab in a different window.
  if(!address){
    const targets=await chrome.debugger.getTargets();
    address=targets.find(t=>t.tabId===tab.id && t.type==='page')?.url;
  }
  if(!address)throw new Error('Chrome did not provide the active tab’s address. Allow access to chatgpt.com in the extension settings, then reload the extension.');
  let url;try{url=new URL(address);}catch{throw new Error('Could not recognize the active tab’s address.');}
  if(url.protocol!=='https:' || url.hostname!=='chatgpt.com')throw new Error(`The active tab is on ${url.hostname || url.protocol}. Select a https://chatgpt.com tab in the same window.`);
  await stop();cached=null;inspector=new Inspector();failure='';
  await chrome.debugger.attach({tabId:tab.id},'1.3');tabId=tab.id;active=true;
  baseline='';phase('armed');
  try {
    await debug({tabId},'Network.enable');
    await debug({tabId},'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'worker',exclude:false},{type:'iframe',exclude:false}]});
  }catch(e){await stop();throw e;}
  publish();
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(s.id!==chrome.runtime.id)return;
  (async()=>{
    if(m.type==='start')await start(m.windowId);
    if(m.type==='stop')await stop();
    if(m.type==='clear'){await stop();cached=null;inspector=new Inspector();failure='';publish();}
    if(m.type==='get')return view();
    return view();
  })().then(reply).catch(e=>{failure=e.message;publish();reply({...view(),failure});});
  return true;
});
chrome.debugger.onDetach.addListener(source=>{if(source.tabId===tabId){active=false;tabId=null;requests.clear();phase('idle');inspector.warn('Capture was disconnected.');publish();}});
chrome.tabs.onUpdated.addListener((id,change)=>{if(id===tabId && change.url){try{if(new URL(change.url).hostname!=='chatgpt.com')void stop();}catch{void stop();}}});
chrome.debugger.onEvent.addListener((source,method,p)=>{
  if(!active || source.tabId!==tabId)return;
  const ctx=`${source.sessionId||'main'}:${p.requestId||''}`;
  const eventCapture=inspector;
  (async()=>{
    if(method==='Network.requestWillBeSent'){
      let url;try{url=new URL(p.request.url);}catch{return;}
      if(url.hostname==='chatgpt.com' && p.request.method==='POST' && ['/backend-api/f/conversation','/backend-api/conversation'].includes(url.pathname)){
        begin();requests.set(ctx,{source,id:p.requestId,kind:'pending'});
      }
    }
    if(method==='Target.attachedToTarget'){
      const child={tabId,sessionId:p.sessionId};
      await debug(child,'Network.enable');
      await debug(child,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'worker',exclude:false},{type:'iframe',exclude:false}]});
    }
    if(method==='Network.webSocketFrameReceived'){
      if(p.response.opcode===1){
        // Ignore unrelated application sockets before any decoding or storage.
        const data=p.response.payloadData;
        if(/conversation-turn-stream|conversation-update|stream-item|"catchups"/.test(data)){
          const before=signature();inspector.frame(data,ctx);
          if(signature()!==before){
            if(['armed','done'].includes(progress.phase)){baseline=before;phase('recording');}
            const latest=inspector.snapshot().turns.at(-1);
            if(latest?.finished)settle();
          }
        }
      }else if(p.response.opcode===2)inspector.warn('A binary frame was detected; this format is not supported.');
      publish();
    }
    if(method==='Network.dataReceived' && p.data){
      requests.get(ctx)?.stream?.write(p.data);
    }
    if(method==='Network.responseReceived'){
      let url;try{url=new URL(p.response.url);}catch{return;}
      if(url.hostname==='chatgpt.com' && p.response.status===200){
        const kind=url.pathname==='/backend-api/conversations/batch'?'batch':p.response.mimeType?.includes('text/event-stream')?'sse':null;
        if(kind){
          const r={source,id:p.requestId,kind};requests.set(ctx,r);
          if(kind==='sse'){
            if(['armed','done'].includes(progress.phase))begin();
            r.stream=new ResponseStream(text=>{
              if(!active || eventCapture!==inspector)return;
              inspector.sse(text,ctx);
              if(inspector.snapshot().turns.at(-1)?.finished)settle();
              publish();
            });
            r.streaming=debug(source,'Network.streamResourceContent',{requestId:p.requestId})
              .then(result=>{r.stream.start(result.bufferedData);return true;})
              .catch(()=>{r.stream=null;return false;});
          }
        }
      }
    }
    // Prefer streamed bytes; use the completed response on older Chrome versions.
    if(method==='Network.loadingFinished' && requests.has(ctx)){
      const r=requests.get(ctx);
      if(r.kind==='pending'){requests.delete(ctx);phase('waiting');return;}
      if(r.streaming && await r.streaming){
        requests.delete(ctx);
        if(!active || eventCapture!==inspector)return;
        r.stream.finish();settle();publish();return;
      }
      requests.delete(ctx);
      const capture=inspector;
      if(progress.phase!=='done')phase('processing');
      const body=await debug(r.source,'Network.getResponseBody',{requestId:r.id});
      if(!active || capture!==inspector)return;
      const text=body.base64Encoded?new TextDecoder().decode(Uint8Array.from(atob(body.body),c=>c.charCodeAt(0))):body.body;
      if(r.kind==='batch'){
        const tab=await chrome.tabs.get(source.tabId);
        if(!active || capture!==inspector)return;
        const url=new URL(tab.url);
        const conversationId=url.hostname==='chatgpt.com'?url.pathname.match(/\/c\/([^/]+)/)?.[1]:null;
        if(conversationId)inspector.batch(text,conversationId);
        else inspector.warn('Conversation snapshot skipped: the active conversation could not be identified.');
      }else inspector.sse(text,ctx);
      settle();publish();
    }
    if(method==='Network.loadingFailed' && requests.has(ctx)){requests.delete(ctx);inspector.warn('The HTTP response was interrupted; capture may be incomplete.');phase('interrupted');publish();}
  })().catch(()=>{if(!active || eventCapture!==inspector)return;inspector.warn('Could not read some network traffic.');phase('interrupted');publish();});
});
// A restarted service worker cannot reconstruct transient reducer state.
chrome.storage.session.get('inspector').then(({inspector:old})=>{
  if(old && !active && inspector.frames===0){
    cached={...old,active:false,tabId:null,progress:{phase:'idle',since:Date.now()},failure:'Restart capture to continue. The previous preview is kept until you start.'};
    chrome.storage.session.set({inspector:cached});
  }
});
