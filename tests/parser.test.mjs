import test from 'node:test';
import assert from 'node:assert/strict';
import {Inspector} from '../parser.js';
const event=x=>`data: ${JSON.stringify(x)}\n\n`;
test('SSE shortcuts, metadata merges and repeated delivery preserve queries and sources',()=>{
 const i=new Inspector();
 const stream=[
  {v:{message:{id:'sample',channel:'final',metadata:{working_turn_id:'sample-turn',content_references:[]},content:{parts:['']}}}},
  {p:'/message/content/parts/0',o:'append',v:'See '},
  {v:'[guide](https://example.com/guide)'},
  {p:'',o:'patch',v:[{p:'/message/metadata',o:'append',v:{map_search_model_queries:['sample query'],search_result_groups:[{entries:[{url:'https://example.com/guide',title:'Guide',ref_id:{turn_index:0,ref_type:'search',ref_index:0}}]}],private_field:'must not retain'}}]},
  {v:[{p:'/message/end_turn',o:'replace',v:true}]}
 ].map(event).join('');
 i.sse(stream,'live');i.sse(stream,'body');
 const s=i.snapshot();assert.equal(s.turns.length,1);
 assert.deepEqual(s.turns[0].operations.flatMap(o=>o.queries),['sample query']);
 assert.equal(s.turns[0].sources.length,1);assert.equal(s.turns[0].sources[0].linked,true);
 assert.equal(s.turns[0].finished,true);assert.deepEqual(s.warnings,[]);
 assert.equal(i.streams.get('body').message.metadata.private_field,undefined);
});
