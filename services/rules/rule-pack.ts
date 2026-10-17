import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { ANNUAL_IDS, CONTEXT, EVIDENCE_IDS } from '../../packages/contracts/index.js';

const SOURCE_ID = 'form-8941-instructions-2025';
const SOURCE_URL = 'https://www.irs.gov/pub/irs-prior/i8941--2025.pdf';
const SOURCE_SHA256 = 'ef65c00179336e2419745c3d8289ba79f9c8b3e3aa0850ff9d10e7552ddc042f';
export const MAX_RULE_CONTEXT_BYTES = 12_000;
export type RuleSourceContext = { requirement_id:string; source_id:string; pdf_page:number; section:string; excerpt:string };
export type RuleContext = {
  rule_set_id:string; tax_year:2025; context_version:string; rule_pack_sha256:string;
  specification_status:'interim_reconstructed'; purpose:string;
  annual_requirements:string[]; evidence_checks:string[]; constraints:string[];
  source_context:RuleSourceContext[];
  context_status:'source_excerpt_checked_professional_review_pending';
  provenance:{source_id:string;title:string;url:string;sha256:string;retrieved_at:string;professional_review_status:'not_reviewed';calculation_enabled:false};
};
function invalid():never { throw new Error('EXPLANATION_RULE_CONTEXT_INVALID'); }
function object(value:unknown):value is Record<string,unknown> { return Boolean(value)&&typeof value==='object'&&!Array.isArray(value); }
function text(value:unknown,max:number):value is string { return typeof value==='string'&&value.trim().length>0&&value.length<=max; }
function sameIds(value:unknown,expected:readonly string[]):value is string[] {
  return Array.isArray(value)&&value.length===expected.length&&value.every((id,index)=>id===expected[index]);
}
function readJson(url:URL,maximum:number):{value:Record<string,unknown>;bytes:Buffer} {
  if(statSync(url).size>maximum)invalid();
  const bytes=readFileSync(url);if(bytes.length>maximum)invalid();
  const value:unknown=JSON.parse(bytes.toString('utf8'));if(!object(value))invalid();return {value,bytes};
}
/** Local, versioned source excerpts only. No retrieval, legal inference or eligibility calculation. */
export function loadRulePack(directory=new URL('../../rules/2025/',import.meta.url)):RuleContext {
  try {
    const {value:pack,bytes}=readJson(new URL('us-federal-irc45r-2025-v1.json',directory),20_000);
    const {value:manifest}=readJson(new URL('sources/manifest.json',directory),4_000);
    if(pack.rule_set_id!==CONTEXT.rule_set_id||pack.tax_year!==CONTEXT.tax_year||pack.specification_status!=='interim_reconstructed'||pack.context_version!=='irs8941-2025-source-context-v1')invalid();
    if(!sameIds(pack.annual_requirements,ANNUAL_IDS)||!sameIds(pack.evidence_checks,EVIDENCE_IDS)||!sameIds(pack.rule_source_ids,['irc-45r',SOURCE_ID]))invalid();
    if(!text(pack.purpose,180)||!Array.isArray(pack.constraints)||pack.constraints.length!==5||!pack.constraints.every(value=>text(value,180)))invalid();
    if(manifest.source!==SOURCE_URL||manifest.sha256!==SOURCE_SHA256||manifest.size_bytes!==832881||manifest.professional_review_status!=='not_reviewed'||manifest.calculation_enabled!==false||!text(manifest.retrieved_at,40)||!Number.isFinite(Date.parse(manifest.retrieved_at)))invalid();
    if(!Array.isArray(pack.source_context)||pack.source_context.length!==ANNUAL_IDS.length)invalid();
    const source_context:RuleSourceContext[]=pack.source_context.map((value,index)=>{
      if(!object(value)||value.requirement_id!==ANNUAL_IDS[index]||value.source_id!==SOURCE_ID||!Number.isSafeInteger(value.pdf_page)||Number(value.pdf_page)<1||Number(value.pdf_page)>30||!text(value.section,100)||!text(value.excerpt,220))invalid();
      return {requirement_id:value.requirement_id as string,source_id:SOURCE_ID,pdf_page:Number(value.pdf_page),section:value.section,excerpt:value.excerpt};
    });
    const context:RuleContext={rule_set_id:CONTEXT.rule_set_id,tax_year:CONTEXT.tax_year,context_version:pack.context_version as string,rule_pack_sha256:createHash('sha256').update(bytes).digest('hex'),specification_status:'interim_reconstructed',purpose:pack.purpose,annual_requirements:[...ANNUAL_IDS],evidence_checks:[...EVIDENCE_IDS],constraints:[...pack.constraints] as string[],source_context,context_status:'source_excerpt_checked_professional_review_pending',provenance:{source_id:SOURCE_ID,title:'2025 Instructions for Form 8941',url:SOURCE_URL,sha256:SOURCE_SHA256,retrieved_at:manifest.retrieved_at,professional_review_status:'not_reviewed',calculation_enabled:false}};
    if(Buffer.byteLength(JSON.stringify(context),'utf8')>MAX_RULE_CONTEXT_BYTES)invalid();
    return context;
  } catch { return invalid(); }
}
