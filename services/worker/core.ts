import { createHash } from 'node:crypto';
import { ANNUAL_IDS, CONTEXT, type Check, type Explanation, type Fact, type Job, type Opportunity, type Profile, type SourceInput, type State } from '../../packages/contracts/index.js';
import { fixtureSource } from '../../fixtures/sources.js';
import { validateExplanation, type ExplanationReceipt } from '../providers/explanation.js';
import type { Store } from '../storage/store.js';
export { FileStore, MemoryStore, type Store } from '../storage/store.js';

export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400, readonly retryable = false, readonly profile_saved?: boolean) { super(message); this.name = 'DomainError'; }
}
export type EvaluationSnapshot = { state: State; ledger_rev: number; profile_rev: number; rule_set_id: string; card_revision: number; evaluation_key: string };
export type EngineOptions = {
  now?: () => string;
  resolveSource?: (fileId: string) => SourceInput | Promise<SourceInput>;
  /** Called only after the durable INGEST lease is won; preparation must never call AI. */
  extractSource?: (observation: SourceInput) => Promise<SourceInput>;
  maxIngestAttempts?: number;
  intakeMode?: 'fixture'|'manual'|'webhook';
  explain?: (opportunity: Opportunity, facts: Fact[]) => Promise<Explanation | ExplanationReceipt>;
  afterLedgerCommit?: (state:State) => Promise<void>;
  uploadUrl?: string | null;
  extractionMode?: 'fixture' | 'live_box_ai';
};
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const currentKey = (state: State) => `${state.ledger_rev}:${state.profile_rev}:${CONTEXT.rule_set_id}`;
const opportunityFactTypes = new Set(['recorded_payment_amount','recorded_payment_date','payroll_total_hours','payroll_gross_wages','coverage_start','coverage_end','stated_total_premium','stated_employer_contribution','stated_employee_contribution']);
const activeStates = new Set(['ledger_committed','evaluating','completed']);
function validDocumentForFact(state: State, fact: Fact): boolean {
  // An unchanged alias remains a valid reference to a canonical fact set if its first source changes.
  return state.documents.some(doc => doc.sha256 === fact.source.sha256 && doc.accepted_version !== null && ((doc.accepted_version === doc.file_version_id && activeStates.has(doc.status)) || (doc.accepted_version === fact.source.file_version_id && ['queued','extracting','validating'].includes(doc.status))));
}
function usable(state: State): Fact[] {
  return state.facts.filter(fact => {
    if (fact.business_id !== CONTEXT.business_id || fact.value_state !== 'known') return false;
    if (fact.verification_state === 'owner_confirmed') return fact.source.kind === 'owner_provided' && fact.source.owner_confirmation !== null;
    if (fact.verification_state === 'derived') return fact.source.kind === 'deterministic_derivation' && fact.source.input_fact_ids.length > 0 && fact.source.input_fact_ids.every(id => state.facts.some(input => input.fact_id === id && input.verification_state === 'source_supported' && input.value_state === 'known' && validDocumentForFact(state,input)));
    return fact.verification_state === 'source_supported' && ((fact.source.kind === 'fixture_document' && state.execution.extraction_mode === 'fixture') || (fact.source.kind === 'box_document' && state.execution.extraction_mode === 'live_box_ai')) && fact.source.excerpt_validation === 'matched' && Boolean(fact.source.excerpt) && Boolean(fact.source.sha256) && validDocumentForFact(state,fact);
  }).sort((a,b)=>a.fact_id.localeCompare(b.fact_id));
}
function factsOf(facts: Fact[], type: string): Fact[] { return facts.filter(fact => fact.fact_type === type); }
function single(facts: Fact[], type: string): Fact | undefined {
  const values = factsOf(facts,type);
  return unique(values.map(fact => JSON.stringify(fact.value))).length === 1 ? values[0] : undefined;
}
function check(id: string, result: Check['result'], facts: Fact[], reason: string): Check {
  return { requirement_id: id, result, fact_ids: unique(facts.map(fact => fact.fact_id)), source_ids: unique(facts.flatMap(fact => fact.source.file_id ? [fact.source.file_id] : [])), reason };
}
function conflicting(facts: Fact[], type: string): boolean { return unique(factsOf(facts,type).map(fact => JSON.stringify(fact.value))).length > 1; }
const validDate = (value: unknown): value is string => typeof value === 'string' && /^2025-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
function coverage(facts: Fact[]) {
  const start = single(facts,'coverage_start'); const end = single(facts,'coverage_end');
  const valid = Boolean(start && end && validDate(start.value) && validDate(end.value) && start.value <= end.value && start.relevant_period.start === end.relevant_period.start && start.relevant_period.end === end.relevant_period.end);
  return { start, end, valid, facts: facts.filter(fact => ['coverage_start','coverage_end'].includes(fact.fact_type)) };
}
function premium(facts: Fact[]) {
  const total = single(facts,'stated_total_premium'); const employer = single(facts,'stated_employer_contribution'); const employee = single(facts,'stated_employee_contribution');
  const inputs = [total,employer,employee].filter(Boolean) as Fact[];
  const period = coverage(facts);
  const valid = Boolean(inputs.length === 3 && inputs.every(fact => fact.unit === 'USD_cents' && typeof fact.value === 'number' && Number.isSafeInteger(fact.value) && fact.value >= 0 && fact.relevant_period.start === period.start?.value && fact.relevant_period.end === period.end?.value) && Number(total?.value) > 0 && Number(total?.value) === Number(employer?.value) + Number(employee?.value) && period.valid);
  return { total, employer, employee, inputs, valid };
}
function refreshDerived(state: State, now: string): boolean {
  const facts = usable(state).filter(fact => fact.verification_state !== 'derived');
  const components = premium(facts); const period = coverage(facts);
  const inputIds = unique([...components.inputs,...period.facts].map(fact => fact.fact_id)).sort();
  const id = `derived:stated-employer-share:${hash(inputIds.join('|')).slice(0,24)}`;
  let changed = false;
  for (const fact of state.facts) if (fact.fact_type === 'reported_employer_share_basis_points' && fact.verification_state === 'derived' && (!components.valid || fact.fact_id !== id)) { fact.verification_state = 'superseded'; changed = true; }
  if (!components.valid || state.facts.some(fact => fact.fact_id === id && fact.verification_state === 'derived')) return changed;
  const existing = state.facts.find(fact => fact.fact_id === id);
  if (existing) { existing.verification_state = 'derived'; return true; }
  state.facts.push({ fact_id: id, business_id: CONTEXT.business_id, fact_type: 'reported_employer_share_basis_points', value_state: 'known', value: Math.round(Number(components.employer!.value) / Number(components.total!.value) * 10000), unit: 'basis_points', relevant_period: { start: period.start!.value as string, end: period.end!.value as string, scope: 'partial_period' }, as_of_date: null, source: { kind: 'deterministic_derivation', file_id: null, file_version_id: null, sha256: null, locator: { kind: 'locator_unavailable', page: null, row: null }, excerpt: null, excerpt_validation: 'not_applicable', owner_confirmation: null, input_fact_ids: inputIds }, verification_state: 'derived', extraction_schema_version: CONTEXT.extraction_schema_version, extracted_at: now, raw_provider_confidence: null, supersedes_fact_id: null, calculation_version: 'stated-share-v1' });
  return true;
}
function enqueueEvaluation(state: State) {
  state.pending_evaluation = { ledger_rev: state.ledger_rev, profile_rev: state.profile_rev, rule_set_id: CONTEXT.rule_set_id };
  if (!state.profile || !state.facts.length) return;
  const id = `EVALUATE:${currentKey(state)}`;
  if (!state.jobs.some(job => job.job_id === id)) state.jobs.push({ job_id:id,kind:'EVALUATE',file_id:null,file_version_id:null,status:'queued',attempts:0,lease_until:null,error:null,committed:false });
}
function numericVersion(version: string): bigint | null { const match = /(?:^|[^0-9])([0-9]+)$/.exec(version); return match ? BigInt(match[1]) : null; }
function older(version: string, than: string): boolean { const a=numericVersion(version); const b=numericVersion(than); return a !== null && b !== null && a < b; }
function preparationJobId(fileId:string):string { return `PREPARE:${CONTEXT.business_id}:${CONTEXT.extraction_schema_version}:${fileId}`; }
function preparationBlocked(state:State,fileId:string):boolean { return state.jobs.some(job=>job.job_id===preparationJobId(fileId) && !job.committed); }
function activeIngestLease(job:Job):boolean { return !job.committed && ['extracting','validating'].includes(job.status) && (job.lease_until??0)>Date.now(); }
function retireUnavailable(state: State): boolean {
  let changed = false;
  for (const fact of state.facts) if (fact.verification_state === 'source_supported' && !validDocumentForFact(state,fact)) { fact.verification_state = 'needs_review'; changed = true; }
  return changed;
}


