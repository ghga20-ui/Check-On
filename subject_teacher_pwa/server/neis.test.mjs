import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNeisHandler,validateRequest} from './neis.mjs';
const body={endpoint:'schoolInfo',params:{ATPT_OFCDC_SC_CODE:'J10',SCHUL_NM:'예시고등학교'}};
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(b){this.body=b;return this;}};}
test('rejects arbitrary endpoints, keys and student information',()=>{
  for(const bad of [{...body,endpoint:'https://example.com'},{...body,params:{...body.params,KEY:'secret'}},{...body,params:{...body.params,studentName:'학생'}}])assert.throws(()=>validateRequest(bad));
});
test('keeps key upstream only and caches identical public queries',async()=>{
  let calls=0;
  const handler=createNeisHandler({env:{NEIS_API_KEY:'private-key'},fetchImpl:async(url,opts)=>{calls++;assert.equal(url.protocol,'https:');assert.equal(url.searchParams.get('KEY'),'private-key');assert.equal(opts.redirect,'error');return {ok:true,text:async()=>JSON.stringify({schoolInfo:[{row:[]}]})};}});
  for(let i=0;i<2;i++){const out=res();await handler({method:'POST',body,headers:{}},out);assert.equal(out.code,200);assert.ok(!JSON.stringify(out.body).includes('private-key'));}
  assert.equal(calls,1);
});
test('sanitizes upstream errors and restricts request rate',async()=>{
  const handler=createNeisHandler({env:{NEIS_API_KEY:'private-key'},now:()=>100000,fetchImpl:async()=>{throw new Error('private-key');}});
  const out=res();await handler({method:'POST',body,headers:{}},out);assert.equal(out.code,502);assert.ok(!JSON.stringify(out.body).includes('private-key'));
  for(let i=0;i<120;i++)await handler({method:'POST',body,headers:{}},out);
  assert.equal(out.code,429);
});
test('missing key and invalid methods fail without upstream calls',async()=>{
  const handler=createNeisHandler({env:{},fetchImpl:()=>{throw new Error('must not call');}}),out=res();
  await handler({method:'GET'},out);assert.equal(out.code,405);
  await handler({method:'POST',body,headers:{}},out);assert.equal(out.code,503);
});
