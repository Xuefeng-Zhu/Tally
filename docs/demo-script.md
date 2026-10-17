# Tally — three-minute demo script

## What can be presented today

Tally currently has a verified local **fixture demonstration**. No actual Box-to-AWS end-to-end run has passed. Say this clearly when presenting the current build.

Two existing recordings are available:

| Recording | Duration / frame size | Location | What it proves |
| --- | --- | --- | --- |
| Earlier fixture walkthrough | 84.00 seconds / 1440 × 900 | `.artifacts/demo/tally-fixture-demo.mp4`; Library `libfile_9fa03e0fde308191948107b768f026b8` | The earlier local sample workflow, including the annual checklist |
| Redesigned product walkthrough | 84.24 seconds / 1440 × 1000 | `.artifacts/redesign-demo/tally-redesign-demo.mp4`; Library `libfile_78a8814795b88191bc93bb05e6087c19` | The redesigned local sample workflow and source inspection |

Both videos use reconstructed synthetic fixtures and make no live Box or model calls. They are existing short product recordings, not a completed recording of this three-minute spoken script. Library file IDs are not public submission video URLs. See [redesign review](redesign-review.md) and the ignored recording manifests for capture evidence.

## Before the rehearsal

- Have the build runner start a fresh, isolated **fixture** workspace. Use a new temporary `TALLY_DATA_PATH`; preserve the owner's working `.data/state.json`. Do not delete records or stop another running workspace to obtain a clean screen.
- Open that workspace at `#overview`. Confirm there is no saved business profile or opportunity yet. Use 1440 × 1000 where practical and check that text is readable.
- Keep this script off-screen. Use only the fictional Juniper Lane Bakery profile and the two labeled local samples.
- The four main navigation routes are `#overview`, `#documents`, `#opportunity` and `#settings`. Settings sections and Opportunity tabs are selected within their route; they are not separate URLs.
- Allow processing to finish before moving on. If the review remains pending or a record needs attention, explain that actual state. Do not narrate an update that has not appeared.

## Current fixture presentation — exactly 3:00

The times are rehearsal targets. Spoken lines leave room for the listed clicks and short pauses.

### 0:00–0:20 — The problem and the boundary

**Show:** Overview (`#overview`). Keep the priority panel and navigation visible.

**Say:**

> Small business owners have records scattered across payment, payroll and insurance documents. Tally brings those records together and gives them a specific next step, with the open questions still visible. This is a local demonstration using a fictional business and historical 2025 sample records.

### 0:20–0:40 — Business context

**Do:** Choose **Set up business details**, or **Settings → Business profile**. Review the fixed bakery identity. Briefly open **People & health benefits**, then choose **Save business profile**. Wait for the saved state.

**Say:**

> We start with a little business context. The sample identity is fixed, while headcount, benefits and ownership context can be updated. Those answers help organize the review; approximate headcount does not establish the annual workforce requirements.

### 0:40–1:00 — Add the first record

**Do:** Choose the top-bar **Sample data** control, which opens **Settings → Sample workspace**. Choose **Add payment & payroll sample**. Once processing finishes, return to **Overview**.

**Say:**

> This labeled sample contains a recorded insurance payment and part of June’s payroll. It runs locally, without Box or model calls. The new priority tells us the coverage statement is missing.

### 1:00–1:25 — Inspect the source

**Do:** Open **Documents**. Select **Initial payment and partial payroll**. Show **Recorded information**, then choose **Open source PDF**. Briefly show the actual PDF and return to the Tally tab. Open **Opportunity → Evidence**.

**Say:**

> Each record stays connected to its source. We can inspect the original sample PDF, the period it covers and the facts accepted from it. The evidence view keeps excerpts and verification alongside those facts, so a summary does not replace the underlying record.

### 1:25–1:45 — A specific next step

**Do:** Select the Opportunity **Overview** tab. Show **Your next step** and **Payment linked to this coverage: Unknown**. Choose **Go to documents**.

**Say:**

> The next step is concrete: add a coverage statement with the dates and premium breakdown. The payment is recorded, but its connection to this coverage has not been confirmed. Tally does not turn a matching-looking amount into a settled payment match.

### 1:45–2:10 — Update the same opportunity

