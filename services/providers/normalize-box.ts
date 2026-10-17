/** Box documented scalar references; actual provider response/fixture parity still require P01. */
import { CONTEXT, type Fact, type SourceInput } from '../../packages/contracts/index.js';
import { BoxAdapter, parseBoxExtraction, sameBoxVersion, type BoxMetadata } from './box.js';
import { ProviderGateError } from './gates.js';
import type { PdfSnapshot } from './pdf.js';
export type BoxSourceNormalizer=(input:unknown,metadata:BoxMetadata,pdf:PdfSnapshot)=>SourceInput;
export type BoxSourceProviderOptions={normalize?:BoxSourceNormalizer};
export type PreparedBoxSource={metadata:BoxMetadata;pdf:PdfSnapshot;observation:SourceInput};
export class BoxSourceChangedError extends ProviderGateError{
 constructor(public readonly latestMetadata:BoxMetadata,public readonly currentObservation?:SourceInput){super('BOX_SOURCE_CHANGED');this.name='BoxSourceChangedError';}
}
function observation(metadata:BoxMetadata,pdf:PdfSnapshot):SourceInput{return {business_name:null,file_id:metadata.id,file_version_id:metadata.file_version.id,name:metadata.name,sha256:pdf.sha256,folder_id:metadata.parent.id,source_url:`https://app.box.com/file/${metadata.id}`,facts:[]};}
export function preparedSourceObservation(prepared:PreparedBoxSource):SourceInput{return structuredClone(prepared.observation);}
async function changed(adapter:BoxAdapter,latest:BoxMetadata):Promise<never>{let current:SourceInput|undefined;try{current=(await prepareBoxSource(adapter,latest.id)).observation;}catch{}throw new BoxSourceChangedError(latest,current);}
export async function prepareBoxSource(adapter:BoxAdapter,fileId:string):Promise<PreparedBoxSource>{
 const metadata=await adapter.metadata(fileId),pdf=await adapter.downloadVersion(metadata),after=await adapter.metadata(fileId);
 if(!sameBoxVersion(metadata,after))throw new BoxSourceChangedError(after);
 return {metadata,pdf,observation:observation(metadata,pdf)};
}
export async function extractPreparedSource(adapter:BoxAdapter,prepared:PreparedBoxSource,options:BoxSourceProviderOptions={}):Promise<SourceInput>{
 const before=await adapter.metadata(prepared.metadata.id);
 if(!sameBoxVersion(prepared.metadata,before))return changed(adapter,before);
 const raw=await adapter.extractFields(before.id),after=await adapter.metadata(before.id);
 if(!sameBoxVersion(before,after))return changed(adapter,after);
 return (options.normalize??normalizeBoxSource)(raw,prepared.metadata,prepared.pdf);
}
/** Cache parsed snapshots only within a worker instance, at most eight bounded documents. */
export function createBoxSourceProvider(adapter:BoxAdapter,options:BoxSourceProviderOptions={}){
 const cache=new Map<string,PreparedBoxSource>();const key=(source:SourceInput)=>`${source.file_id}:${source.file_version_id}:${source.sha256}`;
 return {prepare:async(fileId:string)=>{const prepared=await prepareBoxSource(adapter,fileId);cache.set(key(prepared.observation),prepared);while(cache.size>8)cache.delete(cache.keys().next().value!);return structuredClone(prepared.observation);},extract:async(source:SourceInput)=>{let prepared=cache.get(key(source));if(!prepared){prepared=await prepareBoxSource(adapter,source.file_id);if(key(prepared.observation)!==key(source))throw new BoxSourceChangedError(prepared.metadata,prepared.observation);}try{return await extractPreparedSource(adapter,prepared,options);}finally{cache.delete(key(source));}}};
}
const fields:Record<string,{type:string;unit:Fact['unit'];kind:'money'|'date'|'number'|'text'}>={
 document_type:{type:'document_type',unit:'text',kind:'text'},business_name:{type:'business_name',unit:'text',kind:'text'},insurer_name:{type:'insurer_name',unit:'text',kind:'text'},payment_reference:{type:'payment_reference',unit:'text',kind:'text'},payment_date:{type:'recorded_payment_date',unit:'date',kind:'date'},recorded_payment_amount:{type:'recorded_payment_amount',unit:'USD_cents',kind:'money'},currency:{type:'currency',unit:'text',kind:'text'},payroll_period_start:{type:'payroll_period_start',unit:'date',kind:'date'},payroll_period_end:{type:'payroll_period_end',unit:'date',kind:'date'},reported_gross_wages:{type:'payroll_gross_wages',unit:'USD_cents',kind:'money'},reported_hours:{type:'payroll_total_hours',unit:'hours',kind:'number'},coverage_start:{type:'coverage_start',unit:'date',kind:'date'},coverage_end:{type:'coverage_end',unit:'date',kind:'date'},stated_total_premium:{type:'stated_total_premium',unit:'USD_cents',kind:'money'},stated_employer_contribution:{type:'stated_employer_contribution',unit:'USD_cents',kind:'money'},stated_employee_contribution:{type:'stated_employee_contribution',unit:'USD_cents',kind:'money'},invoice_reference:{type:'invoice_reference',unit:'text',kind:'text'},policy_reference:{type:'policy_reference',unit:'text',kind:'text'}
};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
const injection=(value:string)=>/(?:ignore\s+(?:(?:all|previous|prior)\s+)*instructions|system\s+prompt|<\/?(?:system|assistant)>|\b(?:you are eligible|confirmed tax credit)\b)/i.test(value);
function date(value:unknown):string|null{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value?value:null;}
export function decimalCents(value:unknown):number|null{
 if(typeof value!=='string'&&typeof value!=='number')return null;const text=String(value);
 if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text))return null;
 const [whole,fraction='']=text.split('.'),cents=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));
 return cents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cents):null;
}
function scalar(value:unknown,kind:string):Fact['value']{
 if(value===undefined||value===null||value==='')return null;
 if(kind==='date')return date(value);
 if(kind==='money')return decimalCents(value);
 if(kind==='number'){if((typeof value!=='number'&&typeof value!=='string')||!/^\d+(?:\.\d{1,2})?$/.test(String(value)))return null;const num=Number(value);return Number.isFinite(num)&&num>=0&&num<=1_000_000?num:null;}
 return typeof value==='string'&&value.trim().length>0&&value.length<=256&&!injection(value)?value.trim():null;
}
function corresponds(excerpt:string,value:Fact['value'],kind:string):boolean{
 if(value===null)return false;const text=normalized(excerpt);
 if(kind==='text'){const escaped=String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`,'u').test(text);}
 if(kind==='date'){
  const iso=String(value);if(text.includes(iso))return true;
  const d=new Date(iso+'T00:00:00Z'),months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return [months[d.getUTCMonth()],months[d.getUTCMonth()]!.slice(0,3)].some(month=>new RegExp(`\\b${month}\\s+${d.getUTCDate()},?\\s+${d.getUTCFullYear()}\\b`,'i').test(text));
 }
 if((kind==='money'||kind==='number')&&/(?:(?:^|[\s:(])[-−]\s*\$?\s*\d|\$\s*[-−]\s*\d|\(\s*\$?\s*\d)/.test(text))return false;
 const amount=kind==='money'?Number(value)/100:Number(value);
 const tokens=text.match(/\b\d[\d,]*(?:\.\d+)?\b/g)??[];
 return tokens.some(token=>/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(token)&&Number(token.replaceAll(',',''))===amount);
}
type Proof={locator:Fact['source']['locator'];excerpt:string|null;validation:Fact['source']['excerpt_validation'];supported:boolean;bad:boolean};
function proof(reference:unknown,pdf:PdfSnapshot,value:Fact['value'],kind:string,fileId:string):Proof{
 const absent={locator:{kind:'file_only' as const,page:null,row:null},excerpt:null,validation:'unavailable' as const,supported:false,bad:false};
 if(reference===undefined||reference===null)return absent;
 const bad=(excerpt:string|null=null):Proof=>({locator:{kind:'locator_unavailable',page:null,row:null},excerpt,validation:'failed',supported:false,bad:true});
 if(!Array.isArray(reference)||reference.length<1||reference.length>8)return bad();
 const checked:{page:number;text:string}[]=[];
 for(const ref of reference){
  // Box's response dictionaries are open: ignore extra metadata, but never infer missing core fields.
  if(!record(ref)||!['item_id','page','text'].every(key=>Object.hasOwn(ref,key))||ref.item_id!==fileId||!Number.isInteger(ref.page)||Number(ref.page)<0||Number(ref.page)>=pdf.pageCount||typeof ref.text!=='string'||ref.text.length<1||ref.text.length>2000)return bad();
  if(ref.bounding_box!==undefined&&ref.bounding_box!==null){
   const box=ref.bounding_box;
   if(!record(box)||Object.keys(box).length!==4||!['left','top','right','bottom'].every(key=>typeof box[key]==='number'&&Number.isFinite(box[key])&&Number(box[key])>=0&&Number(box[key])<=1)||Number(box.left)>=Number(box.right)||Number(box.top)>=Number(box.bottom))return bad();
  }
  checked.push({page:Number(ref.page),text:ref.text});
 }
 for(const ref of checked){
  if(!normalized(ref.text)||injection(ref.text)||!normalized(pdf.pages[ref.page]??'').includes(normalized(ref.text))||!corresponds(ref.text,value,kind))continue;
  return {locator:{kind:'verified_page',page:ref.page+1,row:null},excerpt:ref.text,validation:'matched',supported:true,bad:false};
 }
 return bad(checked[0]?.text??null);
}
export function normalizeBoxSource(input:unknown,metadata:BoxMetadata,pdf:PdfSnapshot,options:{now?:()=>string}={}):SourceInput{
 if(!/^[a-f0-9]{64}$/.test(pdf.sha256)||pdf.pageCount<1||pdf.pageCount>2||pdf.pages.length!==pdf.pageCount)throw new ProviderGateError('BOX_PDF_SNAPSHOT_INVALID');
 const extraction=parseBoxExtraction(input);
 if(extraction.completion_reason!==null&&extraction.completion_reason!=='done')throw new ProviderGateError('BOX_EXTRACTION_INCOMPLETE');
 const source=observation(metadata,pdf),facts:Fact[]=[],now=(options.now??(()=>new Date().toISOString()))();
 for(const [key,spec]of Object.entries(fields)){
  const raw=extraction.answer[key],value=scalar(raw,spec.kind),evidence=proof(extraction.reference[key],pdf,value,spec.kind,metadata.id);
  const absent=raw===undefined||raw===null||raw==='';
  const rawConfidence=extraction.confidence_score[key],numericConfidence=record(rawConfidence)?rawConfidence.number:rawConfidence,confidence=typeof numericConfidence==='number'&&Number.isFinite(numericConfidence)&&numericConfidence>=0&&numericConfidence<=1?numericConfidence:null;
  facts.push({fact_id:`box:${metadata.id}:${metadata.file_version.id}:${pdf.sha256}:${spec.type}`,business_id:CONTEXT.business_id,fact_type:spec.type,value_state:value===null?'unknown':'known',value,unit:spec.unit,relevant_period:{start:null,end:null,scope:'unknown'},as_of_date:null,source:{kind:'box_document',file_id:metadata.id,file_version_id:metadata.file_version.id,sha256:pdf.sha256,locator:evidence.locator,excerpt:evidence.excerpt,excerpt_validation:evidence.validation,owner_confirmation:null,input_fact_ids:[]},verification_state:!absent&&value===null||evidence.bad?'needs_review':evidence.supported&&value!==null?'source_supported':'candidate',extraction_schema_version:CONTEXT.extraction_schema_version,extracted_at:now,raw_provider_confidence:confidence,supersedes_fact_id:null,calculation_version:null});
 }
 const find=(type:string)=>facts.find(fact=>fact.fact_type===type)!;
 const supportedDate=(type:string)=>{const fact=find(type);return fact.verification_state==='source_supported'&&typeof fact.value==='string'?fact.value:null;};
 const currency=find('currency'),usd=currency.value==='USD'&&currency.verification_state==='source_supported';
 for(const [key,spec]of Object.entries(fields))if(spec.kind==='money'&&!usd){const fact=find(spec.type);fact.value=null;fact.value_state='unknown';if(extraction.answer[key]!==undefined&&extraction.answer[key]!==null&&extraction.answer[key]!=='')fact.verification_state='needs_review';}
 const coverage={start:supportedDate('coverage_start'),end:supportedDate('coverage_end')},payroll={start:supportedDate('payroll_period_start'),end:supportedDate('payroll_period_end')},payment=supportedDate('recorded_payment_date');
 for(const fact of facts){
  const period=fact.fact_type.startsWith('payroll_')?payroll:fact.fact_type.startsWith('coverage_')||fact.fact_type.startsWith('stated_')?coverage:fact.fact_type.startsWith('recorded_payment_')?{start:payment,end:payment}:{start:null,end:null};
  if(period.start&&period.end&&period.start<=period.end)fact.relevant_period={...period,scope:period.start===period.end?'point_in_time':'partial_period'};
  else if(period.start&&period.end&&period.start>period.end){fact.verification_state='needs_review';fact.value_state='conflicting';}
  if(fact.fact_type==='recorded_payment_date')fact.as_of_date=payment;
 }
 const name=find('business_name');source.business_name=name.verification_state==='source_supported'?String(name.value):null;
 return {...source,facts};
}
