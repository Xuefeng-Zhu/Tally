import test from 'node:test';
import assert from 'node:assert/strict';
import {GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {AwsSecretReader, SecretProvider, createBoxTokenProvider, validateSecretArn, type BoxCredentials, type SecretTransport} from '../services/providers/secrets.js';
import {ProviderGateError} from '../services/providers/gates.js';

const webhookArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:tally/webhook-Ab12Cd';
const credentialsArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:tally/box-Ef34Gh';
const env = {BOX_WEBHOOK_SIGNATURES_SECRET_ARN: webhookArn, BOX_CREDENTIALS_SECRET_ARN: credentialsArn};
const code = (expected: string) => (error: unknown) => error instanceof ProviderGateError && error.code === expected && error.message === expected;
const ccg: BoxCredentials = {kind: 'ccg', client_id: 'synthetic-client', client_secret: 'synthetic-client-secret', enterprise_id: '123', expected_user_id: '456'};

test('AWS secret reader is lazy and requests only the exact full ARN at AWSCURRENT', async () => {
  const commands: GetSecretValueCommand[] = [];
  const reader = new AwsSecretReader(async command => {commands.push(command); return {SecretString: '{"primaryKey":"synthetic-primary"}'};});
  assert.equal(commands.length, 0);
  assert.equal(await reader.read(webhookArn), '{"primaryKey":"synthetic-primary"}');
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof GetSecretValueCommand);
  assert.deepEqual(commands[0].input, {SecretId: webhookArn, VersionStage: 'AWSCURRENT'});
});

test('secret targets reject alternate region, malformed accounts, names, prefixes, selectors and wildcards before transport', async () => {
  let calls = 0;
  const reader = new AwsSecretReader(async () => {calls++; return {SecretString: '{}'};});
  for (const arn of [webhookArn.replace('us-east-1', 'us-west-2'), webhookArn.replace('123456789012', '1234'), 'tally/webhook', webhookArn.slice(0, -7), webhookArn + '*', webhookArn + '?version=old', webhookArn + ' ', webhookArn.replace('arn:aws:', 'arn:aws-cn:')]) {
    assert.throws(() => validateSecretArn(arn), code('SECRET_ARN_INVALID'));
    await assert.rejects(reader.read(arn), code('SECRET_ARN_INVALID'));
  }
  const provider = new SecretProvider({env: {}, reader});
  await assert.rejects(provider.getWebhookKeys(), code('SECRET_ARN_INVALID'));
  assert.equal(calls, 0);
});

test('AWS reader rejects binary, absent, empty and oversized values without disclosing raw responses', async () => {
  for (const response of [{}, {SecretBinary: new Uint8Array([1, 2])}, {SecretString: ' '}, {SecretString: 'x'.repeat(16_385)}, {SecretString: '{}', SecretBinary: new Uint8Array()}]) {
    const reader = new AwsSecretReader(async () => response);
    await assert.rejects(reader.read(webhookArn), code('SECRET_VALUE_INVALID'));
  }
});

test('webhook JSON requires exactly primaryKey and optional nonempty secondaryKey', async () => {
  for (const raw of ['not-json', 'null', '[]', '{}', '{"primaryKey":""}', '{"primaryKey":"ok","secondaryKey":" "}', '{"primaryKey":"ok","oldKey":"never-use"}', '{"primaryKey":123}', '{"primaryKey":"ok","__proto__":{}}']) {
    const provider = new SecretProvider({env, reader: {read: async () => raw}});
    await assert.rejects(provider.getWebhookKeys(), error => error instanceof ProviderGateError && /^SECRET_/.test(error.code));
  }
  const provider = new SecretProvider({env, reader: {read: async () => '{"primaryKey":"new","secondaryKey":"rotation"}'}});
  assert.deepEqual(await provider.getWebhookKeys(), {primaryKey: 'new', secondaryKey: 'rotation'});
});

