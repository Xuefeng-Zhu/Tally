import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'package.json'));
const functions={ApiFunction:'api',WorkerFunction:'worker'};
const manifestName='tally-lambda-artifact.json';
export function assertBuildPlatform(mode,platform=process.platform,arch=process.arch){
  if(mode==='lambda' && (platform!=='linux'||arch!=='arm64'))throw new Error('LAMBDA_BUILD_REQUIRES_LINUX_ARM64: use sam build --use-container; host artifacts cannot be deployed.');
  if(!['lambda','host'].includes(mode))throw new Error('INVALID_BUILD_MODE');
  if(!['darwin/arm64','darwin/x64','linux/arm64','linux/x64'].includes(`${platform}/${arch}`))throw new Error('UNSUPPORTED_NATIVE_BUILD_PLATFORM');
}
function nativeName(){return `@napi-rs/canvas-${process.platform}-${process.arch}${process.platform==='linux'?'-gnu':''}`;}
async function emptyOwnedDirectory(path){
  const destination=resolve(path);
  if([root,dirname(root),'/','/tmp',join(root,'node_modules'),join(root,'.git')].includes(destination))throw new Error('UNSAFE_ARTIFACT_DIRECTORY');
  try{const names=await readdir(destination);if(names.length&&!names.includes(manifestName))throw new Error('REFUSE_NONEMPTY_UNOWNED_ARTIFACT_DIRECTORY');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});return destination;
}
function run(command,args,options={}){
  const result=spawnSync(command,args,{cwd:root,encoding:'utf8',...options});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed (${result.status}): ${(result.stderr||result.stdout).slice(-3000)}`);
  return result.stdout;
}
export async function verifyIsolatedArtifact(artifactsDir){
  const temporary=await mkdtemp(join(tmpdir(),'tally-isolated-lambda-'));
  try{
    const isolated=join(temporary,'artifact');await cp(artifactsDir,isolated,{recursive:true,dereference:true});
    const env={...process.env,NODE_PATH:'',NODE_OPTIONS:'',NAPI_RS_NATIVE_LIBRARY_PATH:''};
    delete env.AWS_ACCESS_KEY_ID;delete env.AWS_SECRET_ACCESS_KEY;delete env.AWS_SESSION_TOKEN;delete env.AWS_PROFILE;
    const output=run(process.execPath,['--require',join(isolated,'packaging/offline-guard.cjs'),join(isolated,'packaging/verify.mjs')],{cwd:isolated,env});
    const receipt=JSON.parse(output.trim().split('\n').at(-1));
    if(receipt.artifact_root!==await realpath(isolated)||receipt.pdf_pages.join(',')!=='2,1'||receipt.rule_pack_loaded!=='passed')throw new Error('ISOLATED_ARTIFACT_VERIFICATION_FAILED');
    return {...receipt,artifact_root:'temporary isolated copy (removed after verification)'};
  }finally{await rm(temporary,{recursive:true,force:true});}
}
export async function buildLambda({functionName,artifactsDir,mode='host',install=false}){
  assertBuildPlatform(mode);
  if(!functions[functionName])throw new Error('UNKNOWN_LAMBDA_FUNCTION');
  if(install){
    if(mode!=='lambda')throw new Error('DEPENDENCY_INSTALL_ONLY_IN_LAMBDA_BUILD');
    // Runs only in the SAM Linux ARM64 build container. Lockfile, optional native packages, no install scripts.
    run('npm',['ci','--ignore-scripts','--include=optional','--no-audit','--no-fund']);
  }
  const {build}=await import('esbuild');
  const artifact=await emptyOwnedDirectory(artifactsDir),role=functions[functionName];
  const minimum=process.versions.node.split('.').map(Number);
  if(minimum[0]<22 || minimum[0]===22&&minimum[1]<13)throw new Error('PDF_RUNTIME_REQUIRES_NODE_22_13_OR_NEWER');
  const entry=`services/${role}/handler`;
  const banner=`import {createRequire as __tallyCreateRequire} from 'node:module';const require=__tallyCreateRequire(import.meta.url);if(process.platform!==${JSON.stringify(process.platform)}||process.arch!==${JSON.stringify(process.arch)})throw new Error('LAMBDA_ARTIFACT_PLATFORM_MISMATCH');${mode==='host'?"if(process.env.AWS_LAMBDA_FUNCTION_NAME)throw new Error('HOST_LAMBDA_ARTIFACT_NOT_DEPLOYABLE');":''}`;
  await build({absWorkingDir:root,entryPoints:{[entry]:`${entry}.ts`,'packaging/pdf-probe':'services/providers/pdf.ts','services/rules/rule-probe':'services/rules/rule-pack.ts'},bundle:true,platform:'node',target:'node22',format:'esm',outdir:artifact,outExtension:{'.js':'.mjs'},sourcemap:false,banner:{js:banner},external:['pdfjs-dist','@napi-rs/canvas']});
  const dependencies=['pdfjs-dist','@napi-rs/canvas',nativeName()];
  const versions={};
  for(const name of dependencies){
    const packageJson=require.resolve(`${name}/package.json`),source=dirname(packageJson),metadata=JSON.parse(await readFile(packageJson,'utf8'));
    versions[name]=metadata.version;
    await cp(source,join(artifact,'node_modules',name),{recursive:true,dereference:true});
  }
  const ruleResources=['rules/2025/us-federal-irc45r-2025-v1.json','rules/2025/sources/manifest.json'];
  for(const resource of ruleResources){await mkdir(dirname(join(artifact,resource)),{recursive:true});await cp(join(root,resource),join(artifact,resource));}
  await mkdir(join(artifact,'packaging/fixtures'),{recursive:true});
  for(const filename of ['initial-batch.pdf','coverage-statement.pdf'])await cp(join(root,'fixtures/interim',filename),join(artifact,'packaging/fixtures',filename));
  await cp(join(root,'scripts/verify-lambda-artifact.mjs'),join(artifact,'packaging/verify.mjs'));
  await cp(join(root,'tests/offline-guard.cjs'),join(artifact,'packaging/offline-guard.cjs'));
  const manifest={schema:'tally-lambda-artifact-v1',function_name:functionName,handler:`${entry}.handler`,platform:process.platform,architecture:process.arch,node_version:process.versions.node,deployable:mode==='lambda',build_mode:mode,dependency_versions:versions,native_package:nativeName(),resources:['pdfjs-dist/legacy/build/pdf.mjs','pdfjs-dist/legacy/build/pdf.worker.mjs','pdfjs-dist/cmaps','pdfjs-dist/standard_fonts','pdfjs-dist/wasm',...ruleResources],rule_resources:ruleResources,specification_status:'interim_reconstructed'};
  await writeFile(join(artifact,'package.json'),JSON.stringify({private:true,type:'module'},null,2));
  await writeFile(join(artifact,manifestName),JSON.stringify(manifest,null,2));
  const verification=await verifyIsolatedArtifact(artifact);
  await writeFile(join(artifact,'packaging/verification.json'),JSON.stringify(verification,null,2));
  return {function_name:functionName,artifact,deployable:manifest.deployable,platform:`${process.platform}/${process.arch}`,verification};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),functionName=args[0],mode=args.includes('--sam')?'lambda':'host';
  const index=args.indexOf('--artifacts-dir'),artifactsDir=index>=0?args[index+1]:process.env.ARTIFACTS_DIR;
  if(!artifactsDir||!isAbsolute(artifactsDir))throw new Error('ABSOLUTE_ARTIFACTS_DIR_REQUIRED');
  const receipt=await buildLambda({functionName,artifactsDir,mode,install:mode==='lambda'});
  console.log(JSON.stringify(receipt));
}
