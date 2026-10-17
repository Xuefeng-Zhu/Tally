import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
export type PdfSnapshot={sha256:string;sha1:string;pageCount:number;pages:string[]};
export class PdfValidationError extends Error{constructor(public readonly code:string){super(code);this.name='PdfValidationError';}}
const MAX_BYTES=1_048_576,MAX_PAGES=2;
/** Controlled worker code only: PDF bytes never become JavaScript, URLs or rendering actions. */
const workerCode=String.raw`
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 let task;
 try{
  const pdfjs=await import(workerData.moduleUrl);
  pdfjs.GlobalWorkerOptions.workerSrc=workerData.workerUrl;
  task=pdfjs.getDocument({data:new Uint8Array(workerData.bytes),isEvalSupported:false,enableXfa:false,useWorkerFetch:false,useWasm:false,useSystemFonts:false,disableFontFace:true,disableAutoFetch:true,disableStream:true,disableRange:true,stopAtErrors:true,verbosity:0,maxImageSize:0,isOffscreenCanvasSupported:false,isImageDecoderSupported:false});
  const doc=await task.promise;
  if(await doc.getPermissions()!==null)throw {code:'PDF_ENCRYPTED'};
  if(!Number.isInteger(doc.numPages)||doc.numPages<1||doc.numPages>workerData.maxPages)throw {code:'PDF_PAGE_LIMIT'};
  const pages=[];
  for(let number=1;number<=doc.numPages;number++){
   const page=await doc.getPage(number),content=await page.getTextContent();
   let text='';
   for(const item of content.items){if(typeof item.str==='string')text+=item.str+(item.hasEOL?'\n':' ');if(text.length>100_000)throw {code:'PDF_TEXT_LIMIT'};}
   pages.push(text.trim());page.cleanup();
  }
  if(pages.every(text=>!text.trim()))throw {code:'PDF_EMPTY_TEXT'};
  parentPort.postMessage({ok:true,pageCount:doc.numPages,pages});
 }catch(error){parentPort.postMessage({ok:false,code:error?.name==='PasswordException'?'PDF_ENCRYPTED':typeof error?.code==='string'&&error.code.startsWith('PDF_')?error.code:'PDF_PARSE_FAILED'});}
 finally{if(task)await task.destroy().catch(()=>{});}
})();`;
export async function parsePdfBytes(data:Uint8Array,options:{maxBytes?:number;maxPages?:number;timeoutMs?:number}={}):Promise<PdfSnapshot>{
 const maxBytes=Math.min(options.maxBytes??MAX_BYTES,MAX_BYTES),maxPages=Math.min(options.maxPages??MAX_PAGES,MAX_PAGES);
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||data.byteLength<1||data.byteLength>maxBytes)throw new PdfValidationError('PDF_SIZE_LIMIT');
 if(!Number.isSafeInteger(maxPages)||maxPages<1)throw new PdfValidationError('PDF_PAGE_LIMIT');
 const bytes=Uint8Array.from(data);
 if(Buffer.from(bytes.subarray(0,8)).toString('ascii').slice(0,5)!=='%PDF-')throw new PdfValidationError('PDF_MAGIC');
 const sha256=createHash('sha256').update(bytes).digest('hex'),sha1=createHash('sha1').update(bytes).digest('hex');
 const require=createRequire(import.meta.url);
 const moduleUrl=pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
 const workerUrl=pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
 return new Promise((resolve,reject)=>{
  const worker=new Worker(workerCode,{eval:true,workerData:{bytes,moduleUrl,workerUrl,maxPages},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
  let settled=false;
  const finish=(error:Error|null,result?:PdfSnapshot)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(result!);};
  const timer=setTimeout(()=>finish(new PdfValidationError('PDF_TIMEOUT')),Math.min(Math.max(options.timeoutMs??20_000,1),20_000));
  worker.once('error',()=>finish(new PdfValidationError('PDF_PARSE_FAILED')));
  worker.once('exit',()=>{if(!settled)finish(new PdfValidationError('PDF_PARSE_FAILED'));});
  worker.once('message',(message:unknown)=>{const v=message as {ok?:boolean;code?:string;pageCount?:number;pages?:string[]};if(!v.ok||!Array.isArray(v.pages)||typeof v.pageCount!=='number')finish(new PdfValidationError(v.code??'PDF_PARSE_FAILED'));else finish(null,{sha256,sha1,pageCount:v.pageCount,pages:v.pages});});
 });
}
