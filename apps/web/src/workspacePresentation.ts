import type { Document, Fact, Job, State } from '../../../packages/contracts';
import { resolveEvidenceSource } from './EvidencePanel';
export type InboxFilter='all'|'attention'|'ready';
export type InboxGroup='attention'|'processing'|'ready';
export type InboxEntry={key:string;fileId:string;document:Document|null;job:Job|null;name:string;type:string;period:string;group:InboxGroup;status:string;facts:Fact[]};
const processing=new Set<Job['status']>(['queued','extracting','validating','ledger_committed','evaluating']);
const attention=new Set<Job['status']>(['failed','needs_review']);
const factLabels:Record<string,string>={recorded_payment_amount:'Recorded insurance payment',recorded_payment_date:'Recorded payment date',payroll_total_hours:'Recorded payroll hours',payroll_gross_wages:'Partial payroll wages',payroll_worker_count:'Recorded workers',coverage_start:'Coverage begins',coverage_end:'Coverage ends',stated_total_premium:'Stated total premium',stated_employer_contribution:'Stated employer contribution',stated_employee_contribution:'Stated employee contribution',reported_employer_share_basis_points:'Stated employer share'};
export const titleCase=(value:string)=>value.replaceAll('_',' ').replace(/^./,initial=>initial.toUpperCase());
export const factTitle=(fact:Fact)=>factLabels[fact.fact_type]??titleCase(fact.fact_type);
export function safeErrorCode(value:string|null|undefined,fallback='DOCUMENT_REVIEW_REQUIRED'):string{return value&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value)?value:fallback;}
export function formatRecordDate(value:string|null):string {
  if(!value || !/^\d{4}-\d{2}-\d{2}$/.test(value))return 'Date not established';
  const date=new Date(`${value}T00:00:00Z`);if(Number.isNaN(date.getTime()))return 'Date not established';
  return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);
}
export function factDisplayValue(fact:Fact):string{
  if(fact.value_state==='unknown'||fact.value===null)return 'Not established';
  if(fact.value_state==='conflicting')return 'Needs review';
  if(fact.unit==='USD_cents'&&typeof fact.value==='number')return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(fact.value/100);
  if(fact.unit==='basis_points'&&typeof fact.value==='number')return `${fact.value/100}%`;
  if(fact.unit==='hours')return `${fact.value} hours`;
  if(fact.unit==='date')return formatRecordDate(String(fact.value));
  if(typeof fact.value==='boolean')return fact.value?'Yes':'No';
  return String(fact.value);
}
export function safeDocumentUrl(value:string|null|undefined):string|null{
  if(!value)return null;
  if(/^\/fixtures\/[a-zA-Z0-9._-]+\.pdf$/.test(value))return value;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function documentFacts(state:State,document:Document):Fact[]{return state.facts.filter(fact=>fact.source.file_id===document.file_id || fact.source.sha256===document.sha256);}
export function partitionDocumentFacts(state:State,document:Document):{current:Fact[];earlier:Fact[]}{
  const facts=documentFacts(state,document);
  const isCurrent=(fact:Fact)=>fact.source.sha256===document.sha256&&fact.verification_state!=='superseded';
  return {current:facts.filter(isCurrent),earlier:facts.filter(fact=>!isCurrent(fact))};
}
export function currentDocumentFacts(state:State,document:Document):Fact[]{return documentFacts(state,document).filter(fact=>fact.verification_state==='source_supported'&&fact.value_state==='known'&&fact.source.excerpt_validation==='matched'&&fact.source.sha256===document.sha256&&resolveEvidenceSource(state.documents,fact)!==undefined);}
function currentJob(state:State,document:Document):Job|null{
  const jobs=state.jobs.map((job,index)=>({job,index})).filter(({job})=>job.kind==='INGEST'&&job.file_id===document.file_id);
  const successIndex=jobs.filter(({job})=>job.file_version_id===document.file_version_id&&job.committed&&job.status==='completed').at(-1)?.index??-1;
  return jobs.filter(({job,index})=>{
    if(job.committed||job.status==='completed')return false;
    if(job.file_version_id!==null&&job.file_version_id!==document.file_version_id)return false;
    if(document.status==='completed'&&document.accepted_version===document.file_version_id){
      // A successful current version outranks historical failed attempts and intake stubs.
      if(attention.has(job.status))return successIndex>=0&&index>successIndex;
      if(job.file_version_id===null)return successIndex>=0&&index>successIndex;
    }
    return true;
  }).at(-1)?.job??null;
}
function documentType(facts:Fact[]):string{
  const types=facts.map(fact=>fact.fact_type),payment=types.some(type=>type.includes('payment')),payroll=types.some(type=>type.startsWith('payroll_')),coverage=types.some(type=>type.startsWith('coverage_')||type.startsWith('stated_'));
  return payment&&payroll?'Payment & payroll':coverage?'Coverage statement':payroll?'Payroll record':payment?'Payment record':'PDF document';
}
function periodLabel(facts:Fact[]):string{
  const starts=facts.flatMap(fact=>fact.relevant_period.start?[fact.relevant_period.start]:[]).sort(),ends=facts.flatMap(fact=>fact.relevant_period.end?[fact.relevant_period.end]:[]).sort();
  if(!starts.length||!ends.length)return 'Period not established';
  const first=starts[0],last=ends.at(-1)!;
  if(first===last)return formatRecordDate(first);
  return `${formatRecordDate(first)} – ${formatRecordDate(last)}`;
}
function statusLabel(status:Document['status'],retrying:boolean):string{
  if(retrying&&status==='queued')return 'Waiting to retry';
  return {queued:'Waiting to process',extracting:'Reading document',validating:'Checking the record',ledger_committed:'Information saved',evaluating:'Updating next steps',completed:'Ready to review',needs_review:'Needs attention',failed:'Could not process'}[status];
}
export function inboxEntries(state:State):InboxEntry[]{
  const entries:InboxEntry[]=state.documents.map(document=>{
    const facts=currentDocumentFacts(state,document),job=currentJob(state,document),status=job?.status??document.status;
    const reviewFacts=documentFacts(state,document).some(fact=>fact.source.sha256===document.sha256&&!['superseded','derived'].includes(fact.verification_state)&&['candidate','needs_review'].includes(fact.verification_state));
    const group:InboxGroup=attention.has(status)||Boolean(document.error)||Boolean(job?.error)||reviewFacts?'attention':processing.has(status)?'processing':'ready';
    return {key:document.file_id,fileId:document.file_id,document,job,name:document.name,type:documentType(facts),period:periodLabel(facts),group,status:reviewFacts&&status==='completed'?'Needs attention':statusLabel(status,Boolean(job?.error||document.error)),facts};
  });
  const missing=new Map<string,Job>();
  for(const job of state.jobs)if(job.kind==='INGEST'&&job.file_id!==null&&!job.committed&&job.status!=='completed'&&!state.documents.some(document=>document.file_id===job.file_id))missing.set(job.file_id,job);
  for(const [fileId,job]of missing)entries.push({key:`intake:${fileId}`,fileId,document:null,job,name:attention.has(job.status)?'Document needs attention':'Document awaiting processing',type:'Connected inbox',period:'Details available after processing',group:attention.has(job.status)||Boolean(job.error)?'attention':'processing',status:statusLabel(job.status,Boolean(job.error)),facts:[]});
  return entries;
}
export function filterInbox(entries:InboxEntry[],query:string,filter:InboxFilter):InboxEntry[]{
  const search=query.trim().toLocaleLowerCase();return entries.filter(entry=>(filter==='all'||entry.group===filter)&&(!search||`${entry.name} ${entry.type} ${entry.period}`.toLocaleLowerCase().includes(search)));
}
export function assessmentUpdatePending(state:State):boolean{
  const current=state.opportunity?.ledger_rev===state.ledger_rev&&state.opportunity?.profile_rev===state.profile_rev;
  return Boolean(state.pending_evaluation || (state.opportunity&&!current));
}
