# Provider gates and local evidence

P01 (Box AI) and P02 (Strands/Bedrock) are **unverified and not approved**. No live calls, secret retrieval, credential creation, deployment, or pushes occurred. Current runtime uses reconstructed fixtures; provider modules are reviewable adapters, not evidence of a working live pipeline. Original handoff contracts/PDFs still need reconciliation.

## P01 — Box structured extraction

`npm run smoke:box` exits before resolving credentials or making requests unless explicitly invoked with `--approved-live-call`. Approval must be obtained separately; the flag is a technical gate, not permission by itself.

Required environment: `TALLY_DEMO_TENANT_ID=demo-bakery-001`, `TALLY_TAX_YEAR=2025`, `TALLY_RULE_SET_ID=us-federal-irc45r-2025-v1`, `BOX_INPUT_FOLDER_ID`, `BOX_FIXTURE_A_FILE_ID`, `BOX_EXPECTED_USER_ID`, and an existing `BOX_ACCESS_TOKEN` injected by the operator. Never commit or print the token. These IDs must name the actual approved synthetic fixture A and its folder, not guessed examples.

The script verifies `/users/me` identity, file parent, PDF extension and 1MiB metadata size limit; requests exactly three scalar fields (`business_name`, `payment_date`, `recorded_payment_amount`); and verifies file ID/version/SHA1/size/folder remain stable afterward. It makes one extraction POST, with `include_reference` and `include_confidence_score`, file-ID-only `items`, and no content override. No automatic extraction retry. Failed preflight stops extraction.

Interim request scalar types are string/date/float, with payment amount requested as decimal USD. Full field key configuration follows the submitted prompt. Original configuration and actual returned field types/units still require reconciliation. `reference` and `confidence_score` containers are preserved as opaque values; no guessed page locator or provider confidence becomes a verified fact. The safe receipt records response keys only, without values or credentials. P01 is not passed merely because an HTTP request succeeds: actual approved fixture identity, scalar units, absent/unknown representation, reference shape, confidence shape, and local excerpt/page matching must be reviewed. Production still needs bounded PDF download, SHA256 calculation and authoritative page count (maximum 2) before ingestion. The metadata extension/size checks do not prove PDF validity or page count.

## P02 — explanation only

The final selected model is Qwen3 Next 80B A3B on Amazon Bedrock (`qwen.qwen3-next-80b-a3b`, direct `us-east-1` Converse), following the requested price/performance comparison. This supersedes the original Micro default and interim Nova Pro candidate. `packages/contracts/model.ts` is the central target configuration. All live calls remain blocked; no automatic fallback to another live model is configured.

`npm run smoke:strands` has the same explicit flag gate and fixed demo target validation. Additionally requires `AWS_REGION=us-east-1`, `BEDROCK_MODEL_ID=qwen.qwen3-next-80b-a3b`, `TALLY_EXPLANATION_ADAPTER=strands`, existing operator-provided AWS credentials, and `TALLY_SMOKE_INPUT_PATH` pointing to a reviewed JSON `ExplanationContext` (deterministic opportunity plus allowed facts). A concrete reconstructed synthetic input is prepared at `fixtures/interim/strands-smoke-input.json`; this is not the missing original handoff input. The smoke script emits only validation status, exact model/region and explicitly captured token usage.

Pinned SDK `@strands-agents/sdk@1.21.0` is compiled locally. A fresh Agent is created per evaluation. `new DefaultModelRetryStrategy({maxAttempts:1})` and the Bedrock client `maxAttempts:1` bound retries. Model options: stream false, native token counting false, strict tools false, max output 350 tokens, temperature 0, request inactivity timeout 20 seconds. `cancelSignal: AbortSignal.timeout(20_000)` provides the separate overall deadline and `limits:{turns:1}` limits the invocation. No tools and no structured-output tool/schema are provided. Generic `BEDROCK_CONFIG` deliberately sends no provider-specific thinking/reasoning options or `additionalRequestFields`. The AWS model card documents Converse support but does not specify a reasoning-control default. The official Qwen Instruct card describes that variant as non-thinking-only; this is not treated as proof of an undocumented Bedrock setting. The existing 350-token limit, one turn, single attempt, 20-second deadline and JSON validation/fallback remain unchanged. Actual returned content and usage still require approved P02 observation.

