# Local fixture demo

1. Run `npm install` and `npm run dev`, then open http://127.0.0.1:5173.
2. Review the synthetic Juniper Lane Bakery business context. Save it. The legal structure, federal tax classification, and historical year are separate facts; unknown owner/family and related-employer information stays unknown.
3. Load fixture A. Inspect the single opportunity card: a potential opportunity with a next action to supply coverage evidence. Open its evidence links. The two-page synthetic PDF supports the recorded $1,200 insurance payment and partial payroll only.
4. Follow the primary action. A configured upload destination may open; without one the local demo should clearly guide you to its fixture controls and say the external destination is pending configuration.
5. Load fixture B. The existing opportunity updates. Coverage dates and the stated premium breakdown become evidence; $1,200 / $1,500 yields a stated employer share of 80%. It does not confirm that the ledger payment settled with the insurer.
6. Open remaining requirements from the primary action. Inspect eight distinct annual unknowns: annual FTE, annual FICA wages, owner/family exclusions, related-employer aggregation, SHOP or an exception, qualifying arrangement, credit period, and annual net premiums/limits. There is no credit estimate or definitive eligibility result.
7. Refresh. The same opportunity and profile must remain. Repeat fixture inputs to inspect idempotency. On a fresh isolated state, try B before A; final evidence results should converge after both documents arrive.

## What this demonstrates

Local fixture intake, source-linked evidence, deterministic evaluation, persistent state, a stable card updated by later evidence, and explicit unresolved annual requirements. Execution provenance should say synthetic data and fixture extraction/explanation.

## What remains unverified

Original handoff parity is pending reconciliation; the shared/private conversation retrieval attempts did not yield the current ZIP. The interim PDFs are synthetic reconstructions, not original bundle files. Live Box extraction, live Bedrock explanation, cloud event delivery, deployed persistence, account/folder permissions, production credentials, cloud deployment, external source publication, and submission are separate unrun approval gates.

## Verification evidence

`npm test` covers ledger/API behavior. `npm run test:browser` exercises the rendered A-to-B flow on a fresh isolated fixture state and saves desktop/mobile screenshots. Passing fixture tests is not evidence that external providers have been called successfully.
