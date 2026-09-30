const unique = a => [...new Set(a)];
function referenceId(ref) {
  if(typeof ref==='string')return ref;
  if(ref && Number.isInteger(ref.turn_index) && Number.isInteger(ref.ref_index) && typeof ref.ref_type==='string')return `turn${ref.turn_index}${ref.ref_type}${ref.ref_index}`;
  return null;
}
export function safeURL(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function links(text) {
  return unique([...text.matchAll(/\[[^\]\n]*\]\(<?(https?:\/\/[^\s<>]+?)>?(?:\s+"[^"]*")?\)/g)].map(m => safeURL(m[1])).filter(Boolean));
}
const allowedMeta = new Set(['search_queries','search_model_queries','map_search_model_queries','search_result_groups','inline_cot_expandable_content','content_references']);
function cleanMessage(m) {
  const metadata = Object.fromEntries(Object.entries(m.metadata || {}).filter(([k]) => allowedMeta.has(k)));
  return {id:m.id, author:{role:m.author?.role}, content:m.content, channel:m.channel, status:m.status, end_turn:m.end_turn, metadata};
}
export class Inspector {
  constructor() { this.turns = new Map(); this.streams = new Map(); this.seen = new Set(); this.buffers = new Map(); this.warnings = new Set(); this.frames = 0; this.aliases = new Map(); }
  warn(text) { this.warnings.add(text); }
  batch(input, conversationId) {
    try {
      const data=typeof input==='string'?JSON.parse(input):input;
      if(!Array.isArray(data))throw new Error('shape');
      for(const conversation of data){
        if(!conversationId || (conversation.conversation_id || conversation.id)!==conversationId)continue;
        const mapping=conversation.mapping;
        if(!mapping || typeof mapping!=='object')continue;
        // Only import the currently selected branch, not abandoned/regenerated answers.
        const nodes=[];const visited=new Set();let id=conversation.current_node;
        while(id && mapping[id] && !visited.has(id)){
          visited.add(id);nodes.push(mapping[id]);id=mapping[id].parent;
        }
        if(!nodes.length){this.warn('Conversation snapshot has no active branch.');continue;}
        let turn=null;
        for(const node of nodes.reverse()){
          const m=node.message;if(!m)continue;
          const md=m.metadata||{};
          if(m.author?.role==='user')turn=md.working_turn_id || md.turn_exchange_id || `${conversationId}:${m.id}`;
          const key=md.working_turn_id || md.turn_exchange_id || turn;
          if(!key || m.author?.role==='user' || m.author?.role==='system')continue;
          if(m.channel==='final' || md.search_model_queries || md.search_queries || md.search_result_groups)this.message(m,key);
        }
      }
    } catch {this.warn('Could not parse the conversation snapshot.');}
  }
  turn(key) {
    if (!this.turns.has(key)) this.turns.set(key, {id:`response-${this.turns.size+1}`, operations:new Map(), sources:new Map(), answerLinks:[], finished:false});
    return this.turns.get(key);
  }
  frame(input, context = 'socket') {
    this.frames++;
    try { this.envelope(typeof input === 'string' ? JSON.parse(input) : input, context); }
    catch { this.warn('Could not parse some JSON messages.'); }
  }
  envelope(x, context) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const item of x) this.envelope(item, context); return; }
    if (x.reply?.catchups) this.envelope(x.reply.catchups, context);
    if (x.type === 'message' && x.payload) { this.envelope(x.payload, context); return; }
    if (x.type === 'conversation-turn-stream') { this.envelope(x.payload, context); return; }
    if (x.type === 'stream-item' && typeof x.encoded_item === 'string') {
      if (x.stream_item_id && this.seen.has(x.stream_item_id)) return;
      if (x.stream_item_id) this.seen.add(x.stream_item_id);
      const key = x.turn_id || context;
      this.sse(x.encoded_item, key);
    }
    if (x.update_content?.message) this.message(x.update_content.message, context);
    if (x.type === 'conversation-update' && x.payload) this.envelope(x.payload, context);
  }
  sse(chunk, key) {
    let buffer = (this.buffers.get(key) || '') + chunk.replace(/\r\n/g,'\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0,end); buffer=buffer.slice(end+2);
      const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
      if (!data || data==='[DONE]') continue;
      try { const x=JSON.parse(data); if (x && typeof x==='object' && (x.v!==undefined || x.p!==undefined || x.message)) this.delta(x,key); }
      catch { this.warn('Could not parse a stream event.'); }
    }
    if(buffer.length>2_000_000) {this.warn('An incomplete event exceeded the size limit.');buffer='';}
    this.buffers.set(key,buffer);
  }
  delta(d,key) {
    if(d.message) {this.streams.set(key,{message:cleanMessage(d.message)});this.message(d.message,key);return;}
    if(d.v?.message) {this.streams.set(key,{message:cleanMessage(d.v.message)});this.message(d.v.message,key);return;}
    if(d.o==='patch' && Array.isArray(d.v)) {for(const p of d.v)this.delta(p,key);return;}
    if(typeof d.p!=='string' || !d.o) {this.warn('Unsupported delta shortcut; the preview may be incomplete.');return;}
    const parts=d.p.split('/').slice(1).map(p=>p.replace(/~1/g,'/').replace(/~0/g,'~'));
    if(parts.some(p=>['__proto__','prototype','constructor'].includes(p))) {this.warn('An invalid update path was rejected.');return;}
    if(parts[0]!=='message') return;
    if(parts[1]==='metadata' && !allowedMeta.has(parts[2])) return;
    if(!['metadata','content','status','end_turn','channel'].includes(parts[1])) return;
    const root=this.streams.get(key);
    if(!root){this.warn('The initial message is missing for some updates.');return;}
    let target=root;
    for(const p of parts.slice(0,-1)){if(!target || typeof target!=='object' || !(p in target)){this.warn('Unknown delta path.');return;}target=target[p];}
    const p=parts.at(-1);
    if(!target || typeof target!=='object') {this.warn('Unknown delta path.');return;}
    if(d.o==='append' && typeof target[p]==='string' && typeof d.v==='string')target[p]+=d.v;
    else if(d.o==='append' && Array.isArray(target[p]) && Array.isArray(d.v))target[p].push(...d.v);
    else if(['add','replace'].includes(d.o))target[p]=structuredClone(d.v);
    else if(d.o==='remove') {if(Array.isArray(target))target.splice(Number(p),1);else delete target[p];}
    else {this.warn('Unsupported delta operation.');return;}
    this.message(root.message,key);
  }
  message(m,context) {
    if(!m || !m.id)return;
    const key=m.metadata?.working_turn_id || m.metadata?.turn_exchange_id || this.aliases.get(context) || context;
    this.aliases.set(context,key);
    const t=this.turn(key), meta=m.metadata||{};
    const groups=meta.search_result_groups || [];
    const qs=unique([...(meta.search_model_queries?.queries||[]),...(meta.search_queries||[]).map(q=>q.q)].filter(q=>typeof q==='string'));
    if(qs.length || groups.length) {
      const previous=t.operations.get(m.id);
      // Final metadata repeats earlier searches; it is not a new search operation.
      if(m.channel!=='final')t.operations.set(m.id,{id:previous?.id || `operation-${t.operations.size+1}`,queries:unique([...(previous?.queries||[]),...qs]),refs:unique([...(previous?.refs||[]),...groups.flatMap(g=>(g.entries||[]).map(e=>referenceId(e.ref_id))).filter(Boolean)])});
    }
    for(const g of [...groups,...(meta.inline_cot_expandable_content?.search_result_groups||[])])for(const e of g.entries||[]) {
      const url=safeURL(e.url),ref=referenceId(e.ref_id);if(!url || !ref)continue;
      const kind=/view\d+$/.test(ref)?'view':'search';
      const sourceKey=`${kind}:${url}`;
      const old=t.sources.get(sourceKey);
      t.sources.set(sourceKey,{ref:old?.ref||ref,refs:unique([...(old?.refs||[]),ref]),url,title:String(e.title||old?.title||url),domain:new URL(url).hostname,kind});
    }
    if(m.channel==='final') {
      const text=m.content?.parts?.filter(p=>typeof p==='string').join('') || m.content?.text || '';
      const refs=(meta.content_references||[]).flatMap(r=>[r.url,...(r.items||[]).map(i=>i.url)]).map(safeURL).filter(Boolean);
      t.answerLinks=unique([...t.answerLinks,...links(text),...refs]);
      t.summaryQueries=unique([...(t.summaryQueries||[]),...(meta.map_search_model_queries||[]),...qs].filter(q=>typeof q==='string'));
      if(m.end_turn===true || m.status==='finished_successfully')t.finished=true;
    }
  }
  snapshot() {
    return {version:1,frames:this.frames,warnings:[...this.warnings],turns:[...this.turns.values()].map(t=>{
      const operations=[...t.operations.values()];
      const known=new Set(operations.flatMap(o=>o.queries));
      const missing=(t.summaryQueries||[]).filter(q=>!known.has(q));
      if(missing.length)operations.push({id:'summary',queries:missing,refs:[]});
      return {id:t.id,finished:t.finished,operations,sources:[...t.sources.values()].map(s=>({...s,linked:t.answerLinks.includes(s.url)})),answerLinks:t.answerLinks};
    })};
  }
}
