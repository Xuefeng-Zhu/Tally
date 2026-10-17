import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fixtureSource } from '../fixtures/sources.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_PROFILE, type State } from '../packages/contracts/index.js';
import { createApi } from '../services/api/app.js';
import { TallyEngine, MemoryStore } from '../services/worker/core.js';
import { startServer } from '../apps/local-proxy/server.js';

test('API validates selectors and profile revisions before accepting work', async () => {
  const engine = new TallyEngine(new MemoryStore());
  let enqueued = 0;
  const api = createApi({engine, enqueue: async () => { enqueued++; }});
  const send = (method: string, path: string, body: unknown) => api({method,path,rawBody:JSON.stringify(body)});
  assert.equal((await send('POST','/api/demo/analyze',{file_ids:['fixture-A']})).status,409);
  assert.equal((await api({method:'PUT',path:'/api/profile',rawBody:'{'})).status,400);
  assert.equal((await send('PUT','/api/profile',{expected_profile_rev:0,profile:{...DEFAULT_PROFILE,tenant_id:'other'}})).status,422);
  assert.equal((await send('PUT','/api/profile',{expected_profile_rev:0,profile:{...DEFAULT_PROFILE,tax_year:2026}})).status,422);
  assert.equal((await send('PUT','/api/profile',{expected_profile_rev:0,profile:DEFAULT_PROFILE})).status,201);
  assert.equal((await send('PUT','/api/profile',{expected_profile_rev:0,profile:DEFAULT_PROFILE})).status,200,'Identical retry is idempotent');
  assert.equal((await send('PUT','/api/profile',{expected_profile_rev:0,profile:{...DEFAULT_PROFILE,approximate_headcount:5}})).status,409);
  assert.equal((await send('POST','/api/demo/analyze',{file_ids:['fixture-A','fixture-B','other']})).status,422);
  assert.equal((await send('POST','/api/demo/analyze',{file_ids:['fixture-A'],business_id:'other'})).status,422);
  assert.equal((await send('POST','/api/demo/reconcile',{tax_year:2026})).status,422);
  assert.equal((await send('POST','/webhooks/box',{})).status,403);
  assert.equal((await api({method:'GET',path:'/missing'})).status,404);
  assert.equal(enqueued,2,'Only accepted initial save and identical retry may schedule work');
});

test('profile save reports durable success separately from failed scheduling', async () => {
  const engine = new TallyEngine(new MemoryStore());
  const api = createApi({engine,enqueue:async () => {throw new Error('unexposed queue detail');}});
  const result = await api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})});
  assert.equal(result.status,503);
  const error=result.body as {code:string;profile_saved:boolean;retryable:boolean;correlation_id:string};
  assert.equal(error.code,'PROFILE_SAVED_EVALUATION_PENDING');
  assert.equal(error.profile_saved,true);
  assert.equal(error.retryable,true);
  assert.ok(error.correlation_id);
  assert.equal((await engine.state()).profile_rev,1);
  assert.doesNotMatch(JSON.stringify(result.body),/unexposed queue detail/);
});

