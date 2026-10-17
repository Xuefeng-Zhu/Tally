# Live integration acceptance plan

Status: **planning only; live E2E NOT RUN**. This document records the next acceptance sequence, not permission to execute it. The user’s order is real integration → real E2E → fix and retest → a new actual live demo only after verified success.

The current app uses reconstructed synthetic records. The original handoff ZIP, contracts and PDFs remain unavailable; no original-file parity is claimed. The current offline suite passed **154/154 with zero failures/skips**, with a focused 64/64 suite and TypeScript passing; receipt `.artifacts/verification/local-e2e-full-tests.tap`, SHA256 `3ed48e6fb26a2d30b20105ce2137ebcc9c8aa8386c764e88ac76caab40371206`. Actual CUA/HTTP local E2E passed 33 browser assertions, duplicate/restart persistence, source PDF hashes and outage→Retry recovery. `scripts/browser-test.ts` was NOT run for that verification. These checks and two actual fixture videos establish local fixture behavior, not the real provider flow. Earlier 151/150/126/114 receipts remain historical; see [verification](verification.md). See [verification matrix](verification-matrix.md) for the boundary between recorded results and pending live evidence.

## Current authorization and observed metadata

The user completed AWS sign-in and STS verified the approved temporary root session. Before deployment, scoped `us-east-1` inventory found no Tally/Millie stacks, functions or table names; the selected Luna profile was ACTIVE across three US destination Regions. That historical inventory was followed by the approved disabled stack reaching CREATE_COMPLETE with 17 resources. Both immutable cross-prepared ZIPs passed actual Linux ARM64 Lambda packaging probes; original handlers were restored and code hashes stayed unchanged. These are deployment/packaging results, not Box/Luna application acceptance; see [verification](verification.md).

Authentication alone did not authorize further root use. The user later explicitly approved the temporary root session, exact two Lambda runtime grants, two human-value secret containers and scoped App Access Only Box setup, within a total **USD 10** deployment/test cap and **no Box purchases**. The exact grants are deployed; the two secret containers were created separately before CloudFormation and remain outside the stack. No root access keys, broader IAM expansion or paid Box upgrade are authorized. Both live gates remain false. This plan grants no additional permission, and its preparation makes no cloud calls. An ACTIVE model profile does not establish invocation success, output quality, latency or cost.

The dedicated Tally app in the new Box Developer account is Created and Authorized/Enabled. Fresh nonsecret UI review confirms CCG and App Access Only selected; file read/write, Manage AI and Manage webhooks persisted after Save/reload, with sign requests disabled. The old account/app and Default App remain untouched. Its service account exists and is empty. Login-as-User redirected to human primary-admin sign-in; no folder was created. The Create Webhook menu showed V2 disabled and V1 enabled; no webhook was created and its cause is not established. Folder/webhook setup and human signature-key entry remain pending. AI entitlement and available quota remain unverified; enabled scopes alone do not prove either.

Two approved normal-application credential/token attempts have completed. Credential AWSCURRENT retrieval, JSON-format and expected-service-user checks passed internally through `SecretProvider`/`createBoxTokenProvider`. The first token attempt returned the generic sanitized `box_ccg_authentication_failed` code. The latest diagnostic retry received an actual token API HTTP 400 response with allowlisted OAuth error `invalid_client`; the latest result is not a transport failure. No specific credential field or enterprise setting is identified as the cause. The next human check is the matching OAuth Client ID and Client Secret of the new Tally app, rather than its numeric console App ID. Fresh nonsecret UI review confirmed CCG, App Access Only and Authorized/Enabled. `/users/me` was not reached; actual Box identity remains NOT VERIFIED. The signature secret was last observed empty and was not read. No raw credential, response or provider message was inspected, copied or logged. Both live gates remain false; no AI/file/folder/webhook call or real provider E2E has run. The temporary diagnostic helper passed seven offline mock tests; these are separate from the unchanged 154-test repository suite and made no production code changes. No further Box retry is permitted until the human confirms correction.

