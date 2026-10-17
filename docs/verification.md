# Verified local build

Executed on the user's Mac using project-local Node 22.23.3. Fixture execution uses no provider credentials and makes no Box/Bedrock calls.

- **105/105 offline tests passed**, with external networking blocked. Coverage includes API validation/status, raw webhook authentication and durable acknowledgment, complete mocked manual API→SQS→INGEST/EVALUATE flow, secret rotation and identity checks, actual bounded PDF parsing, official source reference validation, version races and retries, batch queue recovery, evidence invariants and aggregate Dynamo CAS.
- TypeScript typecheck and React/Vite production build passed.
- Both Lambda artifacts passed isolated Mac ARM64 handler/native dependency loading and actual PDF parsing outside the repository. Network access was blocked. These host artifacts explicitly reject deployment; see [packaging](packaging.md).
- Offline SAM contract checks and cfn-lint/SAM transform passed without warnings. SAM CLI is absent and Docker's daemon is unavailable, so the Linux ARM64 container build has not run.
- Real Chromium fixture A→B walkthrough passed: profile save, stable card, stated 80% share, eight separate annual unknowns, evidence PDF HTTP200, refresh persistence, and desktop/mobile layout. Additional manual/webhook UI checks passed with local mocks: inbox link, Analyze request, profile gate and visible failed intake. No browser runtime errors or external requests occurred.
- Eight synthetic desktop/mobile review images were visually inspected and saved to Library; see [review images](review-images.md).
- Both smoke commands without explicit approval flags exited before credentials/provider activity with LIVE_CALL_REQUIRES_EXPLICIT_APPROVAL. This verifies the guard only.
- Final dependency install reported zero npm audit vulnerabilities.

Generated local evidence: `.artifacts/verification/offline-tests.tap`, `.artifacts/verification/packaging.json`, `.artifacts/browser/`, and `.artifacts/review/` (ignored by git). The working demo state was preserved during verification.

## Remaining verification

The original ZIP/contracts/PDFs remain unavailable; exact handoff parity is pending. The interim PDFs are unchanged and explicitly synthetic. Their missing explicit USD currency text deliberately prevents live normalization from promoting monetary candidates without valid source proof; the fixture goldens are separate labeled inputs.

P01 Box AI, P02 Strands/Bedrock, deployed IAM/Secrets Manager/SQS/webhook behavior, and Linux ARM64 SAM packaging remain unverified. Production download/PDF bounds/hashes/reference normalization, lazy secrets, durable intake and worker wiring are implemented and tested with mocked provider/SDK transports. No actual secret read, provider call, credential creation/configuration, deployment, push, sharing, publication or submission occurred.

These acceptance statements concern the interim local implementation and mocked integration. They do not certify live acceptance gates. Qwen remains the centralized default pending any explicitly approved comparison.
