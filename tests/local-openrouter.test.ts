import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {localExplanationOptions} from '../services/runtime/local-explanation.js';
import {startServer} from '../apps/local-proxy/server.js';import {FileStore} from '../services/storage/file-store.js';
test('Ordinary fixture runtime stays offline until explicitly enabled',()=>{
 let reads=0;const dependencies={getApiKey:async()=>{reads++;return 'synthetic';}};
 assert.deepEqual(localExplanationOptions({},dependencies),{});assert.equal(reads,0);
 assert.equal(typeof localExplanationOptions({TALLY_OPENROUTER_ENABLED:'true'},dependencies).explain,'function');assert.equal(reads,0,'Enabling construction must not read credentials or call a provider');
 assert.throws(()=>localExplanationOptions({TALLY_EXECUTION_MODE:'aws',TALLY_OPENROUTER_ENABLED:'true'},dependencies),/SYNTHETIC_FIXTURE/);
 for(const amount of ['-1','NaN','0.51','Infinity','1e-3'])assert.throws(()=>localExplanationOptions({TALLY_OPENROUTER_ENABLED:'true',OPENROUTER_PRIOR_SPEND_USD:amount},dependencies),/PRIOR_SPEND/);
});
test('Restart refuses unfinished persisted jobs before an opted-in provider can run',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'tally-pending-')),'state.json');const store=new FileStore(path);
 await store.transact(state=>{state.jobs.push({job_id:'pending',kind:'INGEST',file_id:'fixture-A',file_version_id:null,status:'queued',attempts:0,lease_until:null,error:null,committed:false});});
 const before=process.env.TALLY_OPENROUTER_ENABLED;process.env.TALLY_OPENROUTER_ENABLED='true';
 try{await assert.rejects(startServer({dataPath:path,port:0}),/OPENROUTER_PENDING_WORK_REQUIRES_REVIEW/);assert.equal((await store.read()).jobs[0].status,'queued');}
 finally{if(before===undefined)delete process.env.TALLY_OPENROUTER_ENABLED;else process.env.TALLY_OPENROUTER_ENABLED=before;}
});
