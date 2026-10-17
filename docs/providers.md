# Provider gates and local evidence

P01 (Box AI) and P02 (Strands/Bedrock) are **unverified and not approved**. No live calls, secret retrieval, credential creation or deployment occurred. The user authorized a private GitHub code/history push after secret review, independently of provider approval. Current runtime uses reconstructed fixtures; provider modules are reviewable adapters, not evidence of a working live pipeline. Original handoff contracts/PDFs still need reconciliation.

## P01 — Box structured extraction

`npm run smoke:box` exits before resolving credentials or making requests unless explicitly invoked with `--approved-live-call`. Approval must be obtained separately; the flag is a technical gate, not permission by itself.

Required environment: `TALLY_DEMO_TENANT_ID=demo-bakery-001`, `TALLY_TAX_YEAR=2025`, `TALLY_RULE_SET_ID=us-federal-irc45r-2025-v1`, `BOX_INPUT_FOLDER_ID`, `BOX_FIXTURE_A_FILE_ID`, `BOX_EXPECTED_USER_ID`, and an existing `BOX_ACCESS_TOKEN` injected by the operator. Never commit or print the token. These IDs must name the actual approved synthetic fixture A and its folder, not guessed examples.

The script verifies `/users/me` identity and a stable version-specific PDF snapshot with actual byte/page/hash bounds; requests exactly three scalar fields (`business_name`, `payment_date`, `recorded_payment_amount`); and verifies file ID/version/SHA1/size/folder remain stable afterward. It makes one extraction POST, with `include_reference` and `include_confidence_score`, file-ID-only `items`, and no content override. No automatic extraction retry. Failed preflight stops extraction.

Interim request scalar types are string/date/float, with payment amount requested as decimal USD. Full field key configuration follows the submitted prompt. Original configuration and actual returned field types/units still require reconciliation. Reference parsing follows the official Box guide: per-field arrays with `item_id`, zero-indexed `page`, `text`, and optional `bounding_box`. Both top-level `references` and the API reference’s singular `reference` container are accepted; conflicting simultaneous containers fail closed. Actual provider response parity remains unverified until P01. The safe receipt records response keys only, without values or credentials. P01 is not passed merely because an HTTP request succeeds: actual approved fixture identity, scalar units, absent/unknown representation, reference shape, confidence shape, and local excerpt/page matching must be reviewed. The worker adapter now downloads the exact version under a 1MiB streamed byte bound, checks metadata size/SHA1, calculates byte SHA256, and parses authoritative page count (maximum 2) before any extraction. Metadata is checked before/after both preparation and extraction. This code is tested with mocks and actual interim PDFs; deployed/provider behavior remains unverified.

## P02 — explanation only

The user-selected application model is GPT-6 Luna on Amazon Bedrock (`us.openai.gpt-6-luna`, US cross-Region inference from `us-east-1`). It supersedes Qwen, the interim Nova Pro candidate and original Micro default. `packages/contracts/model.ts` centralizes the target and regional IAM resource patterns. The coding executor model is unchanged. No automatic fallback to another live model is configured.

`npm run smoke:strands` requires separate explicit approval, its flag gate, fixed demo validation, `AWS_REGION=us-east-1`, `BEDROCK_MODEL_ID=us.openai.gpt-6-luna`, `TALLY_EXPLANATION_ADAPTER=strands`, existing operator-provided AWS credentials, and `TALLY_SMOKE_INPUT_PATH` pointing to a reviewed `ExplanationContext`. The reconstructed synthetic input is `fixtures/interim/strands-smoke-input.json`, not the missing original handoff input. The script emits only validation status, exact model/region and captured token usage.

Installed `@strands-agents/sdk@1.21.0` supports this configuration without an upgrade: `stream:false` selects Converse, `additionalRequestFields` maps to `additionalModelRequestFields`, and `additionalArgs` passes native `outputConfig`. Tally requests strict non-streaming JSON Schema through `outputConfig.textFormat`, encoding the four-field schema as a JSON string, plus `additionalModelRequestFields.text.format.strict:true`. There are no tools. The native schema uses Bedrock's supported subset; length, maximum array sizes, uniqueness, allowed references and claim checks remain local.

