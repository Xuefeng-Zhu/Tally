# Verified local build

Executed on the user's Mac using project-local Node 22.23.3. Fixture execution uses no provider credentials and makes no Box/Bedrock calls.

- 43/43 offline regression tests passed: API validation/status, raw webhook signature/durable acknowledgment, partial evidence invariants, A/B and B-first convergence, content aliases, version interleavings, stale publication, crash recovery, two-worker claims, strict explanation fallback, aggregate Dynamo CAS and restricted signing proxy.
- TypeScript typecheck passed.
- React/Vite production build passed.
- Both Lambda source boundaries bundled with esbuild for Node 22.
- Offline SAM contract checks passed. Offline cfn-lint with SAM transform passed without warnings; SAM CLI itself is unavailable and sam build was not run.
- Final real Chromium walkthrough passed: save profile, A, primary fixture action, B updates same card, stated share80%, eight separate annual unknowns, evidence PDF HTTP200, refresh persistence, no browser runtime errors or mobile horizontal overflow. Desktop/mobile screenshots were visually inspected.
- Both smoke commands without their explicit approval flags exited before credentials/provider activity with LIVE_CALL_REQUIRES_EXPLICIT_APPROVAL. This is a gate test, not a successful live gate.
- Final dependency install reported zero npm audit vulnerabilities.

Generated evidence: `.artifacts/verification/offline-tests.tap`, `.artifacts/browser/desktop-a-then-b.png`, and `.artifacts/browser/mobile-a-then-b.png` (ignored by git).

## Not verified / incomplete

No original ZIP/contracts/PDFs were obtained. Interim schema/fixture parity remains pending. P01/P02 and all cloud/IAM/Secrets Manager/SQS/webhook behavior against an actual account remain unverified. Actual source download/PDF bounds/SHA256/reference normalization and production webhook secret wiring remain incomplete; cloud handlers fail closed outside explicit fixture mode. No deployment, provider calls, credentials, pushes, sharing, publication or submission occurred.

All acceptance statements above concern the implemented interim local fixture flow. They do not certify all live acceptance gates.
