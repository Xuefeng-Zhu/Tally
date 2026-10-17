# Isolated OpenRouter verification

This optional local harness keeps fixture intake and fixture extraction while calling a real OpenRouter model for explanations. It does not connect Box, run Box AI, access AWS, change the production model, or establish full live E2E acceptance.

`services/providers/openrouter.ts` uses `openai/gpt-6-luna` through the OpenAI route, strict JSON schema, the existing grounded explanation validator, reasoning disabled, automatic prompt caching disabled, a 600-token output limit, a 30-second deadline, no retries, and two attempts per explainer closure. It reserves a conservative request cost before the network call; requests cannot exceed the $0.50 run cap. The configured rates are $0.10 per million input tokens and $0.50 per million output tokens. Usage, reported cost, actual provider/model, response ID, finish reason and safe failure codes are returned as receipts. Prompts, reasoning, credentials and raw transport envelopes are not retained.

Official verification sources (checked 2026-10-17):

- [Model and pricing](https://openrouter.ai/openai/gpt-6-luna)
- [OpenAI endpoint capabilities](https://openrouter.ai/api/v1/models/openai/gpt-6-luna-20260922/endpoints)
- [Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Provider routing and price limits](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Usage and cost accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)

The explicit `--approved-live-call` flag is a technical gate. Use this harness only within an authorized inference budget. Keep credentials in the existing external environment-loading path; never put them in the repository, command arguments, browser state, logs, receipts or patches. The server requires `OPENROUTER_API_KEY` in its environment and will not load or transfer a credential itself.

In a separate checkout with isolated dependencies, an existing approved environment file can be loaded directly by Node:

```sh
node --env-file="$HOME/.config/openrouter/credentials.env" --import tsx scripts/openrouter-verification-server.ts --approved-live-call
```

The server uses loopback ports 4346/5206 and fresh `.artifacts/openrouter/state.json`. Existing state is rejected at startup. `TALLY_ARTIFACTS_DIR` may select another isolated directory for an independently authorized run. Do not point this runner at a shared workspace or live application state. Leave `TALLY_EXPLANATION_ADAPTER` unset: the optional hook is injected into the local engine and does not change the production configuration contract.

The headless browser journey uses the existing synthetic sample controls, rather than Box uploads or real extraction:

```sh
node --require ./tests/offline-guard.cjs --import tsx scripts/openrouter-browser-verify.ts
```

The browser performs one sample A intake followed by one sample B intake. It checks the same card ID and successive revision, actual persisted model summaries, fixture extraction and OpenRouter provenance labels, the stated 80% monthly share, unresolved annual requirements and payment matching, accessible local evidence PDFs, reload persistence, duplicate-intake deduplication, connections labeling and mobile width. It records screenshots and JSON receipts without video. The ordinary test guard prevents external traffic from the browser script; the separately gated server owns the real inference calls.

For a follow-up run within the same budget, set `TALLY_OPENROUTER_PRIOR_RECEIPTS_PATH` to the earlier sanitized call-receipt JSON. Known provider-reported costs are counted directly. Uncertain, missing or invalid prior accounting fails closed; resolve the earlier uncertainty before authorizing another run. The explainer validates and includes `priorSpendUsd` in its cumulative budget.

After the approved verification, stop the server. A repeat live run consumes a new inference scope and must not be started merely to recapture screenshots. Saved state can be rendered through an ordinary offline local server without an explanation hook.

The initial 2026-10-17 GPT-4.1 nano verification made exactly two real requests, both HTTP 200 with validated explanations, totaling 5,280 input and 337 output tokens and provider-reported $0.0006628. Ten browser checkpoints, server restart persistence, 225 offline tests, TypeScript and the web build passed. A separate offline saved Box-response replay accepted no provenance and did not supply the fixture evidence used here. See the external result bundle for the exact receipts, source hashes and boundaries.

The user-requested Luna 6 rerun used exact `openai/gpt-6-luna` after a fresh public catalog/endpoint check. Both requests returned HTTP 200 and finish `stop`. After sample A, the existing semantic claim guard returned `EXPLANATION_CLAIM` and the app displayed its deterministic fallback; after sample B, the explanation was accepted. The same-card/evidence, honest mode labels, reload, duplicate-intake, mobile and offline server-restart checks passed, as did 228 offline tests, TypeScript and build. **The two-step model explanation acceptance did not fully pass.** Luna usage was 5,276 input and 418 output tokens, with provider-reported $0.0007366. Together with the earlier $0.0006628, cumulative test cost is $0.0013994. No retry or guard weakening occurred. Rejected generated text is not retained; the safe failure code alone cannot establish which phrase triggered the guard. See the separate Luna result bundle.

Offline diagnosis found that the prior rejected Luna wording was not retained, so its historical triggering phrase cannot be recovered. Independently constructed input `summary: "Payment matching remains unconfirmed.", what_changed: ""` is grounded in the saved A payment-match unknown, but the original regex matched `confirmed` inside `unconfirmed`. The isolated repair accepts only this exact complete output pair (case/outer whitespace tolerated), leaving the original conservative checks on all mixed, negated, framed and free-companion text. It does not add general negation parsing or claim that this caused the historical rejection.

Future `EXPLANATION_CLAIM` receipts can now include `claimDiagnostic` with a validator-owned rule code and redacted excerpt of at most160 characters. Claim-error metadata contains offsets/rule only; credential, URL, email, token and control-character redaction occurs before output slicing. Invalid/oversized output, provider-supplied fake metadata, raw transport data, prompts and reasoning are excluded. No prompt change or additional inference accompanied this offline repair.
