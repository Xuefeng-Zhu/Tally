import {test} from 'node:test';import assert from 'node:assert/strict';
import {createAwsForwarder} from '../apps/local-proxy/signed-upstream.js';
import {readConfiguration,validateApiOrigin} from '../packages/contracts/configuration.js';
test('Fixed context and upstream origin reject alternate identities or arbitrary URLs',()=>{
 assert.equal(readConfiguration({}).mode,'fixture');
 for(const TALLY_TAX_YEAR of ['2026','0'])assert.throws(()=>readConfiguration({TALLY_TAX_YEAR}));
 for(const url of ['http://abc.execute-api.us-east-1.amazonaws.com','https://evil.example/','https://abc.execute-api.us-west-2.amazonaws.com','https://abc.execute-api.us-east-1.amazonaws.com/?url=https://evil.example','https://abc.execute-api.us-east-1.amazonaws.com/stage'])assert.throws(()=>validateApiOrigin(url));
});
test('Proxy denies ungated or nonallowlisted requests before signing or fetching',async()=>{
 let calls=0;const signer={sign:async()=>{calls++;return {headers:{}};}};const origin='https://abc.execute-api.us-east-1.amazonaws.com';
 const blocked=createAwsForwarder({apiOrigin:origin,approvedLiveFlow:false,signer});await assert.rejects(blocked('GET','/api/state',''));assert.equal(calls,0);
 const proxy=createAwsForwarder({apiOrigin:origin,approvedLiveFlow:true,signer});for(const path of ['/webhooks/box','/api/state?business_id=other','https://evil.example','/api/state/../admin'])await assert.rejects(proxy('GET',path,''));assert.equal(calls,0);
});
test('Proxy signs exactly the fixed host and route and cannot follow redirects',async()=>{
 const captured:unknown[]=[];const proxy=createAwsForwarder({apiOrigin:'https://abc.execute-api.us-east-1.amazonaws.com',approvedLiveFlow:true,signer:{sign:async(request)=>{captured.push(request);return {headers:{authorization:'test-signature'}};}},fetcher:(async(url,options)=>{captured.push({url,options});return new Response('{"ok":true}',{status:202});}) as typeof fetch});
 assert.deepEqual(await proxy('POST','/api/demo/reconcile','{}'),{status:202,body:{ok:true}});assert.equal((captured[0] as {hostname:string}).hostname,'abc.execute-api.us-east-1.amazonaws.com');assert.equal((captured[1] as {options:RequestInit}).options.redirect,'error');
});