test('small TTL expires at its boundary, reads are bound to environment snapshot and returned values cannot mutate the cache', async () => {
  let time = 1000, calls = 0;
  const settings = {...env};
  const provider = new SecretProvider({env: settings, now: () => time, ttlMs: 100, reader: {read: async arn => {assert.equal(arn, webhookArn); return JSON.stringify({primaryKey: `key-${++calls}`});}}});
  settings.BOX_WEBHOOK_SIGNATURES_SECRET_ARN = credentialsArn;
  const first = await provider.getWebhookKeys();
  first.primaryKey = 'mutated';
  time = 1099;
  assert.equal((await provider.getWebhookKeys()).primaryKey, 'key-1');
  time = 1100;
  assert.equal((await provider.getWebhookKeys()).primaryKey, 'key-2');
  assert.equal(calls, 2);
  for (const ttlMs of [-1, 60_001, 1.5, NaN]) assert.throws(() => new SecretProvider({ttlMs}), code('SECRET_CACHE_TTL_INVALID'));
});

test('concurrent readers share one request and explicit rotation replaces the old version immediately', async () => {
  let calls = 0, release!: () => void;
  const wait = new Promise<void>(resolve => {release = resolve;});
  let rotated = false;
  const provider = new SecretProvider({env, reader: {read: async () => {calls++; await wait; return JSON.stringify({primaryKey: rotated ? 'new' : 'old'});}}});
  const readers = Array.from({length: 10}, () => provider.getWebhookKeys());
  assert.equal(calls, 1);
  release();
  assert.ok((await Promise.all(readers)).every(value => value.primaryKey === 'old'));
  rotated = true;
  assert.equal((await provider.getWebhookKeys({forceRefresh: true})).primaryKey, 'new');
  assert.equal((await provider.getWebhookKeys()).primaryKey, 'new');
  assert.equal(calls, 2);
});

test('failed refresh never falls back to an old cached key and errors are retried without secret metadata', async () => {
  let calls = 0;
  const provider = new SecretProvider({env, reader: {read: async () => {calls++; if (calls === 2) throw new Error(`credential=DO_NOT_PRINT; ARN=${webhookArn}`); return JSON.stringify({primaryKey: calls === 1 ? 'old' : 'rotated'});}}});
  assert.equal((await provider.getWebhookKeys()).primaryKey, 'old');
  try {await provider.getWebhookKeys({forceRefresh: true}); assert.fail('expected failure');} catch (error) {
    assert.ok(code('SECRET_READ_FAILED')(error));
    assert.doesNotMatch(String(error), /DO_NOT_PRINT|arn:|credential=/);
  }
  assert.equal((await provider.getWebhookKeys()).primaryKey, 'rotated');
  assert.equal(calls, 3);
  const transport: SecretTransport = async () => {throw new Error('sensitive AWS metadata');};
  await assert.rejects(new AwsSecretReader(transport).read(webhookArn), code('SECRET_READ_FAILED'));
});

test('existing access token and CCG secrets have separate strict shapes and numeric expected identities', async () => {
  const access = new SecretProvider({env, reader: {read: async arn => {assert.equal(arn, credentialsArn); return '{"access_token":"synthetic-token","expected_user_id":"456"}';}}});
  assert.deepEqual(await access.getBoxCredentials(), {kind: 'access_token', access_token: 'synthetic-token', expected_user_id: '456'});
  const {kind, ...secret} = ccg;
  const grant = new SecretProvider({env, reader: {read: async () => JSON.stringify(secret)}});
  assert.deepEqual(await grant.getBoxCredentials(), ccg);
  for (const raw of [{access_token: 'token'}, {access_token: 'token', expected_user_id: 'name'}, {access_token: 'token', expected_user_id: '456', client_secret: 'mixed'}, {...secret, enterprise_id: ''}, {...secret, unknown: true}, {...secret, client_secret: ' '}]) {
    await assert.rejects(new SecretProvider({env, reader: {read: async () => JSON.stringify(raw)}}).getBoxCredentials(), error => error instanceof ProviderGateError);
  }
});

