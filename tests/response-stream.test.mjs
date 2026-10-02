import test from 'node:test';
import assert from 'node:assert/strict';
import {ResponseStream} from '../response-stream.js';
import {Inspector} from '../parser.js';
test('buffered and early chunks retain order and split UTF-8 without a final response body',()=>{
 const i=new Inspector();const r=new ResponseStream(s=>i.sse(s,'request'));
 const s=`data: ${JSON.stringify({v:{message:{id:'synthetic',channel:'final',metadata:{working_turn_id:'test',search_model_queries:{queries:['żółty kwiat']}},end_turn:true}}})}\n\n`;
 const bytes=Buffer.from(s);const split=bytes.indexOf(Buffer.from('ż'))+1;
 r.write(bytes.subarray(split,split+5).toString('base64'));
 r.start(bytes.subarray(0,split).toString('base64'));
 r.write(bytes.subarray(split+5).toString('base64'));r.finish();
 assert.deepEqual(i.snapshot().turns[0].operations.flatMap(o=>o.queries),['żółty kwiat']);
 assert.equal(i.snapshot().turns[0].finished,true);
});
