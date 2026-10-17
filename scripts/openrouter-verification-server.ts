import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { startServer } from '../apps/local-proxy/server.js';
import { createOpenRouterExplainer } from '../services/providers/openrouter.js';

if (!process.argv.includes('--approved-live-call')) throw new Error('OPENROUTER_APPROVAL_REQUIRED');
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_KEY_MISSING');
if ((process.env.TALLY_EXECUTION_MODE ?? 'fixture') !== 'fixture') throw new Error('ISOLATED_FIXTURE_MODE_REQUIRED');
const artifacts = resolve(process.env.TALLY_ARTIFACTS_DIR ?? '.artifacts/openrouter');
const dataPath = resolve(artifacts, 'state.json');
if (existsSync(dataPath)) throw new Error('FRESH_ISOLATED_STATE_REQUIRED');
await mkdir(artifacts, { recursive: true });
const receipts: unknown[] = [];
const priorReceiptsPath = process.env.TALLY_OPENROUTER_PRIOR_RECEIPTS_PATH;
const priorReceipts: unknown = priorReceiptsPath ? JSON.parse(await readFile(priorReceiptsPath, 'utf8')) : [];
if (!Array.isArray(priorReceipts)) throw new Error('OPENROUTER_PRIOR_RECEIPTS_INVALID');
const priorSpendUsd = priorReceipts.reduce((sum: number, item: unknown) => {
  if (!item || typeof item !== 'object') throw new Error('OPENROUTER_PRIOR_RECEIPTS_INVALID');
  const row = item as Record<string, unknown>;
  if (row.attempted === false) return sum;
  const amount = row.costSource === 'provider' && row.costUncertain === false ? row.costUsd : undefined;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new Error('OPENROUTER_PRIOR_COST_UNKNOWN');
  return sum + amount;
}, 0);
const explain = createOpenRouterExplainer({ approvedLiveCall: true, priorSpendUsd });
process.env.TALLY_WEB_PORT = '5206';
process.env.TALLY_API_PROXY_TARGET = 'http://127.0.0.1:4346';
const api = await startServer({ port: 4346, webOrigin: 'http://127.0.0.1:5206', dataPath, engineOptions: {
  explain: async (opportunity, facts) => {
    const receipt = await explain({ opportunity, facts });
    receipts.push({ capturedAt: new Date().toISOString(), evaluationKey: opportunity.evaluation_key, ledgerRev: opportunity.ledger_rev, extractionMode: 'fixture', intakeMode: 'fixture', ...receipt });
    await writeFile(resolve(artifacts, 'openrouter-receipts.json'), JSON.stringify(receipts, null, 2));
    console.log(JSON.stringify({ event: 'explanation_finished', mode: receipt.mode, ledgerRev: opportunity.ledger_rev }));
    return receipt;
  },
} });
const web = await createServer({ configFile: resolve('apps/web/vite.config.ts'), configLoader: 'runner', cacheDir: resolve(artifacts, 'vite-cache') });
await web.listen();
await writeFile(resolve(artifacts, 'run-boundary.json'), JSON.stringify({ createdAt: new Date().toISOString(), apiUrl: api.url, webUrl: 'http://127.0.0.1:5206', dataPath, syntheticData: true, extraction: 'local_fixture_envelopes', inference: 'real_OpenRouter_if_receipt_confirms', maxInferenceAttempts: 2, cumulativeMaxSpendUsd: 0.50, priorSpendUsd, priorReceiptsPath: priorReceiptsPath ?? null, awsCalls: 0, boxCalls: 0, recording: false }, null, 2));
console.log('Isolated verification ready: http://127.0.0.1:5206 ; synthetic fixture extraction with bounded OpenRouter explanation.');
const close = async () => { await web.close(); await api.close(); process.exit(0); };
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
