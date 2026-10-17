import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TallyEngine} from '../../services/worker/core.js';
import {FileStore} from '../../services/storage/file-store.js';
import {createApi} from '../../services/api/app.js';
import {readConfiguration} from '../../packages/contracts/configuration.js';
import {createAwsForwarder} from './signed-upstream.js';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function startServer(options:{port?:number;dataPath?:string}={}) {
 const config=readConfiguration();
 const forward=config.mode==='aws'?createAwsForwarder({apiOrigin:config.apiOrigin??'',approvedLiveFlow:process.env.TALLY_APPROVED_LIVE_FLOW==='true'}):null;
 const store=new FileStore(options.dataPath??process.env.TALLY_DATA_PATH??resolve(ROOT,'.data/state.json'));
 const engine=new TallyEngine(store);
 let scheduled=false,working=false;
 async function drain(){if(working)return;working=true;try{await engine.processAll();}catch{console.error('Fixture worker failed. Pending state is retained; use Reconcile.');}finally{working=false;}}
 const enqueue=async()=>{if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;void drain();},20);}};
 const api=createApi({engine,enqueue,webhook:process.env.BOX_WEBHOOK_PRIMARY_KEY&&process.env.BOX_WEBHOOK_ID?{primaryKey:process.env.BOX_WEBHOOK_PRIMARY_KEY,secondaryKey:process.env.BOX_WEBHOOK_SECONDARY_KEY,webhookId:process.env.BOX_WEBHOOK_ID,folderId:process.env.BOX_INPUT_FOLDER_ID??'fixture-inbox'}:undefined});
 const server=http.createServer(async(req,res)=>{
  const address=server.address();const port=typeof address==='object'&&address?address.port:4318;
  const allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
  const origin=req.headers.origin;
  if(!allowedHosts.includes(req.headers.host??'') || (origin && !['http://127.0.0.1:5173','http://localhost:5173',`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin))){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'FORBIDDEN_ORIGIN',message:'Only the local Tally app may access this server.',retryable:false,correlation_id:'local-boundary'}));return;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,PUT,POST','Access-Control-Allow-Headers':'content-type'});res.end();return;}
  let url:URL;try{url=new URL(req.url??'/',`http://127.0.0.1:${port}`);}catch{res.writeHead(400);res.end();return;}
  if(url.search){res.writeHead(422,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'INVALID_REQUEST',message:'Selectors are not accepted.',correlation_id:'local-boundary',retryable:false}));return;}
  const pdfNames:Record<string,string>={'/fixtures/initial-batch.pdf':'initial-batch.pdf','/fixtures/coverage-statement.pdf':'coverage-statement.pdf'};
  if(req.method==='GET' && pdfNames[url.pathname]){
   const name=pdfNames[url.pathname];let data:Buffer|undefined;
   for(const candidate of [resolve(ROOT,'tally-handoff/fixtures',name),resolve(ROOT,'tally-handoff',name),resolve(ROOT,'fixtures/interim',name)]){try{data=await readFile(candidate);break;}catch{}}
   if(!data){res.writeHead(404);res.end('Fixture PDF unavailable');return;}res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${name}"`});res.end(data);return;
  }
  const chunks:Buffer[]=[];let size=0;
  try{for await(const chunk of req){size+=chunk.length;if(size>32768){res.writeHead(413);res.end();req.destroy();return;}chunks.push(Buffer.from(chunk));}}catch{return;}
  const headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v]));
  let result:{status:number;body:unknown};
  try{result=forward?await forward(req.method??'GET',url.pathname,Buffer.concat(chunks).toString('utf8')):await api({method:req.method??'GET',path:url.pathname,headers,rawBody:Buffer.concat(chunks)});}
  catch{result={status:503,body:{code:'UPSTREAM_UNAVAILABLE',message:'The approved AWS application flow is unavailable.',correlation_id:'local-upstream',retryable:true}};}
  res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));
 });
 await new Promise<void>((ok,reject)=>{server.once('error',reject);server.listen(options.port??Number(process.env.TALLY_LOCAL_PORT??4318),'127.0.0.1',ok);});
 const address=server.address();const port=typeof address==='object'&&address?address.port:4318;
 // Resume persisted queue jobs after a restart, without a provider call.
 if(!forward)await enqueue();
 return {server,engine,url:`http://127.0.0.1:${port}`,close:()=>new Promise<void>((ok,reject)=>server.close(e=>e?reject(e):ok()))};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {url}=await startServer();console.log(`Tally fixture API: ${url}`);}
