/** Offline capture projection only. No clients, credentials, logging, writes, or network. */
import {BOX_EXTRACTION_FIELDS,parseBoxExtraction,type BoxExtraction} from '../services/providers/box.js';
import type {PdfSnapshot} from '../services/providers/pdf.js';

type Container='answer'|'reference'|'confidence_score';
export type CaptureRedaction={field:string;container:Container;reason:string;observed_type:string};
type RecordValue=Record<string,unknown>;
const record=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
const typeOf=(value:unknown)=>value===null?'null':Array.isArray(value)?'array':typeof value;
function textRejection(value:string,quote=false):string|null{
 // CR/LF/tab are ordinary quote whitespace. Other controls must not be normalized away.
 if((quote?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/:/[\u0000-\u001f\u007f-\u009f]/).test(value))return 'unsupported_control_character';
 if(/(?:https?|file|s3):|www\./i.test(value))return 'contains_url';
 if(/\b(?:Bearer|AKIA|ASIA|access_token|client_secret|SecretString|X-Amz-)\b/i.test(value))return 'contains_secret_marker';
 if(/(?:ignore\s+(?:(?:all|previous|prior)\s+)*instructions|system\s+prompt|<\/?(?:system|assistant)>|\b(?:you are eligible|confirmed tax credit)\b)/i.test(value))return 'contains_instruction';
 return null;
}
function referenceRejection(value:unknown,pdf:PdfSnapshot,fileId:string):string|null{
 if(!Array.isArray(value))return 'reference_not_array';
 if(value.length<1||value.length>8)return 'reference_count_out_of_bounds';
 for(const ref of value){
  if(!record(ref))return 'reference_item_not_object';
  if(Object.keys(ref).some(key=>!['item_id','page','text','bounding_box'].includes(key)))return 'reference_unexpected_keys';
  if(ref.item_id!==fileId)return 'reference_file_mismatch';
  if(!Number.isInteger(ref.page)||Number(ref.page)<0||Number(ref.page)>=pdf.pageCount)return 'reference_page_out_of_bounds';
  if(typeof ref.text!=='string')return 'reference_text_not_string';
  if(ref.text.length<1||ref.text.length>2000||!normalized(ref.text))return 'reference_text_length_out_of_bounds';
  const unsafe=textRejection(ref.text,true);if(unsafe)return unsafe;
  if(!normalized(pdf.pages[Number(ref.page)]??'').includes(normalized(ref.text)))return 'reference_excerpt_not_in_source';
  if(ref.bounding_box!==undefined&&ref.bounding_box!==null){
   const b=ref.bounding_box;
   if(!record(b)||Object.keys(b).length!==4||!['left','top','right','bottom'].every(key=>typeof b[key]==='number'&&Number.isFinite(b[key])&&Number(b[key])>=0&&Number(b[key])<=1)||Number(b.left)>=Number(b.right)||Number(b.top)>=Number(b.bottom))return 'reference_bounding_box_invalid';
  }
 }
 return null;
}
/** Retain approved synthetic scalars and exact source-bound quotes; never promote evidence here. */
export function projectBoxExtractionForCapture(input:unknown,pdf:PdfSnapshot,fileId:string):{response:BoxExtraction;redactions:CaptureRedaction[]}{
 const parsed=parseBoxExtraction(input),answer:RecordValue={},reference:RecordValue={},confidence_score:RecordValue={},redactions:CaptureRedaction[]=[];
 const allText=normalized(pdf.pages.join(' '));
 const redact=(field:string,container:Container,reason:string,value:unknown)=>redactions.push({field,container,reason,observed_type:typeOf(value)});
 for(const field of BOX_EXTRACTION_FIELDS){
  const key=field.key,value=parsed.answer[key];
  if(value!==undefined){
   const empty=value===null||value==='';
   const safeNumber=field.type==='float'&&typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e12;
   const unsafe=typeof value==='string'?textRejection(value):null;
   const safeString=typeof value==='string'&&value.length<=256&&!unsafe&&(value===''||field.type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(value)||field.type==='float'&&/^\d{1,12}(?:\.\d{1,2})?$/.test(value)||key==='currency'&&/^[A-Z]{3}$/.test(value)||allText.includes(normalized(value)));
   answer[key]=empty||safeNumber||safeString?value:null;
   if(!empty&&!safeNumber&&!safeString)redact(key,'answer',unsafe??'answer_not_safe_synthetic_scalar',value);
  }
  const refs=parsed.reference[key];
  if(refs!==undefined){
   const rejected=referenceRejection(refs,pdf,fileId);
   // All fields of a retained reference have been validated; no unknown keys cross the boundary.
   reference[key]=rejected?[]:(refs as RecordValue[]).map(ref=>({item_id:ref.item_id,page:ref.page,text:ref.text,...(ref.bounding_box!==undefined?{bounding_box:ref.bounding_box}: {})}));
   if(rejected)redact(key,'reference',rejected,refs);
  }
  const raw=parsed.confidence_score[key],number=record(raw)?raw.number:raw;
  if(raw!==undefined){
   const valid=typeof number==='number'&&Number.isFinite(number)&&number>=0&&number<=1;
   confidence_score[key]=valid?number:null;
   if(!valid)redact(key,'confidence_score','confidence_not_numeric_unit_interval',raw);
  }
 }
 return {response:{answer,reference,confidence_score,completion_reason:parsed.completion_reason==='done'?'done':null},redactions};
}
