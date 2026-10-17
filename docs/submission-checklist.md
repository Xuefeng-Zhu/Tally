# Tally — submission readiness checklist

Status snapshot: prepared on 2026-10-17. This is a working checklist, not a submitted entry. **No public sharing or hackathon submission is authorized.** Private repository work and a private push do not authorize publishing a video, inviting judges, completing a submission form or accepting event terms.

## Public event requirements

The [organizer's Luma page](https://luma.com/bqo9xii4) lists a Friday October 16 kickoff at 6pm, a Saturday October 17 submission cutoff at 1pm, and presentations at 2pm. These are the Seattle event's local times; use `America/Los_Angeles` when planning. Friday's 10pm venue closure is not the submission cutoff. The page requires work developed within the event, GitHub source, Box and AWS usage, teams of 2–4, and a three-minute presentation. Scoring weights are technical execution 50%, business value 30%, and presentation 20%.

The page currently says registration is closed. It does not establish this team's registration, judge access, submission form destination or video-hosting requirement. Verify those items from organizer-provided participant instructions without assuming that the Luma page itself is the submission form.

- [ ] Confirm this team's registration and participation eligibility.
- [ ] Confirm the team has 2–4 people and that all required participant details are available.
- [ ] Confirm the applicable deadline and time zone immediately before delivery.
- [ ] Review code/history against the event's build-period requirement.
- [ ] Obtain the actual organizer submission form or delivery instructions. **Form URL: pending.**
- [ ] Confirm the allowed video format, host, visibility and whether a video URL is required. **Submission video URL: pending.**

## Source code and judge access

Configured repository origin: [Xuefeng-Zhu/Tally](https://github.com/Xuefeng-Zhu/Tally). The project is intended to remain private. A local origin URL is not proof of the latest push or a judge's access.

- [ ] Verify the intended private repository, default branch and final commit match the reviewed build.
- [ ] Verify the latest authorized private push completed; record its commit hash.
- [ ] Review tracked files/history for credentials and unintended private material before pushing changes.
- [ ] Confirm how judges will access the private source repository. **Judge access is not verified.**
- [ ] Obtain explicit authorization before granting collaborator access or making the repository public. Neither action is covered by private-push authorization.
- [ ] Confirm a judge can open the approved source link using the intended access method.

## Current evidence and missing materials

Available now:

- A verified local fixture workflow with source links, same-opportunity updates, persistence and desktop/mobile checks. See [verification](verification.md).
- An earlier 84.00-second, 1440 × 900 fixture recording: `.artifacts/demo/tally-fixture-demo.mp4`, Library `libfile_9fa03e0fde308191948107b768f026b8`.
- A redesigned 84.24-second, 1440 × 1000 fixture recording: `.artifacts/redesign-demo/tally-redesign-demo.mp4`, Library `libfile_78a8814795b88191bc93bb05e6087c19`.
- An English [three-minute presenter script](demo-script.md). It is a rehearsal plan; a final three-minute live recording is not available.

Both existing recordings are fixture-only. Neither demonstrates actual Box ingestion, deployed AWS processing or a live Bedrock explanation. Library assets are not public video URLs.

- [ ] Obtain the original `tally-build-handoff.zip` / `tally-handoff`, including its exact contracts, configuration, expected fixtures and both PDFs.
- [ ] Validate the archive and reconcile the original materials against the clearly labeled interim reconstruction. **Original parity remains unverified.**
- [ ] Record the final source/PDF identities and selected model configuration without exposing credentials.

## Live integration and acceptance — not passed

Implemented adapters, mocked SDK transports and local fixture success do not establish the event's live Box/AWS usage requirement. See the [live E2E plan](live-e2e.md) and [verification matrix](verification-matrix.md).

AWS sign-in is complete. The parent operator reports a read-only STS check of a root principal in account ending **4085**. This records the user's existing login; it does not authorize future use of that root session or establish provider execution.

A **Tally app was created in the existing Box account** after specific app-creation and legal approval. Only the alternative-account signup was stopped; no new account or signup is needed. Configuration review is pending. The observed defaults are **App Access Only** with **Read/Write files** checked and **Manage webhooks** off. No **Manage AI** option was visible across the three reviewed permission categories. The service account has not been generated; Box indicates that occurs after **Authorize**. Do not change scopes, authorize the app, call Box APIs or fetch secrets without the required specific approval.

The **Individual** plan label and absent visible AI option do not establish an entitlement denial. Box AI entitlement and quota remain **unverified**. The [free Developer plan with 1,000 Box AI units](https://developer.box.com/guides/getting-started/free-developer-plan) is an official option to assess, not a requirement for another account or evidence of the current workspace's units.

- [x] AWS sign-in and the parent-reported read-only identity check completed.
- [x] The Tally app was created in the existing Box account under its specific creation/legal approval; its configuration remains pending review.
- [x] The user approved a **USD 10 total deployment-and-test budget**. Track cumulative spend within that ceiling; it does not approve Box plan purchases.
- [ ] Resolve the exact non-root runtime/deployer identity, targets and approved operations. The budget does not itself approve IAM changes, OAuth/scope changes, additional app creation or the proposed data flow. Do not infer these permissions from sign-in, code-edit or private-push authorization.
- [ ] Verify the intended existing Box identity, AI entitlement and available quota without exposing credentials; do not buy a plan or create another app/account implicitly.
- [ ] Complete and verify only the specifically approved Box inbox/app setup, scoped access and synthetic source documents.
- [ ] Pass P01 with the actual approved Box extraction. Review file/version identity, units, currency, references, unknowns and local source matching. See [provider gates](providers.md).
- [ ] Pass P02 with the user-selected Luna configuration on Bedrock. Verify actual output, token usage, deadline/fallback behavior and account access. A fallback must remain labeled as a fallback.
- [ ] If deploying Lambda, pass the Linux ARM64 package/container verification. The verified Darwin host artifacts are not deployable. See [packaging](packaging.md).
- [ ] Verify deployed authentication, least-privilege access, durable queue delivery and worker processing. If claiming the webhook path, retain a genuine Box-origin event, raw-byte authentication, durable acknowledgment and worker correlation; manual **Analyze inbox** success does not prove a webhook.
- [ ] Run the real payment/payroll-then-coverage application journey through Box and AWS. Confirm the same opportunity updates and all displayed source links resolve to the accepted content.
- [ ] Fix failures and repeat the live end-to-end test. Retain a safe receipt that distinguishes actual provider activity from fixtures and mocks.
- [ ] Reconcile deployment and test spend against the **USD 10 total** ceiling, including provider retries. Stop at the approved limit; cleanup or further purchases require their own authorized scope.

## Final presentation and recording

Required sequence: **integration → live end-to-end test → fixes and successful retest → final live recording**. Do not relabel either current fixture recording as live.

- [ ] Rehearse the [three-minute script](demo-script.md) with the actual UI labels and a stopwatch.
- [ ] Keep the current presentation explicitly fixture-based until the live acceptance checklist passes.
- [ ] In all versions, identify the fictional business and historical 2025 data.
- [ ] Describe 80% only as the stated employer share on the monthly coverage statement; keep payment matching unresolved.
- [ ] Show all eight annual requirements as unknown. Do not claim eligibility, savings, an approved credit or an annual estimate.
- [ ] Keep pending/attention states honest; do not narrate stale assessment details as current.
- [ ] After successful live retesting, record the final live take, verify full playback, duration, readable text and source/annual-review visibility.
- [ ] Check that no credentials, personal accounts, unrelated tabs or sensitive provider output appear in the recording.
- [ ] Obtain explicit authorization for the chosen video-sharing destination and visibility before upload/publication. Library upload is not equivalent to a judge-accessible submission URL.
- [ ] Verify the approved video URL opens for the intended judges. **This URL is currently pending.**

## Final handoff — separate approval required

- [ ] Assemble the reviewed project description, team details, approved GitHub source link and approved video link in a private draft.
- [ ] Resolve every required unknown above or disclose the limitation accurately.
- [ ] Ask the user to review that concrete draft and explicitly authorize the final external action.
- [ ] Submit only after that authorization. Do not accept new legal terms on the user's behalf without the required action-time confirmation.
- [ ] Save the actual organizer confirmation/receipt after a successful authorized submission. **No submission receipt exists today.**