**Do:** Choose the top-bar **Sample data** control, then **Add coverage statement sample**. Wait for processing to finish. Return to **Overview → Review opportunity**. Show the updated Opportunity **Overview** and its monthly share panel.

**Say:**

> Adding the coverage statement updates the same opportunity. The statement reports fifteen hundred dollars in total monthly premium and twelve hundred from the employer: a stated eighty percent share. That is a monthly statement calculation. Payment matching and the annual contribution rules remain open.

### 2:10–2:40 — Keep the annual questions separate

**Do:** Choose **Annual review**. Keep all eight rows visible where possible. Expand one row, then collapse it so the complete checklist is visible again.

**Say:**

> Document support is separate from the annual assessment. All eight annual requirements are still unknown: full-year employee hours and wages, owner and family exclusions, related businesses, SHOP coverage or an exception, the contribution arrangement, earlier credit years, and full-year premiums and limits. There is no credit estimate or eligibility conclusion from these partial records.

### 2:40–3:00 — Close on the product value

**Do:** Return to Opportunity **Overview**, then **Overview** in the main navigation. End on the current priority. Do not open provider settings or a terminal.

**Say:**

> Tally turns scattered records into evidence, a clear next step and visible unknowns. The local workflow works today. Live Box ingestion and AWS processing remain the next acceptance milestone; adapters and offline tests do not establish live success.

## Future live presentation — conditional, not yet recordable

AWS sign-in is complete. The parent operator reports a read-only STS identity check of a root principal in account ending **4085**; that observed login does not authorize future use of the root session. Actual Box AI extraction, Luna invocation and the full application flow remain unverified.

A **Tally app was created in the existing Box account** after specific app-creation and legal approval. The alternative-account signup was stopped; no new account or signup is needed. Configuration review is pending. The observed defaults are **App Access Only** with **Read/Write files** checked and **Manage webhooks** off. No **Manage AI** option was visible across the three reviewed permission categories; that is not an entitlement decision. The service account has not been generated; Box indicates that occurs after **Authorize**. No scope change, authorization, Box API call or secret fetch is approved by this script.

The **Individual** plan label does not prove AI is unavailable. Box AI entitlement and quota remain **unverified**. Box documents a [free Developer plan with 1,000 Box AI units](https://developer.box.com/guides/getting-started/free-developer-plan) as an option to assess, not a requirement to open another account or proof of this workspace's available units.

The user approved a **USD 10 total deployment-and-test budget**. That ceiling does not authorize Box plan purchases, IAM changes, OAuth/scope changes, additional app creation or the proposed data flow. Resolve the exact operations, identities and targets in the [live E2E plan](live-e2e.md) before execution.

A final **live** recording must follow this order:

1. Complete the separately authorized Box/AWS integration with the intended accounts, actual inbox and approved synthetic documents.
2. Pass an actual live end-to-end journey: Box source ingestion → durable AWS work → verified facts → current evaluation → displayed opportunity. Check actual provider execution and label any fallback accurately.
3. Fix any failures, rerun the live journey and retain safe evidence of the successful retest. Offline mocks or the two existing fixture videos do not satisfy this gate.
4. Only then rehearse and record the final live demo. Do not publish or submit it without the separate authorization still required.

After those gates pass, keep the same three-minute structure and replace the two Settings sample actions with the approved live intake path. For a manual demonstration, use **Documents → Open Box inbox**, upload the approved payment/payroll document, then choose **Analyze inbox**; repeat with the approved coverage statement. The current primary action leads to Documents; it does not itself upload a file. Wait for each accepted source and current assessment before continuing.

A manual **Analyze inbox** run does not prove webhook delivery. Claim the webhook path only after a genuine Box upload event is authenticated, durably queued and correlated to the actual worker result. Show and label whichever path was verified; a crafted signed replay is a separate signature/replay test.

Replace the opening disclosure with an accurate statement of the approved live execution actually shown. Replace the closing integration sentence only after the corresponding live gates pass. Do not call a deterministic fallback a successful live model explanation. Keep the synthetic/historical disclosure, monthly-only 80% wording, unresolved payment match, eight annual unknowns and absence of an estimate in every version.

The original `tally-build-handoff.zip` and its exact contracts/PDFs remain unavailable. The present fixtures are reconstructed; neither recording establishes original-bundle parity. See the [submission checklist](submission-checklist.md) before preparing a final delivery.