function validateSource(source:SourceInput,profile:Profile|null):void {
  const fail=(message:string):never=>{throw new DomainError('INVALID_FACT_ENVELOPE',message,422);};
  if(!source.facts.length)throw new DomainError('EMPTY_EXTRACTION','Extraction returned no usable fact envelope; the source needs review.',422);
  if(!source.sha256 || !/^[a-f0-9]{64}$/.test(source.sha256))fail('Document SHA256 must identify the downloaded bytes.');
  if(source.business_name!==null && (!profile || source.business_name.trim().toLocaleLowerCase()!==profile.display_name.trim().toLocaleLowerCase()))throw new DomainError('BUSINESS_NAME_MISMATCH','Document business name does not match this business.',422);
  const units:Record<string,Fact['unit']>={recorded_payment_amount:'USD_cents',recorded_payment_date:'date',payroll_total_hours:'hours',payroll_gross_wages:'USD_cents',payroll_worker_count:'count',coverage_start:'date',coverage_end:'date',stated_total_premium:'USD_cents',stated_employer_contribution:'USD_cents',stated_employee_contribution:'USD_cents'};
  for(const fact of source.facts){
    if(fact.business_id!==CONTEXT.business_id || fact.extraction_schema_version!==CONTEXT.extraction_schema_version)fail('Fact business or schema does not match this intake.');
    if(units[fact.fact_type] && units[fact.fact_type]!==fact.unit)fail('Fact unit does not match its type.');
    if(fact.value_state==='unknown' && fact.value!==null)fail('An unknown fact must have a null value.');
    if(fact.value_state==='known' && fact.value===null)fail('A known fact must have a value.');
    if(fact.value_state==='known'){
      if(['USD_cents','count','basis_points'].includes(fact.unit) && (typeof fact.value!=='number' || !Number.isSafeInteger(fact.value) || fact.value<0))fail('Integer amounts and counts must be nonnegative safe integers.');
      if(fact.unit==='basis_points' && Number(fact.value)>10000)fail('Basis points cannot exceed 10000.');
      if(fact.unit==='hours' && (typeof fact.value!=='number' || !Number.isFinite(fact.value) || fact.value<0))fail('Hours must be a finite nonnegative number.');
      if(fact.unit==='date' && !validDate(fact.value))fail('Dates must be real ISO dates in the demonstration tax year.');
      if(fact.unit==='boolean' && typeof fact.value!=='boolean')fail('Boolean facts must have boolean values.');
      if(fact.unit==='text' && typeof fact.value!=='string')fail('Text facts must have string values.');
    }
    const period=fact.relevant_period;
    if(period.scope==='unknown'){if(period.start!==null || period.end!==null)fail('Unknown periods must have null dates.');}
    else {
      if(!validDate(period.start) || !validDate(period.end) || period.start>period.end)fail('Relevant periods must have ordered real dates in the demonstration year.');
      if(period.scope==='point_in_time' && period.start!==period.end)fail('Point-in-time periods must have one date.');
      if(period.scope==='annual' && (period.start!=='2025-01-01' || period.end!=='2025-12-31'))fail('Annual facts must cover the complete demonstration tax year.');
    }
    if(fact.as_of_date!==null && !validDate(fact.as_of_date))fail('As-of dates must be real dates in the demonstration year.');
    const locator=fact.source.locator;
    if(locator.kind==='verified_page' && (!Number.isSafeInteger(locator.page) || Number(locator.page)<1))fail('A verified page locator needs a positive page number.');
    if(locator.kind!=='verified_page' && locator.page!==null)fail('Unverified locators cannot claim page numbers.');
    if(locator.row!==null && (!Number.isSafeInteger(locator.row) || locator.row<1))fail('Row locators must be positive integers.');
    if(fact.source.excerpt_validation==='matched' && !fact.source.excerpt?.trim())fail('Matched excerpts must contain text.');
    if(fact.source.kind!=='box_document' && fact.source.kind!=='fixture_document')fail('Document extraction facts must identify their actual document source kind.');
  }
}