[Box’s official free Developer plan](https://developer.box.com/guides/getting-started/free-developer-plan) lists 1,000 AI units per month and CCG support as supporting context for the new Developer account. The account and authorized Tally app now exist; current available quota and an actual AI extraction remain unverified. No Box subscription or purchase is approved.

The fixed application context is:

| Item | Required value |
| --- | --- |
| Business / year | `demo-bakery-001` / `2025` |
| Rule set | `us-federal-irc45r-2025-v1` |
| Opportunity | `demo-bakery-001:2025:irc_45r` |
| Extraction schema | `tally-extract-v1` |
| Bedrock source Region | `us-east-1` |
| Inference profile / foundation model | `us.openai.gpt-6-luna` / `openai.gpt-6-luna` |
| Profile destinations | `us-east-1`, `us-east-2`, `us-west-2` |

[`packages/contracts/model.ts`](../packages/contracts/model.ts) is the model source of truth. Earlier Nova/Qwen selections are superseded. The coding executor is separate from the application model.

## Approval manifest before any live action

Prepare one reviewable manifest containing actual targets, action limits and evidence destinations. Missing values remain unresolved; never substitute guessed IDs. Approval for a smoke does not approve deployment or the application loop.

| Scope requiring separate approval | Targets and limits to resolve |
| --- | --- |
| Box identity and credentials | Exact Box account/user ID, existing credential source and approved scopes. Box requires `root_readwrite` for PDF downloads; `root_readonly` alone cannot support the hash flow. Review the [official scope requirements](https://developer.box.com/guides/api-calls/permissions-and-errors/scopes). OAuth/token creation or refresh, app configuration, and Secrets Manager reads must be explicitly included if needed. Never place token values in the manifest. |
| Box test content | Exact isolated folder ID, numeric A/B file IDs after approved uploads, approved PDF paths/SHA256/page counts, and any version-update test file ID. Approve uploading only these synthetic documents. |
| Box webhook | Exact existing webhook ID, callback URL, signing-secret ARN and allowed events/folder. Creating/updating a webhook, secret, or app permission is a separate action. |
| P01 extraction | Exact file/version and field configuration, one intended extraction POST per authorized smoke, Box entitlement/unit charge, attempt budget and stop conditions. Metadata/download/identity reads are also provider actions. |
| P02 explanation | Exact inference profile and Regions above, reviewed context file/hash, one intended Converse attempt, 350 output-token cap, 20-second deadline, input-token/cost budget and stop conditions. |
| AWS deploy/write | Full account ID (not just suffix), exact approved operator identity and operation, stack/resource prefix, existing artifact bucket, exact existing secret ARNs, reviewed IAM/change set and `CAPABILITY_IAM` scope. Temporary root-session preparation is approved as a fallback; it does not itself approve every deployment, IAM or persistent-secret action. |
| Application run | Resolved API URL, exact table/key, queue/DLQ URLs and ARNs, function/log-group names, approved runtime identity, test window, maximum provider attempts, and who may trigger manual Analyze or upload. |
| Evidence and recording | Local ignored evidence directory, redaction rules, and permission for a new actual live recording after all required gates pass. Uploading/sharing/submitting evidence is a separate instruction. |

Use the reviewed disabled deployment outputs to resolve actual targets; the earlier empty scoped inventory predates that deployment. A template such as `arn:aws:bedrock:us-east-1:<account-id>:inference-profile/us.openai.gpt-6-luna` is a pattern, not an actual approved ARN. The DynamoDB aggregate key is `TENANT#demo-bakery-001#STATE`; use an isolated approved table because the business ID is fixed. Preserve the user’s existing Mac app on ports 4318/5173 and its `.data` directory.

Both `LIVE_PROVIDERS_ENABLED=true` and `TALLY_APPROVED_LIVE_FLOW=true` are required by the production runtime. `--approved-live-call` gates the smoke commands. These are technical safeguards, not authorization.

## Local prerequisites

Before asking to execute the manifest:

- Keep the complete offline suite, typecheck and web build passing. Fault injection belongs in offline tests first.
- The manual API credential-wiring gap is resolved in source and the deployed exact runtime grants: the API receives its credential-secret ARN and scoped access. The approved normal credential read passed internal checks, but token acquisition failed before actual Box identity verification. Resolve that failed preflight within the approved scope; do not broaden IAM or inspect raw credentials.
- The preparation-failure repair passed final offline validation in the 154/154 offline suite. Source review found that accepted v1 could remain current after permanent preparation failure of the same file’s v2. The current local repair withdraws unavailable support durably, preserves usable accepted aliases, enqueues reevaluation and blocks stale in-flight work; focused regressions are present in `tests/live-worker.test.ts`. The checked result covers the offline regression, not live acceptance. No actual changed-version provider test has run.
- Preserve a safe per-evaluation explanation receipt. The adapter returns usage/fallback reason, while the current engine persists summary and mode only. A wrapper around the existing approved explanation call can write a sidecar receipt without another invocation. Do not store prompts, reasoning blocks or secret values.
- Linux ARM64 packaging is verified via the separately approved immutable cross-prepared ZIPs and actual Lambda probes, including native loading and PDFs `[2,1]`; handlers were restored and code hashes unchanged. Mac host artifacts remain unsuitable for deployment, and the tested cross-prepared manifests remain unchanged with `deployable:false`, backed by hash-bound runtime sidecars. SAM CLI 1.169.0 is available, but its container build remains NOT RUN after explicit OrbStack startup denial. Do not retry startup through CLI or another channel. Offline schema checks are not a full SAM build/transform; see [packaging](packaging.md).
- Review immutable test bytes before paid extraction. Existing interim PDFs show `$` without explicit `USD`; the live normalizer correctly refuses to promote monetary evidence unless currency is independently cited. If the desired live A→B acceptance requires 80%, approve separate synthetic live PDFs with explicit USD and a new hash manifest. Do not silently rewrite the interim PDFs or infer currency from the profile. Original-file reconciliation remains pending.

Relevant implementations: [live API](../services/runtime/live-api.ts), [production factory](../services/runtime/production.ts), [live worker](../services/worker/live-worker.ts), [Box normalization](../services/providers/normalize-box.ts), [SAM](../infra/template.yaml), [packaging](packaging.md). A code fix is evidence only after its regression passes; it does not complete its live gate.

## Execution sequence after explicit approval

### 1. Provider gates

P01 uses the existing [`scripts/smoke-box.ts`](../scripts/smoke-box.ts), invoked as `npm run smoke:box -- --approved-live-call` only within the approved scope. Before paid execution, review a minimal answer/reference capture mechanism: the current script prints shape keys only and cannot by itself retain the provenance evidence needed for acceptance. It verifies the injected existing Box identity, obtains a bounded version-specific PDF snapshot, and makes one three-field extraction request. The unchanged happy path performs one identity GET, five metadata GETs and one to four download GETs including redirects, plus the extraction POST; failed preflight may stop earlier. Its `observed_shape_requires_review` status is intentional. Review actual returned scalar units, unknown representation, field reference/confidence shape, exact file identity, page/excerpt/value correspondence and source stability. HTTP success and response keys alone do not pass full-document normalization. The three-field smoke does not prove the full A/B extraction schema or production secret/OAuth wiring.

P02 uses [`scripts/smoke-strands.ts`](../scripts/smoke-strands.ts), invoked as `npm run smoke:strands -- --approved-live-call`, with the exact fixed context, `AWS_REGION=us-east-1`, `BEDROCK_MODEL_ID=us.openai.gpt-6-luna`, `TALLY_EXPLANATION_ADAPTER=strands` and reviewed `TALLY_SMOKE_INPUT_PATH`. Pass only when the receipt is `live_bedrock` with actual input/output/total usage and valid explanation output. A deterministic fallback is safe behavior but fails the live-response gate. No warm-up, repair call or paid retry is implied if first grammar compilation exceeds the deadline.

If both existing smokes and a fresh application A→B journey are run, the planned baseline is **three Box extraction POSTs** (P01 plus A and B) and **three Luna attempts** (P02 plus the two application evaluations). Duplicate delivery should add zero extraction/model calls. This is not a cost quote or a whole-flow hard cap: SQS retries can cause additional metered extraction attempts even though each SDK request has one attempt. Allocate the approved USD 10 total ceiling across infrastructure and tests, set cumulative attempt limits and stop conditions before execution, and exclude all Box purchases; any paid retry or alternative gate-reuse plan needs review.

The adapter uses a fresh Strands Agent, no tools, one turn/attempt, non-streaming Converse, strict native JSON schema and local validation. Only current supplied fact IDs and allowed requirement IDs may be cited. Unsupported numbers/claims, unknown IDs, extra output fields, malformed/truncated/non-text output or missing usage must fall back. These failure cases are tested with injected offline responses; do not spend calls deliberately manufacturing them.

### 2. Verify the reviewed isolated stack

The approved disabled deployment is complete. For any separately approved update, review the complete change set and immutable artifact evidence, use the approved identity, record actual outputs, and confirm runtime configuration uses exactly those targets. Existing secrets are references, not values copied into a browser. Review the public `/webhooks/box` route separately from the four IAM-authenticated API routes. Keep live providers disabled until the approved run is ready.

A successful deployment does not pass extraction, persistence, invocation or webhook delivery. If packaging, IAM, secrets or queue wiring fails, stop, fix locally/review the change, then retest the failed scope. Do not create broader credentials or policies to unblock the run implicitly.

### 3. Real profile and document A

Use a fresh isolated browser/proxy and the approved signed API endpoint. The existing fixture browser script refuses a live workspace; keep that guard intact. Do not use fixture buttons, route interception, seeded provider responses or direct state edits for live evidence.

1. Read initial API state and preserve a safe baseline: profile/ledger/card revisions, document/fact/job counts, execution modes and existing local state hash. Save the synthetic business profile once through the actual IAM API. Polling/refresh must use GET only.
2. Upload the approved A PDF to the exact Box inbox. Save the real resulting file ID/version and local SHA256 manifest. Do not claim a configured folder link proves a connected account.
3. For webhook acceptance, observe a genuine Box `FILE.UPLOADED` event for that file, valid raw-byte authentication, durable intake, queue handoff and acknowledgment. The acknowledgment must not perform extraction or explanation. A generated HMAC request proves signature handling only, not Box-origin delivery. A manual Analyze run is a separately labeled path, not a substitute for the webhook gate.
4. Follow the real INGEST/EVALUATE jobs until bounded completion. Verify Box identity/folder, exact downloaded version/bytes/page count/hash, stable metadata before/after extraction, and locally validated source locators. Live facts must use `box_document`, not `fixture_document`.
5. Read the actual opportunity and evidence through the browser/API. A creates one potential opportunity with coverage still unresolved; it must not infer annual eligibility, refund, savings or an estimate. Unsupported/missing fields stay unknown/review.

### 4. Document B and duplicate delivery

Upload approved B through the same actual path. Verify a second valid version/hash-bound source, the same opportunity ID with a newer accepted revision and preserved history. For the reviewed USD live A/B contents, deterministic evidence should show employer $1,200 / total $1,500 = 80%, with no double counting of A’s payment and B’s employer component. If source support differs, investigate; never force fixture goldens into the live state.

Open the next action and all eight annual requirements. Each remains independently unknown for these partial records:

`annual_fte`, `annual_fica_wages`, `owner_family_exclusions`, `related_employer_aggregation`, `shop_or_exception`, `qualifying_arrangement`, `credit_period`, `annual_net_premiums_and_limits`.

The opportunity remains potential, estimate unavailable/null. Source links must resolve to the correct approved documents. Verify the API’s live extraction/explanation modes against receipts; `deterministic_fallback` must be visible as such and cannot satisfy the successful Luna gate.

After B settles, request one bounded approved duplicate delivery of the same event, preferably an actual provider redelivery. If that is unavailable, a replay of captured bytes within the accepted signature window must be separately approved and labeled signed replay. Do not print/store signing keys, signatures or token-bearing URLs.

Compare semantic effects against the settled B state: same facts/amounts, ledger revision, opportunity revision/history and committed source identity; no repeated Box AI or Luna evaluation for already committed evidence. An extra SQS delivery or metadata/download read may occur. The DynamoDB storage CAS revision can change for coordination writes, so it is not the semantic idempotency criterion. A second distinct event ID for the same file/version is a useful additional offline test; live execution requires its own budget.

### 5. Persistence, refresh and recovery

- Refresh in a fresh browser context and restart the isolated proxy/reader without deleting the table item. Independently read the exact DynamoDB key with an approved strongly consistent `GetItem` or fresh runtime. Compare safe payload hash, accepted sources, counts and logical revisions. Browser refresh alone does not prove DynamoDB persistence.
- Confirm GET state/refresh does not enqueue Analyze/reconcile or add paid calls. UI credentials stay server-side through the existing SigV4 proxy.
- Exercise permanent/transient provider failure, stale version, queue handoff failure, source aliases and evaluation lease races offline first. For any live recovery exercise, approve the exact isolated target and attempt budget. Do not revoke shared credentials, alter IAM, disable shared queues or invoke a paid failure just for a recording.
- Confirm failed new content is visible for review, accepted changed content cannot leave stale facts current, profile-saved/queue-failure errors truthfully distinguish the saved profile from pending evaluation, and retry/reconcile resumes durable work without duplicated amounts.
- Every failed live criterion gets a concrete receipt, local fix, offline regression and a bounded retest of the affected actual path. Do not declare the whole flow passed while a required criterion is fallback-only or unobserved.

### 6. New live demo only after acceptance

Record a new actual 60–90 second browser walkthrough only after the required real flow passes. Show the approved synthetic profile, actual Box-origin A, evidence, B updating the same opportunity, annual unknowns and refresh/persistence result. Caption synthetic content honestly and distinguish any manual step, signed replay or deterministic fallback. Existing fixture videos cannot be relabeled as live. Preserve the working app/state. Upload or publication is outside this plan until separately instructed.

## Evidence bundle and least-invasive harness

Use existing production clients, worker and signed proxy for a separately approved actual run. Keep fixture browser tests separate. Do not silently deploy, create credentials, upload extra files, retry metered operations or reset state. A live-driving browser/receipt collector is not established by the offline tools below.

The separate saved-evidence tools are local-only:

```sh
./node_modules/node/bin/node --require ./tests/offline-guard.cjs --import tsx scripts/live-e2e-preflight.ts --template
./node_modules/node/bin/node --require ./tests/offline-guard.cjs --import tsx scripts/live-e2e-preflight.ts RUN_MANIFEST.json
./node_modules/node/bin/node --require ./tests/offline-guard.cjs --import tsx scripts/live-e2e-validate.ts RUN_MANIFEST.json
```

Use the project’s installed Node 22 runtime. The preflight template is blank schema guidance, not resolved targets or permission. The validator reads manifest `tally-live-e2e-v1`, SHA256-bound local artifacts, API snapshots `after_a`, `after_b`, `after_duplicate`, `after_refresh`, and separate external traces for Box delivery/extraction, queue/worker, DynamoDB reads, Luna invocation/guards, duplicate delivery and browser refresh. Paths must stay under the local run directory. Follow the exported schema in [`live-e2e-validate.ts`](../scripts/live-e2e-validate.ts). [`tests/live-e2e.test.ts`](../tests/live-e2e.test.ts) tests the receipt validator with synthetic offline evidence, not actual provider exports.

Default validation fails when required external evidence is missing. The explicit `--snapshots-only` option checks saved application state only; it cannot pass full live acceptance. Even a complete consistent bundle reports `mode:offline_saved_evidence`, `live_execution_authenticated:false`, and no external actions executed. A hash proves recorded bytes are unchanged, not where they originated. Review actual provider/browser exports and their provenance before declaring live success. None of these commands executes or authorizes a live flow.

For each phase record time, commit/artifact identity, actual approved target IDs, action/attempt counts and pass/fail/not-run. Safe receipts should correlate file/version/SHA256/page count, event/job IDs, normalized support states/locators, profile/ledger/opportunity revisions, execution modes, independent persistence evidence and Luna usage/fallback reason for the same call. Preserve any unavailable usage as unavailable. Do not retain credentials, webhook signatures, download URLs, raw prompts, reasoning text or unredacted provider dumps. Save only the approved synthetic extraction answer/reference, returned confidence/completion fields if needed, and four-field explanation required for the receipt checks, with sensitive transport/envelope fields removed. Logs/request IDs are supporting correlation, not proof by themselves that cited source facts are correct.

## Stop conditions

Stop before a live action if its target, permission, entitlement or budget is unresolved; identity/folder/version differs; packaging lacks passing evidence from an approved Linux ARM64 verification route; source bounds/locators fail; output guards reject; queue durability is uncertain; or the authorized attempt limit is reached. A timeout may have an uncertain metered outcome: inspect safe existing receipts before any separately authorized retry. Keep the failed gate NOT RUN/FAILED/UNCERTAIN as appropriate. Authentication, fixture success and model metadata never promote it to PASS.
