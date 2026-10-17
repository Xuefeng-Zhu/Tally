# Tally architecture

## Local execution

The React/Vite client calls the local API. The API validates the business profile and selected source IDs, persists jobs, and coordinates deterministic INGEST and EVALUATE work. A JSON-backed local store persists state across refreshes and process restarts. Test stores allow controlled concurrent interleavings. Box, Bedrock, SQS, and DynamoDB adapters remain separate from fixture execution.

```text
Business context / selected sources
                 |
        local validated API
                 |
      durable INGEST source jobs
                 |
      validate normalized facts
                 |
 atomic source guard + tenant/hash claim + ledger commit
                 |
   coalesced EVALUATE ledger/profile revision pair
                 |
 deterministic rules -> guarded explanation -> opportunity
                 |
       persistent state -> React UI
```

## Evidence, not an annual conclusion

The deterministic evaluator owns every status, rule result, calculation, next action, and the unavailable estimate. Explanations may describe those outputs but cannot change them. Evidence locators link back to documents and validated pages where available; an unavailable locator must remain explicit. Unsupported annual requirements remain unknown rather than being inferred from headcount or a half-month payroll register.

There is one stable opportunity ID per business/tax-year/rule set. New evidence creates a new revision of that opportunity, with history retained. Coverage and stated premium split can be supported before payment/payroll are known. In the interim B-first interpretation, B is usable potential-opportunity evidence and retains a schema-compatible action; A+B converges on the same substantive evidence and annual results in either order, excluding timestamps, revisions, and history.

## Consistency boundaries

- Source acceptance and fact commit must atomically check the accepted file version. A delayed older extraction cannot reactivate evidence after a newer version is accepted.
- The tenant/content-SHA256 claim must be atomic with fact commit. Concurrent identical bytes under different file IDs become aliases of one canonical fact set.
- Re-extraction of a changed source invalidates the old source's current evidence. If extraction fails, history is preserved and affected evidence is marked stale/needs review. Failure of an unrelated new upload does not invalidate existing sources.
- Evaluation reads a ledger revision and profile revision together. Results from an obsolete pair cannot overwrite a newer opportunity. Pending evaluation remains reconcilable after failure.
- Persisted jobs, bounded leases, idempotent commits, and durable queue acknowledgement support safe retries. Retryable infrastructure errors must not masquerade as completed analysis.

## Provider boundaries

The intended AWS design uses a signed intake endpoint, SQS worker delivery, DynamoDB conditional/transactional writes, and Secrets Manager references. The SAM SQS event explicitly caps worker concurrency at two and the function reserve must be at least two. Source inputs are constrained to the configured tenant folder and the manual analyze API accepts at most two files.

The user selected GPT-6 Luna (`us.openai.gpt-6-luna`) through non-streaming Bedrock Runtime Converse, with source Region `us-east-1` and US inference-profile routing. The coding executor model is unchanged. Box AI remains the extraction provider. Native strict JSON Schema constrains explanation shape; local schema and semantic validation still control facts, numbers, claims and references. Separate reasoning blocks are discarded without retention, while unexpected content fails closed. A fresh Strands Agent uses one turn, one attempt and a separate 20-second overall deadline. No live provider call has been performed as part of fixture QA.

Signature validation must use the exact raw webhook body, timestamp freshness, paired key/signature validation, and timing-safe comparison. Neither raw document content nor provider credentials belong in browser bundles, errors, logs, or local examples. Fixture mode remains explicit in persisted execution provenance and in the UI.

## Handoff status

`packages/contracts/index.ts` and `fixtures/interim/` were reconstructed from the read prompt and Google Doc sections 18-19 pending the original bundle. They are interim implementation inputs, not original handoff artifacts. Retrieval was attempted through the provided shared and private conversations; no current bundle could be downloaded. No original files were read. Reconcile the original schemas, exact fixture bytes, rules, and golden outputs before asserting contract parity. Live smoke gates, deployment, GitHub publication, and submission remain pending separate approval.

Luna supersedes the original Micro, interim Nova Pro and later Qwen choices. No quality, latency or account entitlement has been measured. Reasoning defaults to the provider's documented medium; no undocumented Converse reasoning field or temperature is sent. The reviewable IAM template scopes the US profile, account default project and three exact regional foundation-model ARNs. This source change does not alter deployed IAM or grant cloud access.

The AWS handlers fail closed unless both live-provider and whole-flow approval flags are explicitly enabled, or an isolated fixture mode is selected. The production source resolver now validates bounded downloaded PDF bytes, hashes/pages, source references and version observations. Lazy Secrets Manager loading, raw webhook verification and durable queue ingress are wired with injected SDK/provider tests; P01/P02 actual-account evidence remains pending. The SAM template compiles and passes offline checks; it is not a claim of a live or deployment-ready end-to-end service.