AWS documents reasoning levels none/low/medium/high/xhigh/max, default medium, but the reviewed Luna documentation does not establish the exact Converse reasoning-control field. Tally therefore sends neither an assumed reasoning field nor temperature. No claim of disabled reasoning is made. Separate SDK reasoning blocks are discarded without retaining their text; only final text is parsed. Tool/image/unknown blocks fail closed. P02 must establish actual response and usage behavior and whether the unchanged 350-token budget suffices.

A fresh Agent is created per evaluation with `DefaultModelRetryStrategy({maxAttempts:1})`, Bedrock client maxAttempts1, one turn, max350 output tokens, no native CountTokens, a 20-second request inactivity timeout and a separate 20-second AbortSignal deadline. First native grammar compilation can take minutes; this deadline may cause a labeled deterministic fallback. No warm-up/repair/paid retry is authorized or automatic. Offline mock SDK serialization verifies request wiring; it does not verify account entitlement, live output quality, latency or cost.

Only `endTurn` plus one complete JSON object is accepted. It must contain exactly `summary` (1–600 characters), `what_changed` (0–350 characters), unique `fact_ids` (at most 16 current supplied IDs), and unique `rule_ids` (at most 8 annual/evidence requirement IDs). IRS source identifiers are not rule requirement IDs. Numeric validation allows supplied fact values, their stated dates, correct cents/basis-point rendering, and deterministic employer-share rendering (8000 basis points → 80%). Unsupported numbers, references, eligibility/refund claims, non-text output, missing usage, truncation and malformed JSON fall back deterministically without a repair call. Returned SDK usage is preserved even when local validation fails. If the SDK throws before returning a result, usage remains explicitly unavailable; the current SDK truncation path is such a case. No decision, evidence check, annual check, next action, or amount is delegated to the model.

## Raw webhook verification

`verifyBoxSignature(rawBody, headers, config)` verifies raw bytes plus delivery timestamp with HMAC SHA256 and constant-time comparison. Headers are case insensitive; version must be 1 and algorithm HmacSHA256. A delivery 10 minutes old or more, or over 60 seconds in the future, is rejected. Primary and secondary signature headers are paired only with their matching keys. `parseBoxUploadEvent` checks event ID, configured webhook ID, FILE.UPLOADED, file type/ID, and a parent folder when present. The provider-free API handler must authenticate first, deduplicate by body event ID, durably enqueue, and let INGEST recheck authoritative folder metadata. No extraction or model call belongs in webhook acknowledgement.

## DynamoDB and infrastructure

`DynamoStore` implements the shared Store interface with one demo tenant aggregate (`pk=TENANT#demo-bakery-001#STATE`). Strong reads and conditional revision puts make source acceptance, canonical content claim, facts, and history atomic through the shared pure transaction callback. Conditional conflicts retry up to eight times; callbacks must contain no side effects. State larger than 300KiB fails explicitly without truncation. This bounded aggregate is a hackathon implementation; retention beyond the bound needs a separately designed item layout.

Canonical SAM is `infra/template.yaml` (JSON syntax, valid YAML). It is review-only, with existing secret ARN parameters and live providers disabled by default. It has two Lambdas, four IAM API routes, a separately signature-authenticated webhook route, SQS/DLQ, one DynamoDB table, exact US inference-profile/default-project/model permissions and scoped role permissions. Worker timeout 120s; queue visibility 720s; batch 1; window 0; maximum receives 5; SQS maximum concurrency 2; reserved worker concurrency 2. No VPC. Precreated log groups have retention. No deployment has been performed.

Offline provider/CAS tests: `npx tsx --test tests/providers.test.ts`. Infrastructure contract checks: `node infra/check-template.mjs`. Offline cfn-lint, including SAM transformation, passed using a temporary tool installation; this is not deployed AWS validation. Actual Box references, provider permissions, webhook delivery, IAM signing and deployed SQS behavior remain unverified.

## Official references