test('access token expiry bounds cache and an expired value cannot be served after rotation failure', async () => {
  let time = Date.parse('2026-10-17T07:00:00.000Z'), calls = 0;
  const expires_at = '2026-10-17T07:00:00.050Z';
  const provider = new SecretProvider({env, now: () => time, reader: {read: async () => {calls++; return JSON.stringify({access_token: 'old', expected_user_id: '456', expires_at});}}});
  await provider.getBoxCredentials();
  time += 49;
  await provider.getBoxCredentials();
  assert.equal(calls, 1);
  time++;
  await assert.rejects(provider.getBoxCredentials(), code('BOX_CREDENTIALS_EXPIRED'));
  await assert.rejects(provider.getBoxCredentials(), code('BOX_CREDENTIALS_EXPIRED'));
  assert.equal(calls, 3);
});

test('token factory is inert and denies unapproved invocation before secrets or OAuth are touched', async () => {
  let reads = 0, requests = 0;
  const supply = createBoxTokenProvider({approvedLiveFlow: false, secrets: {getBoxCredentials: async () => {reads++; return ccg;}}, fetcher: async () => {requests++; throw new Error('not reached');}});
  assert.equal(reads + requests, 0);
  await assert.rejects(supply(), code('LIVE_CALL_REQUIRES_EXPLICIT_APPROVAL'));
  assert.equal(reads + requests, 0);
});

test('access token supplier uses the existing approved token without issuing OAuth', async () => {
  let requests = 0;
  const supply = createBoxTokenProvider({approvedLiveFlow: true, secrets: {getBoxCredentials: async () => ({kind: 'access_token', access_token: 'existing', expected_user_id: '456'})}, fetcher: async () => {requests++; throw new Error('unexpected');}});
  assert.deepEqual(await supply(), {accessToken: 'existing', expectedUserId: '456', expiresAt: null});
  assert.equal(requests, 0);
});

test('CCG uses only the fixed service-account grant, deduplicates requests and refreshes before expiry', async () => {
  let time = 1000, requests = 0, release!: () => void;
  const wait = new Promise<void>(resolve => {release = resolve;});
  const supply = createBoxTokenProvider({approvedLiveFlow: true, now: () => time, secrets: {getBoxCredentials: async () => ccg}, fetcher: async (url, init) => {
    requests++; assert.equal(url, 'https://api.box.com/oauth2/token'); assert.equal(init?.redirect, 'error'); assert.equal(init?.method, 'POST');
    const body = new URLSearchParams(String(init?.body));
    assert.deepEqual(Object.fromEntries(body), {grant_type: 'client_credentials', client_id: ccg.client_id, client_secret: ccg.client_secret, box_subject_type: 'enterprise', box_subject_id: ccg.enterprise_id});
    await wait; return new Response(JSON.stringify({access_token: `token-${requests}`, token_type: 'bearer', expires_in: 2}));
  }});
  const first = supply(), second = supply();
  release();
  assert.equal((await first).accessToken, 'token-1');
  assert.equal((await second).accessToken, 'token-1');
  time = 1999; assert.equal((await supply()).accessToken, 'token-1');
  time = 2000; assert.equal((await supply()).accessToken, 'token-2');
  assert.equal(requests, 2);
});

test('CCG failures and malformed responses are redacted and never cached; changed credentials force a new token', async () => {
  let calls = 0, current = ccg;
  const supply = createBoxTokenProvider({approvedLiveFlow: true, secrets: {getBoxCredentials: async () => current}, fetcher: async () => {
    calls++; if (calls === 1) throw new Error('private-client-secret-do-not-log');
    if (calls === 2) return new Response('{"access_token":"do-not-log","expires_in":0,"token_type":"bearer"}');
    return new Response(JSON.stringify({access_token: `token-${calls}`, expires_in: 3600, token_type: 'bearer'}));
  }});
  await assert.rejects(supply(), code('BOX_TOKEN_REQUEST_FAILED'));
  await assert.rejects(supply(), code('BOX_TOKEN_RESPONSE_INVALID'));
  assert.equal((await supply()).accessToken, 'token-3');
  current = {...ccg, client_secret: 'rotated-secret'};
  assert.equal((await supply()).accessToken, 'token-4');
});