Only `endTurn` plus one complete JSON object is accepted. It must contain exactly `summary` (1–600 characters), `what_changed` (0–350 characters), unique `fact_ids` (at most 16 current supplied IDs), and unique `rule_ids` (at most 8 annual/evidence requirement IDs). IRS source identifiers are not rule requirement IDs. Numeric validation allows supplied fact values, their stated dates, correct cents/basis-point rendering, and deterministic employer-share rendering (8000 basis points → 80%). Unsupported numbers, references, eligibility/refund claims, non-text output, missing usage, truncation and malformed JSON fall back deterministically without a repair call. Usage is captured explicitly from SDK metrics even when validation fails. No decision, evidence check, annual check, next action, or amount is delegated to the model.

## Raw webhook verification

`verifyBoxSignature(rawBody, headers, config)` verifies raw bytes plus delivery timestamp with HMAC SHA256 and constant-time comparison. Headers are case insensitive; version must be 1 and algorithm HmacSHA256. A delivery 10 minutes old or more, or over 60 seconds in the future, is rejected. Primary and secondary signature headers are paired only with their matching keys. `parseBoxUploadEvent` checks event ID, configured webhook ID, FILE.UPLOADED, file type/ID, and a parent folder when present. The provider-free API handler must authenticate first, deduplicate by body event ID, durably enqueue, and let INGEST recheck authoritative folder metadata. No extraction or model call belongs in webhook acknowledgement.

## DynamoDB and infrastructure

`DynamoStore` implements the shared Store interface with one demo tenant aggregate (`pk=TENANT#demo-bakery-001#STATE`). Strong reads and conditional revision puts make source acceptance, canonical content claim, facts, and history atomic through the shared pure transaction callback. Conditional conflicts retry up to eight times; callbacks must contain no side effects. State larger than 300KiB fails explicitly without truncation. This bounded aggregate is a hackathon implementation; retention beyond the bound needs a separately designed item layout.

Canonical SAM is `infra/template.yaml` (JSON syntax, valid YAML). It is review-only, with existing secret ARN parameters and live providers disabled by default. It has two Lambdas, four IAM API routes, a separately signature-authenticated webhook route, SQS/DLQ, one DynamoDB table, exact direct-model permission and scoped role permissions. Worker timeout 120s; queue visibility 720s; batch 1; window 0; maximum receives 5; SQS maximum concurrency 2; reserved worker concurrency 2. No VPC. Precreated log groups have retention. No deployment has been performed.

Offline provider/CAS tests: `npx tsx --test tests/providers.test.ts`. Infrastructure contract checks: `node infra/check-template.mjs`. Offline cfn-lint, including SAM transformation, passed using a temporary tool installation; this is not deployed AWS validation. Actual Box references, provider permissions, webhook delivery, IAM signing and deployed SQS behavior remain unverified.

## Official references

- [Box structured extraction request and response](https://developer.box.com/reference/post-ai-extract-structured/)
- [Box webhook signatures](https://developer.box.com/guides/webhooks/v2/signatures-v2)
- [Strands retry strategies](https://strandsagents.com/docs/user-guide/sdk/agents/retry-strategies/)
- [SAM SQS configuration](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-sqs.html)

- [AWS Qwen3 Next 80B A3B model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-next-80b-a3b.html)
- [Official Qwen3 Next Instruct model card](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct)

## Concrete remaining gates

P01 is one Box AI extraction POST against the actual approved fixture A file ID in the actual approved inbox; preflight adds one identity GET and two file metadata GETs. The IDs and entitlement/units are still unknown, so a complete action target and unit charge cannot yet be stated. No call is approved.

P02 is one Strands nonstreaming Bedrock Converse invocation of `qwen.qwen3-next-80b-a3b` in `us-east-1`, maximum 350 output tokens, one attempt/turn and 20-second deadline, using the prepared synthetic context. Input token usage and effective billing/credits remain unknown until an approved execution; no quality/latency result has been measured. Smoke approval would not authorize deployment or a live application loop.
