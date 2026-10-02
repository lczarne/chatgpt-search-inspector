import test from 'node:test';
import assert from 'node:assert/strict';
test('fetch SSE is captured through debugger bytes without getResponseBody',async()=>{
 let event,message,resolveStream,bodyReads=0;
 const noop={addListener(){}};
 globalThis.chrome={sidePanel:{setPanelBehavior:async()=>{}},runtime:{id:'test',onMessage:{addListener:f=>message=f}},tabs:{query:async()=>[{id:1,url:'https://chatgpt.com/c/test'}],onUpdated:noop},storage:{session:{get:async()=>({}),set:async()=>{}}},debugger:{attach:async()=>{},detach:async()=>{},onDetach:noop,onEvent:{addListener:f=>event=f},sendCommand:async(_s,m)=>{
  if(m==='Network.streamResourceContent')return new Promise(r=>resolveStream=r);
  if(m==='Network.getResponseBody'){bodyReads++;throw Error('unavailable');}
  return {};
 }}};
 await import('../background.js');
 const rpc=type=>new Promise(resolve=>message({type},{id:'test'},resolve));
 await rpc('start');
 const source={tabId:1};
 event(source,'Network.responseReceived',{requestId:'r',response:{url:'https://chatgpt.com/backend-api/f/conversation',status:200,mimeType:'text/event-stream'}});
 const bytes=Buffer.from(`data: ${JSON.stringify({v:{message:{id:'m',channel:'final',end_turn:true,metadata:{working_turn_id:'t',search_model_queries:{queries:['synthetic query']}}}}})}\n\n`);
 event(source,'Network.dataReceived',{requestId:'r',data:bytes.subarray(20).toString('base64')});
 event(source,'Network.loadingFinished',{requestId:'r'});
 resolveStream({bufferedData:bytes.subarray(0,20).toString('base64')});
 await new Promise(r=>setImmediate(r));
 const result=await rpc('get');
 assert.equal(bodyReads,0);assert.equal(result.progress.phase,'done');
 assert.deepEqual(result.turns[0].operations.flatMap(o=>o.queries),['synthetic query']);
 await rpc('stop');
});
