/** Narrow English label/table verifier. Values originate in Box answers; evidence comes from local PDF text.
 * This is opt-in alternate provenance, never a reconstructed native Box citation or a general PDF parser. */
import type {Fact,SourceInput} from '../../packages/contracts/index.js';
import {parseBoxExtraction,type BoxMetadata} from './box.js';
import type {PdfSnapshot} from './pdf.js';
import {decimalCents,normalizeBoxSource} from './normalize-box.js';
import {ProviderGateError} from './gates.js';
type Layout='payment_payroll'|'coverage';
type Match={page:number;text:string;value:string|number;unit:'text'|'date'|'USD_cents'|'hours'};
const required={payment_payroll:['business_name','currency','payment_date','recorded_payment_amount','payroll_period_start','payroll_period_end','reported_gross_wages','reported_hours'],coverage:['business_name','currency','coverage_start','coverage_end','stated_total_premium','stated_employer_contribution','stated_employee_contribution']} as const;
const types:Record<string,string>={business_name:'business_name',currency:'currency',payment_date:'recorded_payment_date',recorded_payment_amount:'recorded_payment_amount',payroll_period_start:'payroll_period_start',payroll_period_end:'payroll_period_end',reported_gross_wages:'payroll_gross_wages',reported_hours:'payroll_total_hours',coverage_start:'coverage_start',coverage_end:'coverage_end',stated_total_premium:'stated_total_premium',stated_employer_contribution:'stated_employer_contribution',stated_employee_contribution:'stated_employee_contribution'};
function safeText(value:string,quote=false):boolean{
 if(value.length<1||value.length>(quote?2000:256)||(quote?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/:/[\u0000-\u001f\u007f-\u009f]/).test(value)||/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(value))return false;
 return !/(?:https?|file|s3):|www\.|\b(?:Bearer|access_token|client_secret|SecretString|X-Amz-)\b|(?:AKIA|ASIA)[A-Z0-9]{16}|ignore\s+(?:(?:all|previous|prior)\s+)*instructions|system\s+prompt|<\/?(?:system|assistant)>|\b(?:you are eligible|confirmed tax credit)\b/i.test(value);
}
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function money(text:string):number|null{return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/.test(text)?decimalCents(text.replaceAll(',','')):null;}
function detect(pages:string[]):Layout|null{
 const lines=pages.flatMap(p=>p.split(/\r?\n/).map(l=>l.trim()).filter(Boolean));
 const a=['Initial business records','Payment ledger excerpt','Partial payroll register','Payroll detail'].every(h=>lines.includes(h));
 const b=['Coverage statement','Stated monthly premium breakdown','Coverage period'].every(h=>lines.includes(h));
 return a===b?null:a?'payment_payroll':'coverage';
}
function labelled(pages:string[],layout:Layout):{matches:Record<string,Match[]>;blocked:Set<string>}{
 const result:Record<string,Match[]>={},blocked=new Set<string>();
 const block=(...keys:string[])=>keys.forEach(key=>blocked.add(key));
 const add=(key:string,value:Match['value'],unit:Match['unit'],page:number,text:string)=>{if(safeText(text,true))(result[key]??=[]).push({page,text,value,unit});};
 pages.forEach((pageText,pageIndex)=>{
  const page=pageIndex+1,lines=pageText.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const paymentHeader=lines.findIndex(l=>/^Date\s+Description\s+Category\s+Amount \(USD\)$/.test(l));
  const payrollHeader=lines.findIndex(l=>/^Worker\s+Hours\s+Wages \(USD\)$/.test(l));
  const premiumHeader=lines.findIndex(l=>/^Premium component\s+Amount \(USD\)$/.test(l));
  lines.forEach((line,index)=>{
   let match:RegExpExecArray|null;
   if((match=/^(.+?)\s+\|\s+(?:Historical demonstration:|Pay period:|Coverage:).+$/.exec(line))&&safeText(match[1]!.trim()))add('business_name',match[1]!.trim(),'text',page,line);
   const currencies=[...line.matchAll(/\bCurrency:\s*([A-Z]{3})\b/g)];
   const currencyLabels=[...line.matchAll(/\bCurrency:/g)].length;
   if(currencyLabels>1||currencyLabels!==currencies.length||currencies.length===1&&!/^Currency:\s*[A-Z]{3}\.(?:\s|$)/.test(line))block('currency');
   if(currencies.length===1&&(match=/^Currency:\s*([A-Z]{3})\.(?:\s|$)/.exec(line)))add('currency',match[1]!,'text',page,line);
   if(layout==='payment_payroll'){
    const inPayments=paymentHeader>=0&&lines.includes('Payment ledger excerpt')&&index>paymentHeader&&lines.slice(paymentHeader+1,index+1).every(l=>/^\d{4}-\d{2}-\d{2}\s+Health insurance payment\s+Insurance\s+\$[\d,]+(?:\.\d{2})?\s+USD$/.test(l));
    if(/\bHealth insurance payment\s+Insurance\b/.test(line)){
     match=/^(\d{4}-\d{2}-\d{2})\s+Health insurance payment\s+Insurance\s+\$([\d,]+(?:\.\d{2})?)\s+USD$/.exec(line);
     const amount=match?money(match[2]!):null;
     if(!inPayments||!match||!validDate(match[1]!)||amount===null)block('payment_date','recorded_payment_amount');
     else{add('payment_date',match[1]!,'date',page,line);add('recorded_payment_amount',amount,'USD_cents',page,line);}
    }
    if(/Payroll period (?:start|end):/.test(line)){
     match=/^Payroll period start:\s*(\d{4}-\d{2}-\d{2})\.\s+Payroll period end:\s*(\d{4}-\d{2}-\d{2})\.$/.exec(line);
     if(!match||!validDate(match[1]!)||!validDate(match[2]!)||match[1]!>match[2]!)block('payroll_period_start','payroll_period_end');
     else{add('payroll_period_start',match[1]!,'date',page,line);add('payroll_period_end',match[2]!,'date',page,line);}
    }
    const inPayroll=payrollHeader>=0&&lines.includes('Payroll detail')&&index>payrollHeader&&lines.slice(payrollHeader+1,index+1).every(l=>/^(?:Worker\s+\d+|Total)\s+\d+(?:\.\d{1,2})?\s+\$[\d,]+(?:\.\d{2})?\s+USD$/.test(l));
    if((payrollHeader>=0||lines.includes('Payroll detail'))&&/^Total\b/.test(line)){
     match=/^Total\s+(\d+(?:\.\d{1,2})?)\s+\$([\d,]+(?:\.\d{2})?)\s+USD$/.exec(line);
     const amount=match?money(match[2]!):null,hours=match?Number(match[1]):NaN;
     if(!inPayroll||!match||amount===null||!Number.isFinite(hours)||hours<0||hours>1_000_000)block('reported_hours','reported_gross_wages');
     else{add('reported_hours',hours,'hours',page,line);add('reported_gross_wages',amount,'USD_cents',page,line);}
    }
   }else{
    const starts=[...line.matchAll(/\bStart:/g)],ends=[...line.matchAll(/\bEnd:/g)];
    if(starts.length||ends.length){
     match=/^Start:\s*(\d{4}-\d{2}-\d{2})\.\s+End:\s*(\d{4}-\d{2}-\d{2})\.(?:\s|$)/.exec(line);
     if(!lines.includes('Coverage period')||starts.length!==1||ends.length!==1||!match||!validDate(match[1]!)||!validDate(match[2]!)||match[1]!>match[2]!)block('coverage_start','coverage_end');
     else{add('coverage_start',match[1]!,'date',page,line);add('coverage_end',match[2]!,'date',page,line);}
    }
    const premiumRow=/^(?:Total monthly premium|Stated employer contribution|Stated employee contribution)\s+\$[\d,]+(?:\.\d{2})?\s+USD$/;
    const inPremiums=premiumHeader>=0&&lines.includes('Stated monthly premium breakdown')&&index>premiumHeader&&lines.slice(premiumHeader+1,index+1).every(l=>premiumRow.test(l));
    for(const[key,label]of[['stated_total_premium','Total monthly premium'],['stated_employer_contribution','Stated employer contribution'],['stated_employee_contribution','Stated employee contribution']]as const){if(!line.startsWith(label))continue;const row=new RegExp('^'+label+'\\s+\\$([\\d,]+(?:\\.\\d{2})?)\\s+USD$').exec(line),amount=row?money(row[1]!):null;if(!inPremiums||!row||amount===null)block(key);else add(key,amount,'USD_cents',page,line);}
   }
  });
 });return {matches:result,blocked};
}
function period(fact:Fact,find:(type:string)=>Fact|undefined):void{
 const date=(type:string)=>{const f=find(type);return f?.verification_state==='source_supported'&&typeof f.value==='string'?f.value:null;};
 const range=fact.fact_type.startsWith('payroll_')?{start:date('payroll_period_start'),end:date('payroll_period_end')}:fact.fact_type.startsWith('coverage_')||fact.fact_type.startsWith('stated_')?{start:date('coverage_start'),end:date('coverage_end')}:fact.fact_type.startsWith('recorded_payment_')?{start:date('recorded_payment_date'),end:date('recorded_payment_date')}:{start:null,end:null};
 fact.relevant_period=range.start&&range.end&&range.start<=range.end?{...range,scope:range.start===range.end?'point_in_time':'partial_period'}:{start:null,end:null,scope:'unknown'};
 fact.as_of_date=fact.fact_type==='recorded_payment_date'?range.start:null;
}
/** Pure verifier: no clients, filesystem, credentials, writes, inference, native reference synthesis or annual conclusions. */
export function normalizeBoxSourceWithLocalText(input:unknown,metadata:BoxMetadata,pdf:PdfSnapshot):SourceInput{
 if(metadata.type!=='file'||!Number.isSafeInteger(metadata.size)||metadata.size<1||metadata.size>1_048_576||!Array.isArray(pdf.pages)||pdf.pages.some(p=>typeof p!=='string'||p.length>100_000))throw new ProviderGateError('BOX_LOCAL_PDF_CONTEXT_INVALID');
 if(!/^\d+$/.test(metadata.id)||!/^\d+$/.test(metadata.file_version.id)||!/^\d+$/.test(metadata.parent.id)||! /^[a-f0-9]{40}$/i.test(metadata.sha1)||metadata.sha1.toLowerCase()!==pdf.sha1)throw new ProviderGateError('BOX_LOCAL_PDF_CONTEXT_INVALID');
 const parsed=parseBoxExtraction(input);
 // Ignore native references here rather than converting local matches into Box reference objects.
 const source=normalizeBoxSource({answer:parsed.answer,confidence_score:parsed.confidence_score,completion_reason:parsed.completion_reason},metadata,pdf);
 const layout=detect(pdf.pages),evidence=layout?labelled(pdf.pages,layout):{matches:{},blocked:new Set<string>()},matches=evidence.matches;
 const accepted=new Map<string,Match>();
 if(layout)for(const key of required[layout]){
  const base=source.facts.find(f=>f.fact_type===types[key]),all=matches[key]??[],first=all[0];
  const unique=all.length>0&&new Set(all.map(m=>JSON.stringify([m.value,m.unit]))).size===1&&(['business_name','currency'].includes(key)||all.length===1);
  if(!base||!first||!unique||evidence.blocked.has(key))continue;
  const raw=Object.hasOwn(parsed.answer,key)?parsed.answer[key]:undefined;
  if(typeof raw==='string'&&!safeText(raw))continue;
  const value=first.unit==='USD_cents'?decimalCents(raw):base.value;
  if(value!==null&&value===first.value)accepted.set(key,first);
 }
 const usd=accepted.get('currency')?.value==='USD';
 for(const fact of source.facts){
  const key=Object.keys(types).find(key=>types[key]===fact.fact_type)??fact.fact_type,match=accepted.get(key);
  const moneyFact=fact.unit==='USD_cents',raw=Object.hasOwn(parsed.answer,key)?parsed.answer[key]:undefined;
  if(typeof raw==='string'&&!safeText(raw)){fact.value=null;fact.value_state='unknown';fact.verification_state='needs_review';continue;}
  if(match&&(!moneyFact||usd)){
   fact.value=match.value;fact.value_state='known';fact.verification_state='source_supported';
   fact.source={...fact.source,verification_method:'local_pdf_text_match',locator:{kind:'verified_page',page:match.page,row:null},excerpt:match.text,excerpt_validation:'matched'};
  }else if((layout&&required[layout].some(key=>types[key]===fact.fact_type))||(Object.hasOwn(parsed.answer,key)&&raw!==null&&raw!==''&&raw!==undefined)){
   fact.verification_state='needs_review';fact.source.excerpt_validation='unavailable';
  }
 }
 const find=(type:string)=>source.facts.find(f=>f.fact_type===type);
 source.facts.forEach(f=>period(f,find));
 const allRequired=layout&&required[layout].every(key=>find(types[key]!)?.verification_state==='source_supported');
 const extraKnown=source.facts.some(f=>f.verification_state==='needs_review');
 source.business_name=allRequired&&!extraKnown?String(find('business_name')!.value):null;
 return source;
}