- [Box structured extraction request and response](https://developer.box.com/reference/post-ai-extract-structured/)
- [Box webhook signatures](https://developer.box.com/guides/webhooks/v2/signatures-v2)
- [Strands retry strategies](https://strandsagents.com/docs/user-guide/sdk/agents/retry-strategies/)
- [SAM SQS configuration](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-sqs.html)

- [AWS GPT-6 Luna model card and strict Converse JSON configuration](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html)
- [AWS structured-output supported subset and compilation](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html)
- [AWS inference-profile IAM prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)
- [Official OpenAI GPT-6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)

## Concrete remaining gates

P01 is one Box AI extraction POST against the actual approved fixture A file ID in the actual approved inbox; preflight adds one identity GET and two file metadata GETs. The IDs and entitlement/units are still unknown, so a complete action target and unit charge cannot yet be stated. No call is approved.

P02 is one Strands nonstreaming Bedrock Converse invocation of `us.openai.gpt-6-luna` from `us-east-1` via the US profile, maximum 350 output tokens, one attempt/turn and 20-second deadline, using the prepared synthetic context. Input token usage and effective billing/credits remain unknown until an approved execution; no quality/latency result has been measured. Smoke approval would not authorize deployment or a live application loop.

## PDF download and normalization checks

`services/providers/pdf.ts` uses pinned PDF.js in an isolated Node worker thread, with a 128MiB old-generation heap cap and parent-enforced termination after at most 20 seconds. It accepts binary bytes only, parses text only, disables eval/XFA/worker fetching/Wasm, and never renders images or executes PDF actions. It rejects malformed, encrypted, textless, oversized and over-two-page documents. Page text is bounded to 100,000 characters per page. Local packaging must retain the PDF.js module and its local worker module.

`BoxAdapter.downloadVersion` requests `?version=...`, follows at most three redirects manually over HTTPS port443, and never forwards Authorization on redirected requests. Allowed destinations are exact `api.box.com`, `dl.boxcloud.com`, `public.boxcloud.com`, and documented `dl2.boxcloud.com` through `dl20.boxcloud.com`; lookalike suffixes and arbitrary subdomains are rejected. Both declared and streamed byte counts are bounded; actual size and SHA1 must match metadata when SHA1 is supplied. Download URLs and tokens are not logged. `listInbox` reads at most three marker pages, returns at most two direct PDF file IDs, and fails explicitly when pagination remains incomplete below that cap.

Only declared extracted scalar fields become facts. The normalizer never infers facts by scanning PDF text; text is used solely to verify a provider citation and scalar correspondence. Dates require valid ISO calendar values. USD cents use exact decimal arithmetic without rounding; monetary evidence requires independently cited USD currency. Missing/empty scalars stay unknown with null values. Reversed supported periods become conflicting/review evidence. Negative quoted amounts cannot certify positive amounts.

A reference must identify the actual file and a valid zero-indexed page. Optional normalized bounding-box coordinates must be ordered and within0..1; the adapter does not claim geometric text-region verification. Up to eight references per field are bounded and checked; a matching page excerpt and value are required before `source_supported`, then the ledger locator becomes one-indexed. Wrong file IDs, unsupported shapes, bad pages, mismatched excerpts, and instruction-like content remain review evidence. Missing references remain candidates with file-only provenance. Numeric confidence is retained only when actually returned as a valid number or the guide’s number score; it never promotes evidence. Business name comes only from locally verified extracted evidence, never an injected profile value.

`prepareBoxSource` produces a hash-bound observation with no facts and no AI call. `extractPreparedSource` rechecks the version before and after its single extraction. `BoxSourceChangedError` carries latest metadata and, when a bounded fresh read succeeds, a new observation for INGEST to accept; old extraction facts are never attached to the new source. The shared provider factory caches at most eight prepared snapshots within a worker instance.

Additional offline checks: `node --import tsx --test tests/pdf-normalization.test.ts` covers real interim PDFs, strict PDF boundaries, redirect/credential handling, exact byte identities, preparation/extraction races, official Box reference shapes, confidence, currency, dates, amounts, reversed periods and document instructions. These tests do not establish P01 success.

- [Box structured references, zero-indexed pages and bounding boxes](https://developer.box.com/guides/box-ai/ai-tutorials/extract-metadata-structured)
- [Box version-specific download API](https://developer.box.com/reference/get-files-id-content/)
- [Box download domains](https://developer.box.com/guides/api-calls/allowing-domain-access)
- [Box firewall download hostnames](https://docs.box.com/en/box-admin-tools/box-security/configuring-a-firewall-for-box-applications-and-services)
- [PDF.js document initialization](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)

The existing reconstructed interim PDFs remain immutable. They show dollar symbols without an explicit USD token, so the live normalizer may keep their monetary evidence unknown/review when USD cannot be independently cited. This is an input-quality limitation, not permission to infer currency from a profile or silently rewrite already verified bytes. Fixture-mode baseline behavior remains unchanged. A separate generated USD test PDF covers prepare→extract→normalize with actual parsed bytes and mock Box responses.
