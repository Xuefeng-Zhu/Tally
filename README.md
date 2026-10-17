# Tally

Tally turns source evidence into a traceable next step for a small business. This local historical demo follows Juniper Lane Bakery LLC's potential 2025 federal small-business health-care tax credit opportunity. It distinguishes partial evidence from annual requirements and never supplies an eligibility decision or credit estimate from these records.

## Run locally

The local dependency pins Node 22.23.3 for verification (the package supports 22.13 or newer, below 25). Run:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The local API listens on http://127.0.0.1:4318. Both processes bind to the local machine. Fixture mode requires no Box or AWS credentials and makes no provider calls. Local state is stored in `.data/state.json`; `TALLY_DATA_PATH` can select a separate state file.

Open Settings → Business profile and save the context. In Settings → Sample workspace, add the payment/payroll sample, inspect the Overview, Documents and Opportunity pages, then add the coverage statement sample. The same opportunity card updates with coverage and a stated 80% employer premium share. All eight annual requirements remain unknown. Refresh the page to check that local state persists. See [the demo guide](docs/demo.md).

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

See [architecture](docs/architecture.md) for the ledger, version guards, idempotency, and provider boundaries. Live Box AI, live Strands/Bedrock, persistent credentials and cloud deployment remain **unverified and pending specific approval**. The user authorized a private personal GitHub repository and a code/history push after secret review; this does not authorize cloud calls or public publication/submission. Local fixture checks do not count as live provider validation. The user selected GPT-6 Luna (`us.openai.gpt-6-luna`, US cross-Region inference from `us-east-1`) as the application model; P02 remains unrun and no quality improvement is claimed. Smoke scripts are separate gates; do not run them without explicit approval.

The AWS handler boundaries are deliberately gated. Bounded source PDF download and reference normalization, lazy webhook secrets, durable SQS ingress, and separate worker evaluation are implemented with mocked tests. The live flow is disabled until the provider gates and whole-flow approval are explicit; source compilation does not demonstrate live integration. The original supplied model choice was superseded by the user-selected Luna configuration recorded in `packages/contracts/model.ts`.

## Production adapter implementation

The server-side production path now includes bounded two-page/1MiB PDF download and parsing in an isolated worker, actual byte hashes, version checks before/after extraction, documented Box reference validation against source text, exact integer cents/date handling, lazy approved-secret loading, durable webhook intake and a separate leased INGEST/EVALUATE worker. These are verified with mock provider and SDK transports only. `npm test` blocks external networking and allows local loopback HTTP.

Both `LIVE_PROVIDERS_ENABLED` and `TALLY_APPROVED_LIVE_FLOW` must be explicitly enabled after approval and successful provider gates. Neither flag constitutes human approval by itself. Unavailable or invalid secrets, source references, currencies, metadata, signatures or queue handoffs fail closed. See [provider details](docs/providers.md), [secret wiring](docs/secrets.md), and [review images](docs/review-images.md).
