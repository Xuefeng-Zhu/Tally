# Verified local build

Executed on the user's Mac using project-local Node 22.23.3. Fixture execution uses no provider credentials and makes no Box/Bedrock calls.

- **150/150 offline tests passed**, with external networking blocked; the current receipt is `.artifacts/verification/readiness-tests.tap`. Coverage includes API validation/status, raw webhook authentication and durable acknowledgment, complete mocked manual API→SQS→INGEST/EVALUATE flow, secret rotation and identity checks, actual bounded PDF parsing, official source reference validation, version races and retries, batch queue recovery, evidence invariants and aggregate Dynamo CAS.
- Nine Luna-specific tests exercise the actual installed Strands→Bedrock request serialization with a mocked HTTP transport, strict JSON schema, reasoning removal and fallback handling. They verify offline compatibility only.
- TypeScript typecheck and React/Vite production build passed.
- Both Lambda artifacts passed isolated Mac ARM64 handler/native dependency loading and actual PDF parsing outside the repository. Network access was blocked. These host artifacts explicitly reject deployment; see [packaging](packaging.md).
- Offline SAM contract and cfn-lint schema/Globals checks passed without warnings. These checks did not perform the full SAM transform. Official SAM CLI 1.169.0 is staged locally. Docker's daemon is stopped and Computer Use denied starting OrbStack, so the Linux ARM64 container build has not run.
- Real Chromium fixture A→B walkthrough passed: profile save, stable card, stated 80% share, eight separate annual unknowns, evidence PDF HTTP200, refresh persistence, and desktop/mobile layout. Additional manual/webhook UI checks passed with local mocks: inbox link, Analyze request, profile gate and visible failed intake. No browser runtime errors or external requests occurred.
- The earlier eight synthetic desktop/mobile images are indexed in [review images](review-images.md). Ten new redesign images and an actual 84-second product recording were visually reviewed and uploaded to Library; see [redesign review](redesign-review.md).
- Both smoke commands without explicit approval flags exited before credentials/provider activity with LIVE_CALL_REQUIRES_EXPLICIT_APPROVAL. This verifies the guard only.
- Final dependency install reported zero npm audit vulnerabilities.

Generated local evidence: `.artifacts/verification/readiness-tests.tap` records 150/150 (SHA256 `921cf2ea9199dcdee76c5417865fd4b1d9d6f61668e6dd8c8c70187d575a4161`); `.artifacts/verification/redesign-tests.tap` records the historical 126/126 baseline; the earlier `.artifacts/verification/offline-tests.tap` records 114/114. Packaging receipts, `.artifacts/browser/`, and `.artifacts/review/` are ignored local evidence. The working demo state was preserved during verification.

## Remaining verification

The original ZIP/contracts/PDFs remain unavailable; exact handoff parity is pending. The interim PDFs are unchanged and explicitly synthetic. Their missing explicit USD currency text deliberately prevents live normalization from promoting monetary candidates without valid source proof; the fixture goldens are separate labeled inputs.

P01 Box AI, P02 Strands/Bedrock, deployed IAM/Secrets Manager/SQS/webhook behavior, and Linux ARM64 SAM packaging remain unverified. Production download/PDF bounds/hashes/reference normalization, lazy secrets, durable intake and worker wiring are implemented and tested with mocked provider/SDK transports. No Box AI extraction, Bedrock invocation, Secrets Manager read, deployment, public publication or submission has run. AWS sign-in/read-only metadata and subsequently approved Box app creation are separate setup observations, described below. The user separately authorized the private personal GitHub repository and the reviewed redesign/readiness push. The verified remote commit is recorded in the completion report.

These acceptance statements concern the interim local implementation and mocked integration. They do not certify live acceptance gates. The user-selected Luna model is centralized; an ACTIVE profile was observed through read-only metadata, while actual runtime invocation remains unverified.

## Product workflow redesign

The redesigned app separates Overview, Documents, Opportunity and Settings. Sample actions are confined to Settings; real document search/filter/detail and existing processing actions remain functional. Unsaved drafts survive navigation, partial-save errors are truthful, GET refresh does not repeat mutations, and stale assessments stay hidden until current. Ten inbox/presentation tests and two current/stale product-render tests supplement the existing 114 offline regressions. The built-in browser is unavailable in this environment, so isolated Playwright Chromium provides browser verification. No working user state or backend contract was changed.

The redesigned browser journey additionally verifies owner navigation, document search/filter/detail, Settings-only sample controls, persistent profile drafts, source PDF links, the stable A→B opportunity update, all eight annual unknowns and refresh persistence. Mocked loading, failure, saved-profile/queue-failure and manual-inbox states were checked. Keyboard tab navigation and the skip link were verified. Captures use isolated temporary state and report no browser runtime errors or external requests. See [redesign review](redesign-review.md) for the new desktop/mobile images and actual 84-second video.

## Read-only setup and current approval boundary

The user completed AWS sign-in and observed an STS root identity in the intended account ending 4085. Scoped `us-east-1` inventory found no matching Tally/Millie CloudFormation stacks, Lambda functions or DynamoDB table names; Luna profile metadata was ACTIVE across three US Regions. These observations do not prove a deployed app or successful inference. The user subsequently approved using the existing temporary root session for bounded Tally deployment preparation.

The user approved a total **USD 10** cap for deployment and tests, with **no Box purchases**. This spending ceiling does not authorize IAM changes, OAuth/app authorization, secret retrieval, or the Box→AWS data flow. Exact runtime grants, persistent secret configuration and Box authorization remain pending separate approval; temporary root-session use for bounded preparation was subsequently approved.

The existing Box account displayed the Individual label and a New App / Server Authentication (CCG) option. Neither the plan label nor an absent Manage AI option proves AI is unavailable. The user subsequently approved creating Tally in that existing account, and the UI confirmed app creation. Configuration review remains pending: default App Access Only and file read/write were selected, Manage webhooks was off, no Manage AI option was visible in the reviewed categories, and service-account generation awaited authorization. No authorization/scope change, API call or secret fetch is established by app creation. Keep actual app IDs out of committed docs. AI entitlement and available quota remain **unverified**, not denied. Alternative account signup was stopped; a new account is not established as necessary.

See [live acceptance](live-e2e.md) and the [verification matrix](verification-matrix.md). The existing P01 script prints response shape keys only; a reviewed minimal answer/reference capture mechanism is still required before the paid extraction so that provenance can actually be assessed. All real extraction, persistence, webhook E2E, Luna response and final live-video gates remain NOT RUN.
