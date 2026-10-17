import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DEFAULT_PROFILE,type Profile} from '../packages/contracts/index.js';
import {RULE_LIBRARY} from '../packages/rules/library.js';
import {ProfileScreeningFields} from '../apps/web/src/ProfileScreeningFields.js';
const render=(profile:Profile=DEFAULT_PROFILE)=>renderToStaticMarkup(createElement(ProfileScreeningFields,{profile,onAnswer:()=>{}}));
const selections=(html:string,flag:string)=>[...html.matchAll(/<select[^>]*data-screening-flag="([^"]+)"[^>]*>(.*?)<\/select>/g)].filter(match=>match[1]===flag).map(match=>match[2]);

test('all ten rules expose labeled three-state answers without inventing evidence',()=>{
 const html=render();
 assert.equal((html.match(/data-testid="screening-irc_/g)??[]).length,10);
 assert.equal((html.match(/<select/g)??[]).length,RULE_LIBRARY.reduce((sum,rule)=>sum+rule.conditions.length,0));
 const labels=[...html.matchAll(/<label for="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(new Set(labels).size,labels.length);
 for(const id of labels)assert.ok(html.includes(`id="${id}"`));
 for(const match of html.matchAll(/<select[^>]*>(.*?)<\/select>/g))for(const value of ['yes','no','unknown'])assert.ok(match[1].includes(`value="${value}"`));
 assert.match(html,/do not confirm document facts, establish eligibility or calculate a tax benefit/);
 assert.match(html,/Owner&#x27;s review/);
 assert.doesNotMatch(html,/you are eligible|you qualify|guaranteed refund|refund estimate/i);
});

test('legacy profiles start unanswered except their existing shared health answer',()=>{
 const html=render();
 for(const rule of RULE_LIBRARY)for(const condition of rule.conditions){
  const expected=condition.flag==='health_benefits_offered'?'yes':'unknown';
  for(const select of selections(html,condition.flag))assert.ok(select.includes(`value="${expected}" selected=""`),condition.flag);
 }
});

test('saved rule answers and the shared health answer render consistently',()=>{
 const rule=RULE_LIBRARY.find(rule=>rule.id==='irc_179')!;
 const flags=Object.fromEntries(rule.conditions.map(condition=>[condition.flag,'yes' as const]));
 const html=render({...DEFAULT_PROFILE,health_benefits_offered:'no',opportunity_flags:{...flags,health_benefits_offered:'yes'}});
 for(const condition of rule.conditions)for(const select of selections(html,condition.flag))assert.ok(select.includes('value="yes" selected=""'));
 for(const select of selections(html,'health_benefits_offered'))assert.ok(select.includes('value="no" selected=""'));
 assert.match(html,/Uses the same answer as People &amp; health benefits/);
});