test('local HTTP flow persists A-to-B results, serves PDF sources, and rejects foreign origins', async () => {
  const directory=await mkdtemp(join(tmpdir(),'tally-api-'));
  const dataPath=join(directory,'state.json');
  let running=await startServer({port:0,dataPath});
  try {
    const send=async (path:string,body?:unknown,method='POST') => fetch(`${running.url}${path}`,{method:body===undefined?'GET':method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const read=async ():Promise<State> => (await send('/api/state')).json();
    const wait=async (stage:string) => {
      const end=Date.now()+10_000;
      do {const current=await read();if(current.opportunity?.stage===stage)return current;await delay(50);}while(Date.now()<end);
      throw new Error(`Stage ${stage} was not reached`);
    };
    assert.equal((await read()).profile_rev,0);
    assert.equal((await send('/api/profile',{expected_profile_rev:0,profile:DEFAULT_PROFILE},'PUT')).status,201);
    assert.equal((await send('/api/demo/analyze',{file_ids:['fixture-A']})).status,202);
    const a=await wait('needs_coverage_statement');
    assert.equal((await send('/api/demo/analyze',{file_ids:['fixture-B']})).status,202);
    const b=await wait('evidence_updated');
    assert.equal(a.opportunity!.opportunity_id,b.opportunity!.opportunity_id);
    assert.equal(b.opportunity!.annual_requirements.length,8);
    assert.ok(b.opportunity!.annual_requirements.every(check=>check.result==='unknown'));
    assert.equal(b.opportunity!.reported_employer_share_basis_points,8000);
    assert.equal(b.opportunity!.estimate.amount_cents,null);
    assert.equal(b.opportunity!.evidence_checks.find(check=>check.requirement_id==='payment_to_coverage_match')?.result,'unknown');
    for(const source of ['/fixtures/initial-batch.pdf','/fixtures/coverage-statement.pdf']) {
      const response=await send(source);
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-type')??'',/application\/pdf/);
      assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
    }
    assert.equal((await fetch(`${running.url}/api/state`,{headers:{Origin:'https://foreign.example'}})).status,403);
    assert.equal((await send('/api/state?business_id=other')).status,422);
    await running.close();
    running=await startServer({port:0,dataPath});
    const restarted=await read();
    assert.equal(restarted.opportunity!.opportunity_id,b.opportunity!.opportunity_id);
    assert.equal(restarted.opportunity!.revision,b.opportunity!.revision);
    assert.equal(restarted.profile_rev,1);
  } finally {
    await running.close();
    await rm(directory,{recursive:true,force:true});
  }
});

test('webhook validates raw-body signature pairs, freshness, and event scope before durable intake', async () => {
  const primary='test-primary-key';
  const secondary='test-secondary-key';
  const engine=new TallyEngine(new MemoryStore(),{resolveSource:async fileId=>{
    const source=fixtureSource('fixture-A');
    source.file_id=fileId;
    source.facts=source.facts.map(fact=>({...fact,fact_id:`${fileId}:${fact.fact_id}`,source:{...fact.source,file_id:fileId}}));
    return source;
  }});
  await engine.saveProfile(DEFAULT_PROFILE,0);
  let enqueued=0;
  const api=createApi({engine,enqueue:async()=>{enqueued++;},webhook:{primaryKey:primary,secondaryKey:secondary,webhookId:'webhook-1',folderId:'folder-1'}});
  const event={type:'webhook_event',id:'event-1',trigger:'FILE.UPLOADED',webhook:{id:'webhook-1'},source:{type:'file',id:'123',parent:{id:'folder-1'},file_version:{id:'1'}}};
  const body=JSON.stringify(event);
  const timestamp=new Date().toISOString();
  const signature=(raw:string,key:string,time=timestamp)=>createHmac('sha256',key).update(raw).update(time).digest('base64');
  const headers=(raw:string,key:string,slot='box-signature-primary',time=timestamp)=>({'box-signature-version':'1','box-signature-algorithm':'HmacSHA256','box-delivery-timestamp':time,[slot]:signature(raw,key,time)});
  const send=(raw:string,requestHeaders:Record<string,string>)=>api({method:'POST',path:'/webhooks/box',rawBody:Buffer.from(raw),headers:requestHeaders});
  assert.equal((await send(body,headers(body,secondary))).status,403,'Secondary key cannot validate the primary signature slot');
  assert.equal((await send(body+' ',headers(body,primary))).status,403,'Exact raw body bytes must be validated');
  const stale=new Date(Date.now()-601_000).toISOString();
  assert.equal((await send(body,headers(body,primary,'box-signature-primary',stale))).status,403);
  const ignored=JSON.stringify({...event,source:{...event.source,parent:{id:'other-folder'}}});
  assert.equal((await send(ignored,headers(ignored,primary))).status,200);
  assert.equal(enqueued,0);
  assert.equal((await send('{',headers('{',primary))).status,400,'Authentic malformed JSON is rejected rather than acknowledged');
  assert.equal(enqueued,0);
  assert.equal((await send(body,headers(body,secondary,'box-signature-secondary'))).status,202);
  assert.equal(enqueued,1);
  assert.equal((await engine.state()).documents[0].file_id,'123');
});


test('webhook queue failure returns 503 and a retry of the same event can durably enqueue',async()=>{
 const key='synthetic-test-key',time=new Date().toISOString();
 const raw=JSON.stringify({type:'webhook_event',id:'same-event',trigger:'FILE.UPLOADED',webhook:{id:'wh'},source:{type:'file',id:'123',parent:{id:'folder'}}});
 const signature=createHmac('sha256',key).update(raw).update(time).digest('base64');
 const headers={'box-signature-version':'1','box-signature-algorithm':'HmacSHA256','box-delivery-timestamp':time,'box-signature-primary':signature};
 const engine=new TallyEngine(new MemoryStore(),{resolveSource:fileId=>{const source=fixtureSource('fixture-A');source.file_id=fileId;source.facts=source.facts.map(f=>({...f,fact_id:`${fileId}:${f.fact_id}`,source:{...f.source,file_id:fileId}}));return source;}});
 await engine.saveProfile(DEFAULT_PROFILE,0);let sends=0;
 const api=createApi({engine,webhook:{primaryKey:key,webhookId:'wh',folderId:'folder'},enqueue:async()=>{if(++sends===1)throw new Error('queue failed');}});
 assert.equal((await api({method:'POST',path:'/webhooks/box',headers,rawBody:raw})).status,503);
 assert.equal((await engine.state()).facts.length,0,'No AI runs in acknowledgment');
 assert.equal((await api({method:'POST',path:'/webhooks/box',headers,rawBody:raw})).status,202);
 assert.equal(sends,2);assert.equal((await engine.state()).jobs.filter(j=>j.kind==='INGEST').length,1);
});
