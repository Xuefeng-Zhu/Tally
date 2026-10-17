# Verified local build

Executed on the user's Mac using project-local Node 22.23.3. Fixture execution uses no provider credentials and makes no Box/Bedrock calls.

- **126/126 offline tests passed**, with external networking blocked. Coverage includes API validation/status, raw webhook authentication and durable acknowledgment, complete mocked manual API→SQS→INGEST/EVALUATE flow, secret rotation and identity checks, actual bounded PDF parsing, official source reference validation, version races and retries, batch queue recovery, evidence invariants and aggregate Dynamo CAS.
- Nine Luna-specific tests exercise the actual installed Strands→Bedrock request serialization with a mocked HTTP transport, strict JSON schema, reasoning removal and fallback handling. They verify offline compatibility only.
- TypeScript typecheck and React/Vite production build passed.
- Both Lambda artifacts passed isolated Mac ARM64 handler/native dependency loading and actual PDF parsing outside the repository. Network access was blocked. These host artifacts explicitly reject deployment; see [packaging](packaging.md).
- Offline SAM contract checks and cfn-lint/SAM transform passed without warnings. SAM CLI is absent and Docker's daemon is unavailable, so the Linux ARM64 container build has not run.
- Real Chromium fixture A→B walkthrough passed: profile save, stable card, stated 80% share, eight separate annual unknowns, evidence PDF HTTP200, refresh persistence, and desktop/mobile layout. Additional manual/webhook UI checks passed with local mocks: inbox link, Analyze request, profile gate and visible failed intake. No browser runtime errors or external requests occurred.
- The earlier eight synthetic desktop/mobile images are indexed in [review images](review-images.md). Ten new redesign images and an actual 84-second product recording were visually reviewed and uploaded to Library; see [redesign review](redesign-review.md).
- Both smoke commands without explicit approval flags exited before credentials/provider activity with LIVE_CALL_REQUIRES_EXPLICIT_APPROVAL. This verifies the guard only.
- Final dependency install reported zero npm audit vulnerabilities.

Generated local evidence: `.artifacts/verification/offline-tests.tap`, `.artifacts/verification/packaging.json`, `.artifacts/browser/`, and `.artifacts/review/` (ignored by git). The working demo state was preserved during verification.

## Remaining verification

The original ZIP/contracts/PDFs remain unavailable; exact handoff parity is pending. The interim PDFs are unchanged and explicitly synthetic. Their missing explicit USD currency text deliberately prevents live normalization from promoting monetary candidates without valid source proof; the fixture goldens are separate labeled inputs.

P01 Box AI, P02 Strands/Bedrock, deployed IAM/Secrets Manager/SQS/webhook behavior, and Linux ARM64 SAM packaging remain unverified. Production download/PDF bounds/hashes/reference normalization, lazy secrets, durable intake and worker wiring are implemented and tested with mocked provider/SDK transports. No actual secret read, provider call, credential creation/configuration, deployment, sharing, publication or submission occurred. The user separately authorized a private personal GitHub repository and push through `9d84ed82`; the product redesign is held locally for review.

These acceptance statements concern the interim local implementation and mocked integration. They do not certify live acceptance gates. The user-selected Luna model is centralized; its live account access remains unverified.

## Product workflow redesign

The redesigned app separates Overview, Documents, Opportunity and Settings. Sample actions are confined to Settings; real document search/filter/detail and existing processing actions remain functional. Unsaved drafts survive navigation, partial-save errors are truthful, GET refresh does not repeat mutations, and stale assessments stay hidden until current. Ten inbox/presentation tests and two current/stale product-render tests supplement the existing 114 offline regressions. The built-in browser is unavailable in this environment, so isolated Playwright Chromium provides browser verification. No working user state or backend contract was changed.

The redesigned browser journey additionally verifies owner navigation, document search/filter/detail, Settings-only sample controls, persistent profile drafts, source PDF links, the stable A→B opportunity update, all eight annual unknowns and refresh persistence. Mocked loading, failure, saved-profile/queue-failure and manual-inbox states were checked. Keyboard tab navigation and the skip link were verified. Captures use isolated temporary state and report no browser runtime errors or external requests. See [redesign review](redesign-review.md) for the new desktop/mobile images and actual 84-second video.
