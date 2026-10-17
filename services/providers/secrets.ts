import {GetSecretValueCommand, SecretsManagerClient, type GetSecretValueCommandOutput} from '@aws-sdk/client-secrets-manager';
import {ProviderGateError} from './gates.js';

export type SecretValue = Pick<GetSecretValueCommandOutput, 'SecretString' | 'SecretBinary'>;
export type SecretTransport = (command: GetSecretValueCommand) => Promise<SecretValue>;
export interface SecretReader { read(secretArn: string): Promise<string> }
export type WebhookKeys = {primaryKey: string; secondaryKey?: string};
export type BoxCredentials =
  | {kind: 'access_token'; access_token: string; expected_user_id: string; expires_at?: string}
  | {kind: 'ccg'; client_id: string; client_secret: string; enterprise_id: string; expected_user_id: string};
export type RefreshOptions = {forceRefresh?: boolean};
type Slot = 'webhook' | 'box';
type Cached = {value: WebhookKeys | BoxCredentials; expiresAt: number};
const MAX_SECRET_BYTES = 16_384;
const MAX_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const fail = (code: string): never => {throw new ProviderGateError(code);};

/** Complete, exact ARN only: no names, prefixes, alternate regions, wildcards, or URL selectors. */
export function validateSecretArn(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/^arn:aws:secretsmanager:us-east-1:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(value)) return fail('SECRET_ARN_INVALID');
  return value;
}

/** SDK and credentials remain lazy. Constructing or importing this reader performs no AWS request. */
export class AwsSecretReader implements SecretReader {
  private client?: SecretsManagerClient;
  constructor(private readonly transport?: SecretTransport) {}
  async read(secretArn: string): Promise<string> {
    const arn = validateSecretArn(secretArn);
    let result: SecretValue;
    try {
      const command = new GetSecretValueCommand({SecretId: arn, VersionStage: 'AWSCURRENT'});
      if (this.transport) result = await this.transport(command);
      else {
        this.client ??= new SecretsManagerClient({region: 'us-east-1', maxAttempts: 1});
        result = await this.client.send(command, {abortSignal: AbortSignal.timeout(10_000)});
      }
    } catch {return fail('SECRET_READ_FAILED');}
    if (result.SecretBinary !== undefined || typeof result.SecretString !== 'string' || !result.SecretString.trim() || Buffer.byteLength(result.SecretString, 'utf8') > MAX_SECRET_BYTES) return fail('SECRET_VALUE_INVALID');
    return result.SecretString;
  }
}

function object(raw: string): Record<string, unknown> {
  if (!raw.trim() || Buffer.byteLength(raw, 'utf8') > MAX_SECRET_BYTES) return fail('SECRET_VALUE_INVALID');
  let value: unknown;
  try {value = JSON.parse(raw);} catch {return fail('SECRET_JSON_INVALID');}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('SECRET_SHAPE_INVALID');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some(key => !allowed.has(key)) || required.some(key => !Object.hasOwn(value, key))) fail('SECRET_FIELDS_INVALID');
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return fail('SECRET_FIELD_INVALID');
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || value.length > 64) return fail('SECRET_IDENTIFIER_INVALID');
  return value;
}
function expiry(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) return fail('SECRET_EXPIRY_INVALID');
  return value;
}
function parseWebhook(raw: string): WebhookKeys {
  const value = object(raw);
  fields(value, ['primaryKey'], ['secondaryKey']);
  return {primaryKey: text(value.primaryKey), ...(Object.hasOwn(value, 'secondaryKey') ? {secondaryKey: text(value.secondaryKey)} : {})};
}
function parseCredentials(raw: string): BoxCredentials {
  const value = object(raw);
  if (Object.hasOwn(value, 'access_token')) {
    fields(value, ['access_token', 'expected_user_id'], ['expires_at']);
    return {kind: 'access_token', access_token: text(value.access_token), expected_user_id: identifier(value.expected_user_id), ...(Object.hasOwn(value, 'expires_at') ? {expires_at: expiry(value.expires_at)} : {})};
  }
  fields(value, ['client_id', 'client_secret', 'enterprise_id', 'expected_user_id']);
  return {kind: 'ccg', client_id: text(value.client_id), client_secret: text(value.client_secret), enterprise_id: identifier(value.enterprise_id), expected_user_id: identifier(value.expected_user_id)};
}

