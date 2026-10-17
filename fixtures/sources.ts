/** INTERIM: synthetic envelopes reconstructed from Google Doc §§18–19, not original ZIP fixtures. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONTEXT, type Fact, type SourceInput } from '../packages/contracts/index.js';
export const FIXTURE_FILES = [
  { file_id: 'fixture-A', name: 'Initial payment and partial payroll', source_url: '/fixtures/initial-batch.pdf', pages: 2 },
  { file_id: 'fixture-B', name: 'Coverage statement', source_url: '/fixtures/coverage-statement.pdf', pages: 1 },
] as const;
const extractedAt = '2026-10-17T06:00:00.000Z';
function make(fileId: string, version: string, hash: string, type: string, value: Fact['value'], unit: Fact['unit'], page: number, excerpt: string, start: string, end: string, asOf: string|null = null): Fact {
  return { fact_id: `${fileId}:${version}:${type}`, business_id: CONTEXT.business_id, fact_type: type, value_state: 'known', value, unit, relevant_period: { start, end, scope: start === end ? 'point_in_time' : 'partial_period' }, as_of_date: asOf, source: { kind: 'fixture_document', file_id: fileId, file_version_id: version, sha256: hash, locator: { kind: 'verified_page', page, row: null }, excerpt, excerpt_validation: 'matched', owner_confirmation: null, input_fact_ids: [] }, verification_state: 'source_supported', extraction_schema_version: CONTEXT.extraction_schema_version, extracted_at: extractedAt, raw_provider_confidence: null, supersedes_fact_id: null, calculation_version: null };
}
export function fixtureSource(fileId: string): SourceInput {
  const file = FIXTURE_FILES.find(item => item.file_id === fileId);
  if (!file) throw new Error(`Unknown fixture file: ${fileId}`);
  const version = '1';
  // Hash the actual interim PDF bytes; original handoff parity remains unverified.
  const filename = fileId === 'fixture-A' ? 'initial-batch.pdf' : 'coverage-statement.pdf';
  const hash = createHash('sha256').update(readFileSync(new URL(`./interim/${filename}`, import.meta.url))).digest('hex');
  const fact = (type: string, value: Fact['value'], unit: Fact['unit'], page: number, excerpt: string, start: string, end: string, asOf: string|null = null) => make(fileId, version, hash, type, value, unit, page, excerpt, start, end, asOf);
  const facts: Fact[] = fileId === 'fixture-A' ? [
    fact('recorded_payment_amount',120000,'USD_cents',1,'A recorded insurance payment of $1,200 on June 5, 2025.','2025-06-05','2025-06-05','2025-06-05'),
    fact('recorded_payment_date','2025-06-05','date',1,'2025-06-05','2025-06-05','2025-06-05','2025-06-05'),
    fact('payroll_total_hours',200,'hours',2,'Total\n200\n$4,000.00','2025-06-01','2025-06-15'),
    fact('payroll_gross_wages',400000,'USD_cents',2,'Total\n200\n$4,000.00','2025-06-01','2025-06-15'),
    fact('payroll_worker_count',4,'count',2,'This partial pay-period register lists four synthetic workers.','2025-06-01','2025-06-15'),
  ] : [
    fact('coverage_start','2025-06-01','date',1,'Start: 2025-06-01. End: 2025-06-30.','2025-06-01','2025-06-30'),
    fact('coverage_end','2025-06-30','date',1,'Start: 2025-06-01. End: 2025-06-30.','2025-06-01','2025-06-30'),
    fact('stated_total_premium',150000,'USD_cents',1,'Total monthly premium\n$1,500.00','2025-06-01','2025-06-30'),
    fact('stated_employer_contribution',120000,'USD_cents',1,'Stated employer contribution\n$1,200.00','2025-06-01','2025-06-30'),
    fact('stated_employee_contribution',30000,'USD_cents',1,'Stated employee contribution\n$300.00','2025-06-01','2025-06-30'),
  ];
  return { business_name: 'Juniper Lane Bakery LLC', file_id: fileId, file_version_id: version, name: file.name, sha256: hash, folder_id: 'fixture-folder', source_url: file.source_url, facts };
}
