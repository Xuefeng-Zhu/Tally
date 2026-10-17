import {test} from 'node:test';import assert from 'node:assert/strict';
import {webEnvironment} from '../services/runtime/web-environment.js';
test('Web dev process receives public configuration without provider credentials or mutating API environment',()=>{
 const env={OPENROUTER_API_KEY:'synthetic-key',AWS_SECRET_ACCESS_KEY:'synthetic-aws-secret',BOX_ACCESS_TOKEN:'synthetic-box-token',TALLY_WEB_PORT:'5173',PATH:'/test-path'};
 const web=webEnvironment(env);assert.equal(web.OPENROUTER_API_KEY,undefined);assert.equal(web.AWS_SECRET_ACCESS_KEY,undefined);assert.equal(web.BOX_ACCESS_TOKEN,undefined);assert.equal(web.TALLY_WEB_PORT,'5173');assert.equal(web.PATH,'/test-path');assert.equal(env.OPENROUTER_API_KEY,'synthetic-key');
});
