# Tally

Tally turns source evidence into a traceable next step for a small business. This local historical demo follows Juniper Lane Bakery LLC's potential 2025 federal small-business health-care tax credit opportunity. It distinguishes partial evidence from annual requirements and never supplies an eligibility decision or credit estimate from these records.

## Run locally

The local dependency pins Node 22.23.3 for verification (the package supports 22.12 or newer, below 25). Run:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The local API listens on http://127.0.0.1:4318. Both processes bind to the local machine. Fixture mode requires no Box or AWS credentials and makes no provider calls. Local state is stored in `.data/state.json`; `TALLY_DATA_PATH` can select a separate state file.

Save the business context, load fixture A, inspect the evidence, then load fixture B. The same opportunity card updates with coverage and a stated 80% employer premium share. All eight annual requirements remain unknown. Refresh the page to check that local state persists. See [the demo guide](docs/demo.md).

## Verify

```sh
npm run typecheck
npm test
npm run build
```

With both dev servers running against a **fresh, isolated** state file:

```sh
TALLY_DATA_PATH=/tmp/tally-browser-state.json npm run dev
# In another terminal:
npm run test:browser
```

The browser check uses Playwright Chromium, walks the A-to-B flow, checks evidence links, refresh persistence, annual unknowns, and desktop/mobile layout. If Chromium is missing, install it with `npx playwright install chromium`. Screenshots are saved under `.artifacts/browser/` by default. Do not use your working demo state for this check; it deliberately changes its selected local state.

## Specification and fixture provenance

The build began from the supplied prompt and Google Doc sections 18-19 while the original `tally-build-handoff.zip` was being retrieved. Contracts and fixtures labeled `interim_reconstructed` are reconstructed from that written specification, not read from the original bundle. The clearly marked synthetic PDFs live in `fixtures/interim/`. The shared conversation download did not produce a file, and the private conversation did not expose an obtainable current bundle. No original ZIP, exact contracts, or original PDFs were read. Exact handoff parity remains unverified until the original bundle is obtained and reconciled.

Fixture A has a June 5, 2025 insurance ledger payment of $1,200 and partial June 1-15 payroll of 200 hours / $4,000 across four workers. Fixture B states June 1-30 coverage with $1,500 total premium, $1,200 employer contribution, and $300 employee contribution. Matching values suggest only a candidate association; payment-to-coverage matching remains unknown. A B-first upload supports coverage and premium split; payment and payroll remain unknown. Neither order resolves annual eligibility.

## Implementation and gates

The local API tests and real Chromium A-to-B walkthrough have passed on this Mac. Desktop and mobile screenshots were visually inspected without clipping or horizontal overflow. These checks apply to the interim fixture implementation.

See [architecture](docs/architecture.md) for the ledger, version guards, idempotency, and provider boundaries. Live Box AI, live Strands/Bedrock, credentials, cloud deployment, external pushes, publication, and submission have **not been approved or verified**. Local fixture checks do not count as live provider validation. The user approved Qwen3 Next 80B A3B (`qwen.qwen3-next-80b-a3b`, direct `us-east-1`) as a model override; P02 remains unrun and no quality improvement is claimed. Smoke scripts are separate gates; do not run them without explicit approval.

The AWS handler boundaries are deliberately gated. Production source/reference normalization and webhook secret wiring remain pending the approved provider gates; compiling the SAM scaffold does not demonstrate live integration. The original supplied model choice was superseded by the final user-approved value selection recorded in `packages/contracts/model.ts`.