/** Evaluate evidence readiness only. The synthetic partial records cannot resolve annual eligibility. */
export function evaluateSnapshot(snapshot: EvaluationSnapshot): Opportunity | null {
  const state = snapshot.state; const facts = usable(state);
  if (!state.profile || (!facts.some(fact=>opportunityFactTypes.has(fact.fact_type)) && !state.facts.some(fact=>opportunityFactTypes.has(fact.fact_type) && fact.verification_state==='needs_review'))) return null;
  const payment = factsOf(facts,'recorded_payment_amount');
  const payroll = facts.filter(fact => ['payroll_total_hours','payroll_gross_wages'].includes(fact.fact_type));
  const period = coverage(facts); const components = premium(facts);
  const premiumFacts = facts.filter(fact => fact.fact_type.startsWith('stated_'));
  const badPayment = conflicting(facts,'recorded_payment_amount');
  const badPayroll = ['payroll_total_hours','payroll_gross_wages'].some(type => conflicting(facts,type));
  const badPeriod = ['coverage_start','coverage_end'].some(type => conflicting(facts,type)) || (period.facts.length >= 2 && !period.valid);
  const badPremium = ['stated_total_premium','stated_employer_contribution','stated_employee_contribution'].some(type => conflicting(facts,type)) || (components.inputs.length === 3 && !components.valid);
  const evidence_checks: Check[] = [
    check('recorded_insurance_payment',badPayment?'conflicting':payment.length?'supported':'unknown',payment,badPayment?'Recorded payment amounts conflict.':payment.length?'A source records an insurance payment; payment confirmation and coverage matching remain unresolved.':'No source-supported recorded payment is available.'),
    check('partial_payroll',badPayroll?'conflicting':single(facts,'payroll_total_hours') && single(facts,'payroll_gross_wages')?'supported':'unknown',payroll,'Any supported payroll covers a partial period only. It is not annual FTE or annual FICA wages.'),
    check('coverage_period',badPeriod?'conflicting':period.valid?'supported':'unknown',period.facts,badPeriod?'Coverage dates require review.':period.valid?'The source states a valid coverage period in the demonstration tax year.':'A source-supported coverage period is missing.'),
    check('stated_premium_breakdown',badPremium?'conflicting':components.valid?'supported':'unknown',premiumFacts,badPremium?'Premium components or their periods do not reconcile.':components.valid?'The statement reports reconciled employer and employee premium components. These are stated components, not an additional payment.':'A reconciled, dated premium breakdown is missing.'),
    check('payment_to_coverage_match','unknown',[...payment,...premiumFacts],'The recorded payment and stated contribution lack a shared confirmation or identifier. Equal amounts do not establish a payment match.'),
  ];
  const stale = state.facts.some(fact => fact.verification_state === 'needs_review');
  const requiresReview = stale || evidence_checks.some(item => item.result === 'conflicting');
  const hasCoverage = period.valid && components.valid;
  const stage = requiresReview ? 'needs_review' : hasCoverage ? 'evidence_updated' : 'needs_coverage_statement';
  const share = single(facts,'reported_employer_share_basis_points');
  return { opportunity_id:CONTEXT.opportunity_id,business_id:CONTEXT.business_id,tax_year:2025,rule_set_id:CONTEXT.rule_set_id,revision:snapshot.card_revision+1,ledger_rev:snapshot.ledger_rev,profile_rev:snapshot.profile_rev,evaluation_key:snapshot.evaluation_key,assessment:'potential_opportunity',stage,annual_readiness:'annual_requirements_unresolved',synthetic_data:true,historical_demo:true,evidence_checks,annual_requirements:ANNUAL_IDS.map(id => check(id,'unknown',[],'Annual evidence and applicable exclusions or program conditions remain unresolved.')),estimate:{status:'unavailable',amount_cents:null,reason:'Annual requirements remain unresolved; no eligibility conclusion or credit estimate is available.'},next_action:requiresReview?{id:'review_conflict',label:'Review evidence that needs attention'}:hasCoverage?{id:'review_remaining_requirements',label:'Review remaining requirements'}:{id:'upload_coverage_statement',label:'Upload coverage statement'},reported_employer_share_basis_points:share ? Number(share.value):null,summary:requiresReview?'Some evidence needs review. Annual eligibility and any credit amount remain unresolved.':hasCoverage?'Coverage and stated premium components are supported. Annual requirements and payment matching remain unresolved.':'Source-supported business records suggest a potential opportunity. Add a coverage statement to update the evidence.',fact_ids:unique(facts.map(fact=>fact.fact_id)),rule_source_ids:['irc-45r','form-8941-instructions-2025'],execution:{...state.execution,explanation_mode:'fixture'} };
}

