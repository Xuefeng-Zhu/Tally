import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const artifact=await realpath(join(dirname(fileURLToPath(import.meta.url)),'..'));
const manifest=JSON.parse(await readFile(join(artifact,'tally-lambda-artifact.json'),'utf8'));
assert.equal(process.platform,manifest.platform);assert.equal(process.arch,manifest.architecture);
if(manifest.deployable){assert.equal(process.platform,'linux');assert.equal(process.arch,'arm64');}
const require=createRequire(join(artifact,'package.json'));
const paths={};
for(const name of ['pdfjs-dist/legacy/build/pdf.mjs','pdfjs-dist/legacy/build/pdf.worker.mjs','@napi-rs/canvas',manifest.native_package]){
  const resolved=await realpath(require.resolve(name));
  assert.ok(!relative(artifact,resolved).startsWith('..'),`Dependency escaped artifact: ${name}`);paths[name]=relative(artifact,resolved);
}
const native=require('@napi-rs/canvas');assert.equal(typeof native.DOMMatrix,'function');
const nativeBytes=await readFile(require.resolve(manifest.native_package));
if(process.platform==='linux'){assert.equal(nativeBytes.subarray(0,4).toString('hex'),'7f454c46');assert.equal(nativeBytes.readUInt16LE(18),process.arch==='arm64'?183:62);}
else assert.equal(nativeBytes.subarray(0,4).toString('hex'),'cffaedfe');
const handlerPath=manifest.handler.replace(/\.handler$/,'.mjs');
const exported=await import(pathToFileURL(join(artifact,handlerPath)).href);assert.equal(typeof exported.handler,'function');
// Import a bundle at the same depth as the runtime handlers and exercise its default asset URL.
const {loadRulePack}=await import(pathToFileURL(join(artifact,'services/rules/rule-probe.mjs')).href);
const ruleContext=loadRulePack();
assert.equal(ruleContext.rule_set_id,'us-federal-irc45r-2025-v1');assert.equal(ruleContext.tax_year,2025);
const rulePaths=['rules/2025/us-federal-irc45r-2025-v1.json','rules/2025/sources/manifest.json'];
assert.deepEqual(manifest.rule_resources,rulePaths);
const ruleAssets={};
for(const path of rulePaths){const resolved=await realpath(join(artifact,path));assert.ok(!relative(artifact,resolved).startsWith('..'),'Rule resource escaped artifact');ruleAssets[path]=createHash('sha256').update(await readFile(resolved)).digest('hex');}
assert.equal(ruleContext.rule_pack_sha256,ruleAssets[rulePaths[0]]);
const {parsePdfBytes}=await import(new URL('./pdf-probe.mjs',import.meta.url));
const pageCounts=[];
for(const name of ['initial-batch.pdf','coverage-statement.pdf']){
  const parsed=await parsePdfBytes(await readFile(new URL(`./fixtures/${name}`,import.meta.url)));
  pageCounts.push(parsed.pageCount);assert.match(parsed.pages.join(' '),/Juniper Lane Bakery LLC/);assert.match(parsed.sha256,/^[a-f0-9]{64}$/);
}
assert.deepEqual(pageCounts,[2,1]);
console.log(JSON.stringify({status:'passed',artifact_root:artifact,platform:`${process.platform}/${process.arch}`,handler_import:'passed',dependency_paths:paths,native_DOMMatrix:'passed',native_binary_header:'passed',pdf_pages:pageCounts,rule_pack_loaded:'passed',rule_set_id:ruleContext.rule_set_id,rule_resources:ruleAssets,network:'blocked',live_calls:'not_run'}));
