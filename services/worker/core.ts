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
  explain?: (opportunity: Opportunity, facts: Fact[]) => Promise<Explanation | ExplanationReceipt>;
  afterLedgerCommit?: () => Promise<void>;
  uploadUrl?: string | null;
  extractionMode?: 'fixture' | 'live_box_ai';
};
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const currentKey = (state: State) => `${state.ledger_rev}:${state.profile_rev}:${CONTEXT.rule_set_id}`;
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
  if (!state.profile || (!facts.length && !state.facts.some(fact=>fact.verification_state==='needs_review'))) return null;
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
    this.sources.set(`${source.file_id}:${source.file_version_id}`,structuredClone(source));
    return this.store.transact(state => {
      let doc = state.documents.find(item=>item.file_id===source.file_id);
      if (doc && (older(source.file_version_id,doc.file_version_id) || (doc.file_version_id===source.file_version_id && doc.sha256 !== source.sha256))) return false;
      const jobId = `INGEST:${CONTEXT.business_id}:${CONTEXT.extraction_schema_version}:${source.file_id}:${source.file_version_id}:${source.sha256}`;
      if (state.jobs.some(job=>job.job_id===jobId)) return false;
      if (doc) Object.assign(doc,{file_version_id:source.file_version_id,sha256:source.sha256,name:source.name,folder_id:source.folder_id,source_url:source.source_url,status:'queued',error:null});
      else { doc={file_id:source.file_id,file_version_id:source.file_version_id,sha256:source.sha256,name:source.name,folder_id:source.folder_id,source_url:source.source_url,status:'queued',error:null,aliases:[],accepted_version:null};state.documents.push(doc); }
      state.jobs.push({job_id:jobId,kind:'INGEST',file_id:source.file_id,file_version_id:source.file_version_id,status:'queued',attempts:0,lease_until:null,error:null,committed:false});
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
      if(job?.committed) return {committed:false,alias:doc.aliases.length>0};
      validateSource(source,state.profile);
      state.execution={...state.execution,extraction_mode:this.options.extractionMode ?? 'fixture'};
      const canonical=state.documents.find(item=>item.file_id!==doc.file_id && item.sha256===source.sha256 && item.accepted_version===item.file_version_id && (activeStates.has(item.status) || item.status==='needs_review')) ?? (state.facts.some(fact=>fact.source.sha256===source.sha256 && fact.extraction_schema_version===CONTEXT.extraction_schema_version) ? doc : undefined);
      const sourceHasSupport=source.business_name!==null && source.facts.some(fact=>fact.verification_state==='source_supported' && fact.value_state==='known' && fact.source.excerpt_validation==='matched');
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
  private async runQueue():Promise<void>{
    if(!(await this.state()).profile)return;
    await this.reconcile();
    for(let count=0;count<100;count++){
      const state=await this.state();
      const job=state.jobs.find(item=>item.kind==='INGEST' && !item.committed && item.status==='queued');
      if(job){
        const observed=state.documents.find(item=>item.file_id===job.file_id);
        if(!observed || observed.file_version_id!==job.file_version_id){await this.store.transact(draft=>{const obsolete=draft.jobs.find(item=>item.job_id===job.job_id);if(obsolete){obsolete.status='completed';obsolete.committed=true;obsolete.lease_until=null;}});continue;}
        const claimed=await this.store.transact(draft=>{const item=draft.jobs.find(item=>item.job_id===job.job_id);const doc=draft.documents.find(item=>item.file_id===job.file_id);if(!item || item.committed || item.status!=='queued' || !doc || doc.file_version_id!==job.file_version_id)return false;item.status='extracting';item.attempts++;item.lease_until=Date.now()+60000;doc.status='extracting';return true;});
        if(!claimed)continue;
        let source:SourceInput;
        try{source=this.sources.get(`${job.file_id}:${job.file_version_id}`)??await(this.options.resolveSource?.(job.file_id!)??fixtureSource(job.file_id!));}
        catch(error){await this.failIngest(job.file_id!,job.file_version_id!,(error as Error).message);continue;}
        try{await this.commitIngest(source);}catch(error){await this.failIngest(job.file_id!,job.file_version_id!,(error as Error).message);continue;}
        // Deliberately outside ingest error handling: simulated process death must leave durable committed work.
        await this.options.afterLedgerCommit?.();
        continue;
      }
      const snapshot=await this.prepareEvaluation();
      if(!snapshot || !await this.claimEvaluation(snapshot))break;
      let opportunity=evaluateSnapshot(snapshot);
      if(opportunity && this.options.explain){
        try{
          const output=await this.options.explain(opportunity,usable(snapshot.state));
          const receipt='explanation' in output ? output : null;
          const explanation=validateExplanation(receipt?.explanation??output,{opportunity,facts:usable(snapshot.state)});
          opportunity={...opportunity,summary:explanation.summary,execution:{...opportunity.execution,explanation_mode:receipt?.mode??'live_bedrock'}};
        }catch{opportunity={...opportunity,execution:{...opportunity.execution,explanation_mode:'deterministic_fallback'}};}
      }
      await this.publishEvaluation(snapshot,opportunity);
    }
  }
}