/** Only the two server-bound approved ARNs can be selected. No stale-on-error or previous-version fallback. */
export class SecretProvider {
  private readonly env: NodeJS.ProcessEnv;
  private readonly reader: SecretReader;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly cache = new Map<Slot, Cached>();
  private readonly pending = new Map<Slot, Promise<WebhookKeys | BoxCredentials>>();
  constructor(options: {env?: NodeJS.ProcessEnv; reader?: SecretReader; transport?: SecretTransport; now?: () => number; ttlMs?: number} = {}) {
    if (options.reader && options.transport) fail('SECRET_READER_CONFIGURATION_INVALID');
    this.env = {...(options.env ?? process.env)};
    this.reader = options.reader ?? new AwsSecretReader(options.transport);
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 0 || this.ttlMs > MAX_CACHE_TTL_MS) fail('SECRET_CACHE_TTL_INVALID');
  }
  private async get(slot: Slot, options: RefreshOptions): Promise<WebhookKeys | BoxCredentials> {
    const existing = this.pending.get(slot);
    if (existing) return structuredClone(await existing);
    const cached = this.cache.get(slot);
    if (!options.forceRefresh && cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    this.cache.delete(slot);
    const work = (async () => {
      const arn = validateSecretArn(this.env[slot === 'webhook' ? 'BOX_WEBHOOK_SIGNATURES_SECRET_ARN' : 'BOX_CREDENTIALS_SECRET_ARN']);
      let raw: string;
      try {raw = await this.reader.read(arn);} catch {return fail('SECRET_READ_FAILED');}
      const value = slot === 'webhook' ? parseWebhook(raw) : parseCredentials(raw);
      const now = this.now();
      const credentialExpiry = 'kind' in value && value.kind === 'access_token' && value.expires_at ? Date.parse(value.expires_at) : Infinity;
      if (credentialExpiry <= now) return fail('BOX_CREDENTIALS_EXPIRED');
      this.cache.set(slot, {value, expiresAt: Math.min(now + this.ttlMs, credentialExpiry)});
      return value;
    })();
    this.pending.set(slot, work);
    try {return structuredClone(await work);} finally {if (this.pending.get(slot) === work) this.pending.delete(slot);}
  }
  async getWebhookKeys(options: RefreshOptions = {}): Promise<WebhookKeys> {return this.get('webhook', options) as Promise<WebhookKeys>;}
  async getBoxCredentials(options: RefreshOptions = {}): Promise<BoxCredentials> {return this.get('box', options) as Promise<BoxCredentials>;}
}

let shared: SecretProvider | undefined;
export function getWebhookKeys(options: RefreshOptions = {}): Promise<WebhookKeys> {return (shared ??= new SecretProvider()).getWebhookKeys(options);}
export function getBoxCredentials(options: RefreshOptions = {}): Promise<BoxCredentials> {return (shared ??= new SecretProvider()).getBoxCredentials(options);}

export type BoxAccess = {accessToken: string; expectedUserId: string; expiresAt: number | null};
/** Creating this supplier does nothing. Invocation requires explicit live-flow approval before any secret read. */
export function createBoxTokenProvider(options: {secrets: Pick<SecretProvider, 'getBoxCredentials'>; approvedLiveFlow: boolean; fetcher?: typeof fetch; now?: () => number}) {
  const now = options.now ?? Date.now;
  let cached: {credentials: string; value: BoxAccess; expiresAt: number} | undefined;
  let pending: Promise<BoxAccess> | undefined;
  return async (refresh: RefreshOptions = {}): Promise<BoxAccess> => {
    if (!options.approvedLiveFlow) return fail('LIVE_CALL_REQUIRES_EXPLICIT_APPROVAL');
    if (pending) return structuredClone(await pending);
    if (refresh.forceRefresh) cached = undefined;
    const work = (async (): Promise<BoxAccess> => {
      const credentials = await options.secrets.getBoxCredentials(refresh);
      if (credentials.kind === 'access_token') {
        const expiresAt = credentials.expires_at ? Date.parse(credentials.expires_at) : null;
        if (expiresAt !== null && expiresAt <= now()) return fail('BOX_CREDENTIALS_EXPIRED');
        return {accessToken: credentials.access_token, expectedUserId: credentials.expected_user_id, expiresAt};
      }
      const identity = JSON.stringify(credentials);
      if (!refresh.forceRefresh && cached?.credentials === identity && cached.expiresAt > now()) return structuredClone(cached.value);
      cached = undefined;
      let raw: unknown;
      try {
        const response = await (options.fetcher ?? fetch)('https://api.box.com/oauth2/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'client_credentials', client_id: credentials.client_id, client_secret: credentials.client_secret, box_subject_type: 'enterprise', box_subject_id: credentials.enterprise_id}), redirect: 'error', signal: AbortSignal.timeout(20_000)});
        if (!response.ok) return fail('BOX_TOKEN_REQUEST_FAILED');
        const body = await response.text();
        if (Buffer.byteLength(body, 'utf8') > MAX_SECRET_BYTES) return fail('BOX_TOKEN_RESPONSE_INVALID');
        raw = JSON.parse(body);
      } catch {return fail('BOX_TOKEN_REQUEST_FAILED');}
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('BOX_TOKEN_RESPONSE_INVALID');
      const value = raw as Record<string, unknown>;
      if (typeof value.access_token !== 'string' || !value.access_token.trim() || value.access_token.length > 4096 || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) <= 0 || value.token_type !== 'bearer') return fail('BOX_TOKEN_RESPONSE_INVALID');
      const expiresAt = now() + Number(value.expires_in) * 1000;
      if (!Number.isSafeInteger(expiresAt)) return fail('BOX_TOKEN_RESPONSE_INVALID');
      const access = {accessToken: value.access_token, expectedUserId: credentials.expected_user_id, expiresAt};
      cached = {credentials: identity, value: access, expiresAt: Math.min(now() + MAX_CACHE_TTL_MS, expiresAt - 1000)};
      return access;
    })();
    pending = work;
    try {return structuredClone(await work);} finally {if (pending === work) pending = undefined;}
  };
}