export type IngestOutcome={status:'committed'|'duplicate'|'busy'|'needs_review'|'source_changed';code?:string;currentObservation?:SourceInput};
class SourceObservationChanged extends Error {readonly code='SOURCE_OBSERVATION_CHANGED';constructor(readonly currentObservation:SourceInput){super('SOURCE_OBSERVATION_CHANGED');}}
export function ingestFailure(error:unknown):{code:string;retryable:boolean}{
  const object=error && typeof error==='object'?error as {code?:unknown;name?:unknown;retryable?:unknown}:{};
  const code=typeof object.code==='string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(object.code)?object.code:object.name==='AbortError'||object.name==='TimeoutError'?'INGEST_TIMEOUT':'INGEST_PROVIDER_FAILED';
  const retryable=object.retryable===true || /^(?:BOX_HTTP_(?:408|429|5[0-9]{2})|BOX_.*TIMEOUT|INGEST_TIMEOUT|INGEST_PROVIDER_FAILED|DYNAMO_CAS_RETRY_EXHAUSTED)$/.test(code);
  return {code,retryable};
}

export class TallyEngine {
  private running: Promise<void> | null = null;
  private readonly sources = new Map<string,SourceInput>();
  constructor(readonly store: Store, readonly options: EngineOptions = {}) {}
  private now() { return this.options.now?.() ?? new Date().toISOString(); }
  async state(): Promise<State> { return this.store.read(); }
  async saveProfile(profile: Profile, expectedRev: number): Promise<State> {
    await this.store.transact(state => {
      if (JSON.stringify(state.profile) === JSON.stringify(profile)) return;
      if (state.profile_rev !== expectedRev) throw new DomainError('PROFILE_VERSION_CONFLICT','Profile changed. Reload the latest profile before saving.',409);
      state.profile = structuredClone(profile); state.profile_rev++;
      state.upload_url = this.options.uploadUrl ?? null;
      if (state.facts.length) enqueueEvaluation(state);
    });
    return this.state();
  }
  async analyze(fileIds: string[]): Promise<State> {
    if (!fileIds.length || fileIds.length > 2 || unique(fileIds).length !== fileIds.length) throw new DomainError('INVALID_FILE_SELECTION','Select one or two different files.',422);
    if (!(await this.state()).profile) throw new DomainError('PROFILE_REQUIRED','Save the business profile before analyzing documents.',409);
    let sources:SourceInput[];
    try{sources=await Promise.all(fileIds.map(id => this.options.resolveSource?.(id) ?? fixtureSource(id)));}
    catch(error){if(error instanceof DomainError)throw error;throw new DomainError('UNSUPPORTED_DOCUMENT','This document is not available in the selected intake mode.',422);}
    for (const source of sources) await this.observeSource(source);
    return this.state();
  }
  /** Observation persists the newest source version before any slow extraction starts. */
  async observeSource(source: SourceInput): Promise<boolean> {
    this.sources.set(`${source.file_id}:${source.file_version_id}`,structuredClone(this.options.extractSource?{...source,facts:[]}:source));
    return this.store.transact(state => {
      state.execution.intake_mode=this.options.intakeMode??state.execution.intake_mode;
      let doc = state.documents.find(item=>item.file_id===source.file_id);
      if (doc && (older(source.file_version_id,doc.file_version_id) || (doc.file_version_id===source.file_version_id && doc.sha256 !== source.sha256))) return false;
      const jobId = `INGEST:${CONTEXT.business_id}:${CONTEXT.extraction_schema_version}:${source.file_id}:${source.file_version_id}:${source.sha256}`;
      const existingJob=state.jobs.find(job=>job.job_id===jobId);
      const recovering=preparationBlocked(state,source.file_id);
      if(existingJob && !recovering)return false;
      if(recovering){const preparation=state.jobs.find(job=>job.job_id===preparationJobId(source.file_id))!;preparation.committed=true;preparation.status='completed';preparation.error=null;}
      const leaseActive=existingJob && activeIngestLease(existingJob);
      if (doc) Object.assign(doc,{file_version_id:source.file_version_id,sha256:source.sha256,name:source.name,folder_id:source.folder_id,source_url:source.source_url,status:leaseActive?existingJob.status:'queued',error:null});
      else { doc={file_id:source.file_id,file_version_id:source.file_version_id,sha256:source.sha256,name:source.name,folder_id:source.folder_id,source_url:source.source_url,status:'queued',error:null,aliases:[],accepted_version:null};state.documents.push(doc); }
      // Fresh metadata can lift the block, but cannot transfer an in-flight extraction lease.
      if(existingJob){if(leaseActive)existingJob.error=null;else Object.assign(existingJob,{status:'queued',attempts:existingJob.committed?0:existingJob.attempts,lease_until:null,error:null,committed:false});}
      else state.jobs.push({job_id:jobId,kind:'INGEST',file_id:source.file_id,file_version_id:source.file_version_id,status:'queued',attempts:0,lease_until:null,error:null,committed:false});
      const retired = retireUnavailable(state); const derived = refreshDerived(state,this.now());
      if(retired || derived){state.ledger_rev++;enqueueEvaluation(state);}
      return true;
    });
  }
  /** Source version guard, tenant/content canonical claim, facts and evaluate job commit together. */
  async commitIngest(source: SourceInput): Promise<{committed:boolean;alias:boolean}> {
    return this.store.transact(state => {
      const doc=state.documents.find(item=>item.file_id===source.file_id);
      const job=state.jobs.find(item=>item.kind==='INGEST' && item.file_id===source.file_id && item.file_version_id===source.file_version_id);
      if(!doc || doc.file_version_id!==source.file_version_id || doc.sha256!==source.sha256 || (doc.accepted_version && older(source.file_version_id,doc.accepted_version))) {if(job){job.status='completed';job.committed=true;job.lease_until=null;}return {committed:false,alias:false};}
      // A permanent preparation failure invalidates this file even when an older extraction is in flight.
      if(preparationBlocked(state,source.file_id))return {committed:false,alias:false};
      if(job?.committed) return {committed:false,alias:doc.aliases.length>0};
      validateSource(source,state.profile);
      state.execution={...state.execution,extraction_mode:this.options.extractionMode ?? 'fixture'};
      const canonical=state.documents.find(item=>item.file_id!==doc.file_id && item.sha256===source.sha256 && item.accepted_version===item.file_version_id && (activeStates.has(item.status) || item.status==='needs_review')) ?? (state.facts.some(fact=>fact.source.sha256===source.sha256 && fact.extraction_schema_version===CONTEXT.extraction_schema_version) ? doc : undefined);
      const sourceHasSupport=source.business_name!==null && source.facts.some(fact=>opportunityFactTypes.has(fact.fact_type) && fact.verification_state==='source_supported' && fact.value_state==='known' && fact.source.excerpt_validation==='matched');
      doc.accepted_version=source.file_version_id;doc.status=sourceHasSupport?'ledger_committed':'needs_review';doc.error=sourceHasSupport?null:'No source-supported business facts were accepted; review this document.';
      let contentChanged=false;
      const previous=state.facts.filter(fact=>fact.source.file_id===source.file_id && fact.verification_state!=='superseded' && fact.source.sha256!==source.sha256);
      for(const fact of previous) if(sourceHasSupport && !validDocumentForFact(state,fact)){fact.verification_state='superseded';contentChanged=true;}
      if(canonical){if(canonical.file_id!==doc.file_id){canonical.aliases=unique([...canonical.aliases,doc.file_id]);doc.aliases=unique([...doc.aliases,canonical.file_id]);}}
      else {
        for(const input of source.facts){
          if(input.business_id!==CONTEXT.business_id || input.source.file_id!==source.file_id || input.source.file_version_id!==source.file_version_id || input.source.sha256!==source.sha256) throw new DomainError('INVALID_FACT_SOURCE','Extracted fact source does not match the observed document.');
          if(state.facts.some(fact=>fact.fact_id===input.fact_id)) continue;
          const fact=structuredClone(input);
          if(source.business_name===null || (fact.verification_state==='source_supported' && fact.source.excerpt_validation!=='matched'))fact.verification_state='candidate';
          if(fact.value_state==='conflicting' && fact.verification_state==='source_supported')fact.verification_state='needs_review';
          const prior=previous.find(item=>item.fact_type===fact.fact_type);fact.supersedes_fact_id=prior?.fact_id??null;
          state.facts.push(fact);
        }
      }
      // A restored exact content hash may reactivate its preserved canonical facts.
      for(const fact of state.facts) if(sourceHasSupport && fact.source.sha256===source.sha256 && ['needs_review','superseded'].includes(fact.verification_state) && fact.value_state==='known' && fact.source.excerpt_validation==='matched'){fact.verification_state='source_supported';contentChanged=true;}
      const derivedChanged=refreshDerived(state,this.now());
      state.facts.sort((a,b)=>a.fact_id.localeCompare(b.fact_id));
      if(job){job.committed=true;job.status=sourceHasSupport?'ledger_committed':'needs_review';job.lease_until=null;}
      if(!canonical || derivedChanged || contentChanged){state.ledger_rev++;enqueueEvaluation(state);}
      else if(!state.pending_evaluation){doc.status='completed';if(job)job.status='completed';}
      return {committed:true,alias:Boolean(canonical && canonical.file_id!==doc.file_id)};
    });
  }
  /** No new version/hash is known: withdraw this file's support until fresh preparation succeeds. */
  async failPreparation(fileId:string,code:string):Promise<void>{
    await this.store.transact(state=>{
      const id=preparationJobId(fileId);
      let preparation=state.jobs.find(job=>job.job_id===id);
      if(!preparation){preparation={job_id:id,kind:'INGEST',file_id:fileId,file_version_id:null,status:'needs_review',attempts:0,lease_until:null,error:code,committed:false};state.jobs.push(preparation);}
      preparation.attempts++;preparation.committed=false;
      for(const job of state.jobs)if(job.kind==='INGEST' && job.file_id===fileId && !job.committed){
        job.error=code;
        // Invalidation withdraws evidence, not ownership of a provider call already running.
        if(!activeIngestLease(job)){job.status='needs_review';job.lease_until=null;}
      }
      const doc=state.documents.find(item=>item.file_id===fileId);
      if(doc){doc.status='needs_review';doc.error=code;}
      const retired=retireUnavailable(state),derived=refreshDerived(state,this.now());
      if(retired || derived){state.ledger_rev++;enqueueEvaluation(state);}
    });
    // Failure of this handoff must leave the invalidation durable and the delivery retryable.
    await this.notifyPendingEvaluation();
  }
  async failIngest(fileId:string,version:string,message:string):Promise<void>{
    await this.store.transact(state=>{
      const doc=state.documents.find(item=>item.file_id===fileId);const job=state.jobs.find(item=>item.kind==='INGEST' && item.file_id===fileId && item.file_version_id===version);
      if(job){job.status='failed';job.error=message;job.lease_until=null;}
      if(!doc || doc.file_version_id!==version)return;
      doc.status='failed';doc.error=message;
      const retired=retireUnavailable(state);const derived=refreshDerived(state,this.now());
      if(retired || derived){state.ledger_rev++;enqueueEvaluation(state);}
    });
  }
  async prepareEvaluation():Promise<EvaluationSnapshot|null>{
    const state=await this.state();
    if(!state.profile || !state.facts.length || state.opportunity?.evaluation_key===currentKey(state) || state.jobs.some(job=>job.job_id===`EVALUATE:${currentKey(state)}` && job.committed))return null;
    return {state,ledger_rev:state.ledger_rev,profile_rev:state.profile_rev,rule_set_id:CONTEXT.rule_set_id,card_revision:state.opportunity?.revision??0,evaluation_key:currentKey(state)};
  }
  async publishEvaluation(snapshot:EvaluationSnapshot,opportunity:Opportunity|null):Promise<boolean>{
    return this.store.transact(state=>{
      if(state.ledger_rev!==snapshot.ledger_rev || state.profile_rev!==snapshot.profile_rev || CONTEXT.rule_set_id!==snapshot.rule_set_id || (state.opportunity?.revision??0)!==snapshot.card_revision){const obsolete=state.jobs.find(job=>job.job_id===`EVALUATE:${snapshot.evaluation_key}`);if(obsolete){obsolete.status='completed';obsolete.committed=true;obsolete.lease_until=null;}if(state.opportunity?.evaluation_key!==currentKey(state))enqueueEvaluation(state);return false;}
      if(state.opportunity?.evaluation_key===snapshot.evaluation_key)return false;
      if(state.opportunity)state.history.push(structuredClone(state.opportunity));
      state.opportunity=opportunity?structuredClone(opportunity):null;
      if(opportunity)state.execution.explanation_mode=opportunity.execution.explanation_mode;
      state.pending_evaluation=null;
      for(const job of state.jobs)if(job.kind==='EVALUATE'){const key=/^EVALUATE:(\d+):(\d+):(.+)$/.exec(job.job_id);if(key && key[3]===snapshot.rule_set_id && Number(key[1])<=snapshot.ledger_rev && Number(key[2])<=snapshot.profile_rev){job.committed=true;job.status='completed';job.lease_until=null;}}
      for(const doc of state.documents)if(doc.status==='ledger_committed'||doc.status==='evaluating')doc.status='completed';
      for(const job of state.jobs)if(job.kind==='INGEST' && job.committed && job.status==='ledger_committed')job.status='completed';
      return true;
    });
  }
  private async claimEvaluation(snapshot:EvaluationSnapshot):Promise<boolean>{
    return this.store.transact(state=>{
      if(currentKey(state)!==snapshot.evaluation_key || state.opportunity?.evaluation_key===snapshot.evaluation_key)return false;
      const job=state.jobs.find(item=>item.job_id===`EVALUATE:${snapshot.evaluation_key}`);
      if(!job || job.committed || (job.status==='evaluating' && (job.lease_until??0)>Date.now()))return false;
      job.status='evaluating';job.attempts++;job.lease_until=Date.now()+60000;return true;
    });
  }
  async reconcile():Promise<State>{
    if(!(await this.state()).profile)throw new DomainError('PROFILE_REQUIRED','Save the business profile before reconciling documents.',409);
    await this.store.transact(state=>{
      for(const job of state.jobs)if(!job.committed && ['extracting','validating','evaluating'].includes(job.status) && (job.lease_until??0)<=Date.now()){job.status='queued';job.lease_until=null;}
      if(state.pending_evaluation || (state.facts.length && state.opportunity?.evaluation_key!==currentKey(state) && !state.jobs.some(job=>job.job_id===`EVALUATE:${currentKey(state)}` && job.committed)))enqueueEvaluation(state);
    });
    return this.state();
  }
  processAll():Promise<void>{
    if(this.running)return this.running;
    this.running=this.runQueue().finally(()=>{this.running=null;});return this.running;
  }
  /** Process one source job; transient provider failures require a later queue delivery. */
  async processIngest(fileId:string):Promise<IngestOutcome>{
    let state=await this.state();
    if(!state.profile)throw new DomainError('PROFILE_REQUIRED','Save the business profile before processing documents.',409,true);
    let observed=state.documents.find(doc=>doc.file_id===fileId);
    if(!observed)throw new DomainError('SOURCE_NOT_OBSERVED','Prepare and observe the source before processing it.',409,true);
    await this.store.transact(draft=>{const current=draft.documents.find(doc=>doc.file_id===fileId);for(const job of draft.jobs)if(current && job.kind==='INGEST' && job.file_id===fileId && job.file_version_id!==current.file_version_id && job.job_id!==preparationJobId(fileId) && !job.committed){job.committed=true;job.status='completed';job.lease_until=null;}});
    state=await this.state();
    observed=state.documents.find(doc=>doc.file_id===fileId)!;
    const job=state.jobs.find(item=>item.kind==='INGEST' && item.file_id===fileId && item.file_version_id===observed.file_version_id);
    if(!job || job.committed){await this.notifyPendingEvaluation();return {status:'duplicate'};}
    if(job.status==='failed'||job.status==='needs_review'){await this.notifyPendingEvaluation();return {status:'needs_review',code:job.error??'INGEST_NEEDS_REVIEW'};}
    const claimed=await this.store.transact(draft=>{
      const item=draft.jobs.find(item=>item.job_id===job.job_id),doc=draft.documents.find(item=>item.file_id===fileId);
      if(!item || item.committed || !doc || preparationBlocked(draft,fileId) || doc.file_version_id!==job.file_version_id || (item.status!=='queued' && !(['extracting','validating'].includes(item.status) && (item.lease_until??0)<=Date.now())))return false;
      item.status='extracting';item.attempts++;item.lease_until=Date.now()+120000;doc.status='extracting';return true;
    });
    if(!claimed)return {status:'busy'};
    const attempts=(await this.state()).jobs.find(item=>item.job_id===job.job_id)!.attempts;
    const configuredAttempts=this.options.maxIngestAttempts??3;
    const maxAttempts=Number.isSafeInteger(configuredAttempts)&&configuredAttempts>=1?Math.min(configuredAttempts,3):3;
    if(attempts>maxAttempts){await this.failIngest(fileId,job.file_version_id!,'INGEST_ATTEMPTS_EXHAUSTED');await this.notifyPendingEvaluation();return {status:'needs_review',code:'INGEST_ATTEMPTS_EXHAUSTED'};}
    try{
      const observation=this.sources.get(`${fileId}:${job.file_version_id}`)??await(this.options.resolveSource?.(fileId)??fixtureSource(fileId));
      if(observation.file_id!==fileId || observation.file_version_id!==job.file_version_id || observation.sha256!==observed.sha256){
        if(observation.file_id!==fileId)throw new DomainError('INVALID_SOURCE_ID','Prepared source does not match its queued file.',422);
        await this.observeSource(observation);
        if((await this.state()).documents.find(doc=>doc.file_id===fileId)?.file_version_id===job.file_version_id)throw new DomainError('STALE_SOURCE_OBSERVATION','Preparation returned an older observation than the queued source.',503,true);
        await this.finishObsolete(job.job_id);return {status:'source_changed',currentObservation:observation};
      }
      // Known identical bytes reuse the already validated canonical fact set without another AI call.
      const canonical=(await this.state()).facts.filter(fact=>fact.source.sha256===observation.sha256 && fact.value_state==='known' && ['source_supported','needs_review','superseded'].includes(fact.verification_state) && fact.source.excerpt_validation==='matched');
      let source:SourceInput;
      if(this.options.extractSource && canonical.length){
        source={...observation,business_name:state.profile!.display_name,facts:canonical.map(fact=>({...structuredClone(fact),verification_state:'source_supported',source:{...structuredClone(fact.source),file_id:observation.file_id,file_version_id:observation.file_version_id,sha256:observation.sha256}}))};
      }else source=this.options.extractSource?await this.options.extractSource(observation):observation;
      if(source.file_id!==observation.file_id || source.file_version_id!==observation.file_version_id || source.sha256!==observation.sha256)throw new SourceObservationChanged(source);
      const result=await this.commitIngest(source);
      if(!result.committed){const current=(await this.state()).documents.find(doc=>doc.file_id===fileId);return {status:current?.file_version_id===source.file_version_id?'duplicate':'source_changed'};}
    }catch(error){
      const failure=ingestFailure(error);
      if(failure.code==='BOX_SOURCE_CHANGED' || failure.code==='BOX_FILE_CHANGED_DURING_EXTRACTION' || failure.code==='SOURCE_OBSERVATION_CHANGED'){
        const latest=(error as {currentObservation?:SourceInput}).currentObservation;
        if(latest && latest.file_id===fileId){await this.observeSource({...latest,facts:[]});if((await this.state()).documents.find(doc=>doc.file_id===fileId)?.file_version_id!==job.file_version_id){await this.finishObsolete(job.job_id);return {status:'source_changed',currentObservation:{...latest,facts:[]}};}}
        if(attempts>=maxAttempts){await this.failIngest(fileId,job.file_version_id!,'SOURCE_CHANGED_RETRY_EXHAUSTED');await this.notifyPendingEvaluation();return {status:'needs_review',code:'SOURCE_CHANGED_RETRY_EXHAUSTED'};}
        await this.releaseIngest(job.job_id,failure.code);throw new DomainError(failure.code,'The document changed. Retry preparation before extracting again.',503,true);
      }
      if(failure.retryable && attempts<maxAttempts){await this.releaseIngest(job.job_id,failure.code);throw new DomainError(failure.code,'Document processing is temporarily unavailable.',503,true);}
      const code=failure.retryable?'INGEST_ATTEMPTS_EXHAUSTED':failure.code;
      await this.failIngest(fileId,job.file_version_id!,code);await this.notifyPendingEvaluation();return {status:'needs_review',code};
    }
    // Queue handoff is deliberately outside extraction error handling. A redelivery resumes this commit.
    await this.notifyPendingEvaluation();
    return {status:'committed'};
  }
  private async finishObsolete(jobId:string):Promise<void>{await this.store.transact(state=>{const job=state.jobs.find(item=>item.job_id===jobId);if(job){job.committed=true;job.status='completed';job.lease_until=null;}});}
  private async releaseIngest(jobId:string,code:string):Promise<void>{await this.store.transact(state=>{const job=state.jobs.find(item=>item.job_id===jobId);if(!job || job.committed)return;job.status='queued';job.lease_until=null;job.error=code;const doc=state.documents.find(item=>item.file_id===job.file_id);if(doc && doc.file_version_id===job.file_version_id){doc.status='queued';doc.error=code;}});}
  private async notifyPendingEvaluation():Promise<void>{const state=await this.state();if(state.pending_evaluation)await this.options.afterLedgerCommit?.(state);}
  /** EVALUATE messages cannot invoke source extraction. */
  async processEvaluation():Promise<'completed'|'duplicate'|'busy'|'stale'>{
    if(!(await this.state()).profile)throw new DomainError('PROFILE_REQUIRED','Save the business profile before evaluating documents.',409,true);
    const snapshot=await this.prepareEvaluation();
    if(!snapshot)return 'duplicate';
    if(!await this.claimEvaluation(snapshot))return 'busy';
    let opportunity=evaluateSnapshot(snapshot);
    if(opportunity && this.options.extractionMode==='live_box_ai')opportunity={...opportunity,execution:{...opportunity.execution,explanation_mode:'deterministic_fallback'}};
    if(opportunity && this.options.explain){
      try{
        const output=await this.options.explain(opportunity,usable(snapshot.state));
        const receipt='explanation' in output ? output : null;
        const explanation=validateExplanation(receipt?.explanation??output,{opportunity,facts:usable(snapshot.state)});
        opportunity={...opportunity,summary:explanation.summary,execution:{...opportunity.execution,explanation_mode:receipt?.mode??'live_bedrock'}};
      }catch{opportunity={...opportunity,execution:{...opportunity.execution,explanation_mode:'deterministic_fallback'}};}
    }
    return await this.publishEvaluation(snapshot,opportunity)?'completed':'stale';
  }
  private async runQueue():Promise<void>{
    if(!(await this.state()).profile)return;
    await this.reconcile();
    for(let count=0;count<100;count++){
      const state=await this.state();
      const job=state.jobs.find(item=>item.kind==='INGEST' && !item.committed && item.status==='queued');
      if(job){const result=await this.processIngest(job.file_id!);if(result.status==='busy'||result.status==='source_changed')break;continue;}
      const result=await this.processEvaluation();
      if(result==='duplicate'||result==='busy')break;
    }
  }
}
