import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
function run(args:string[],options:{cwd?:string;env?:NodeJS.ProcessEnv}={}){return spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,NODE_PATH:'',NODE_OPTIONS:'',NAPI_RS_NATIVE_LIBRARY_PATH:'',...options.env},...options});}

test('both host Lambda artifacts resolve and parse PDFs in isolated copies; missing native bindings fail closed',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'tally-packaging-test-'));
  try{
    const built=run(['scripts/build-lambdas.mjs','--outdir',directory]);assert.equal(built.status,0,built.stderr);const receipt=JSON.parse(built.stdout.trim().split('\n').at(-1)!);assert.equal(receipt.status,'host_build_verified');assert.equal(receipt.deployable,false);
    for(const name of ['ApiFunction','WorkerFunction']){
      const artifact=join(directory,name),manifest=JSON.parse(await readFile(join(artifact,'tally-lambda-artifact.json'),'utf8')),verification=JSON.parse(await readFile(join(artifact,'packaging/verification.json'),'utf8'));
      assert.equal(manifest.deployable,false);assert.equal(manifest.platform,process.platform);assert.equal(manifest.architecture,process.arch);assert.equal(verification.handler_import,'passed');assert.equal(verification.native_DOMMatrix,'passed');assert.deepEqual(verification.pdf_pages,[2,1]);assert.ok(Object.values(verification.dependency_paths).every(value=>typeof value==='string' && value.startsWith('node_modules/')));
      const handler=manifest.handler.replace(/\.handler$/,'.mjs');assert.ok((await stat(join(artifact,handler))).size>0);
      const rejected=run(['--input-type=module','-e',`await import(${JSON.stringify(join(artifact,handler))});`],{cwd:artifact,env:{AWS_LAMBDA_FUNCTION_NAME:'tally-host-artifact-guard'}});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/HOST_LAMBDA_ARTIFACT_NOT_DEPLOYABLE/);
    }
    const broken=join(directory,'missing-native');await cp(join(directory,'WorkerFunction'),broken,{recursive:true});const manifest=JSON.parse(await readFile(join(broken,'tally-lambda-artifact.json'),'utf8'));await rm(join(broken,'node_modules',manifest.native_package),{recursive:true});const rejected=run([join(broken,'packaging/verify.mjs')],{cwd:broken});assert.notEqual(rejected.status,0,'Missing native dependency must not fall back to repository modules');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('SAM make builds reject non-Linux-ARM64 hosts before creating artifacts or installing dependencies',async(t)=>{
  if(process.platform==='linux'&&process.arch==='arm64'){t.skip('This is the permitted SAM target; no npm install is performed by this offline guard test.');return;}
  const directory=await mkdtemp(join(tmpdir(),'tally-sam-build-guard-'));const artifact=join(directory,'ApiFunction');try{const result=run(['scripts/build-one-lambda.mjs','ApiFunction','--sam','--artifacts-dir',artifact]);assert.notEqual(result.status,0);assert.match(result.stderr,/LAMBDA_BUILD_REQUIRES_LINUX_ARM64/);await assert.rejects(stat(artifact),error=>(error as NodeJS.ErrnoException).code==='ENOENT');}finally{await rm(directory,{recursive:true,force:true});}
});
