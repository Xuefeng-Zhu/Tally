# Costs and approvals for the first live check

Pricing checked October 17, 2026. Amounts below are USD planning estimates before taxes, free allowances, account credits, discounts and existing usage. They are not spending caps or permission to run a live operation.

## Current authorization

Local code, documentation, offline checks and the separately authorized private GitHub code/history push may proceed. The user subsequently approved USD 10 total for deployment/tests, with no Box purchases, plus a scoped temporary root-session fallback for AWS deployment preparation without root access keys. New IAM grants, persistent secret writes, Box authorization/OAuth and the full data flow remain pending; the cap is not blanket permission for those operations.

The user has completed AWS sign-in, and a read-only STS identity check succeeded. Sign-in established the session; the later explicit instruction, rather than login alone, approved the scoped temporary root-session preparation fallback. It does not approve arbitrary future root use or the separately pending operations. Keep account identifiers, email addresses, credentials and credit balances out of this document and committed configuration.

P01 Box AI, P02 Strands/Bedrock and the deployed application flow remain unverified. Flags such as `--approved-live-call`, `LIVE_PROVIDERS_ENABLED` and `TALLY_APPROVED_LIVE_FLOW` are technical gates, not human approval. The proposal below stays pending until the user explicitly approves its exact scope.

## Proposed call envelope

The scope stays with the synthetic bakery, historical tax year 2025, rule set `us-federal-irc45r-2025-v1`, and the two reviewed PDF sources. Each PDF must be at most 1 MiB and two pages. No unrelated files, tenants or model substitutions are included.

| Phase | Box extraction API requests | Luna requests |
| --- | ---: | ---: |
| P01: inspect fixture A response shape | 1 | 0 |
| P02: explain the prepared synthetic context | 0 | 1 |
| One fresh A-then-B application flow | 2 | Normally up to 2 |
| Combined plan | 3 | Normally 3; allow at most 4 in the approval plan |

The Box smoke also performs identity, metadata and bounded PDF reads. The full flow adds ordinary Box/AWS API activity. Box can perform internal model work behind one extraction API request; this table does not count or price that internal work. Repeated intake, queue redelivery, changed file versions or an operator rerun can add requests. Stop on a failed gate and review the safe receipt rather than rerunning automatically. A fourth Luna request is a planning allowance, not an automatic retry authorization.

The current Luna adapter uses `us.openai.gpt-6-luna` through Bedrock Runtime US geographic inference from `us-east-1`: one attempt, one turn, no tools, a 20-second client deadline and `maxTokens: 350`. Its input is `fixtures/interim/strands-smoke-input.json`; it sends selected values and deterministic findings, not the complete PDF bytes. The prompt, system text and schema total 8,153 UTF-8 bytes before request wrappers. This byte count is not a measured token count or a universal input limit.

## Published rates and illustrative arithmetic

For short-context Standard US geographic Luna inference, AWS lists $0.11 per million input tokens and $0.55 per million output tokens. Cache reads are $0.011/M and cache writes $0.1375/M; the US inference premium is already included. Converse supports implicit caching; the estimate assumes no cache discount. [AWS Luna model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html)

Assuming 10,000 input tokens and 350 billed output tokens per request:

`(10,000 × $0.11 + 350 × $0.55) / 1,000,000 = $0.0012925`

Three Luna requests would be about **$0.00388**; four about **$0.00517**. Actual usage must come from the approved call receipt. Reasoning effort is unspecified in the current adapter; AWS documents medium as the model default. Hidden reasoning is billable output, so 350 is not a promise of 350 visible JSON tokens. An incomplete response or deterministic fallback after a provider response can still incur a charge. [OpenAI reasoning and cost guidance](https://developers.openai.com/api/docs/guides/reasoning)

| AWS service | Published small-volume rate in us-east-1 |
| --- | --- |
| HTTP API Gateway | $1/million requests; 512 KB request increments. [Pricing](https://aws.amazon.com/api-gateway/pricing/) |
| Lambda ARM64 on-demand | $0.0000133334/GB-second plus $0.20/million requests. [Pricing](https://aws.amazon.com/lambda/pricing/) |
| DynamoDB Standard on-demand | $0.625/million write request units, $0.125/million read request units, $0.25/GB-month storage. Item size, consistency and transactions affect units. [Pricing](https://aws.amazon.com/dynamodb/pricing/) |
| Standard SQS | $0.40/million requests; actions and empty receives count, with 64 KB payload increments. [Pricing](https://aws.amazon.com/sqs/pricing/) |
| Secrets Manager | $0.40/secret-month, prorated hourly, plus $0.05/10,000 API calls. Existing secrets already have their storage charge; referencing them does not create a second copy. [Pricing](https://aws.amazon.com/secrets-manager/pricing/) |
| CloudWatch Logs Standard | $0.50/GB ingestion and $0.03/compressed GB-month retention. [Pricing](https://aws.amazon.com/cloudwatch/pricing/) |
| S3 Standard deployment artifacts | $0.023/GB-month, $0.005/1,000 PUT/COPY/POST/LIST and $0.0004/1,000 GET requests. [Pricing](https://aws.amazon.com/s3/pricing/) |
| SAM | No additional SAM fee; deployed resources are billed separately. [FAQ](https://aws.amazon.com/serverless/sam/faqs/) |

An illustrative infrastructure envelope is about **$0.02**, assuming 100 small HTTP requests, 100 Lambda invocations averaging 1 GB for 10 seconds, 1,000 DynamoDB write units, 1,000 read units, 1,000 SQS requests, 0.01 GB of logs, 100 secret reads and 20 artifact PUTs. These are assumed usage quantities, not enforceable limits. This excludes AI, retained storage, outbound transfer and tax.

The template uses 512 MiB Lambdas, one on-demand table, standard queues and 14-day log retention, with no VPC or provisioned concurrency. Storage persists after requests stop. An enabled SQS event mapping also polls an empty queue: assuming two to five long polls every 20 seconds gives roughly $0.10–$0.26/month per mapping before allowances. Actual polling varies; setting maximum concurrency disables Lambda's optimization to two concurrent polls. [AWS SQS scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)

## Box unit consumption remains unverified

Extraction APIs consume the organization's shared Box AI Units. Business and Business Plus units are available for purchase; published monthly included allocations are 1,000 for Enterprise, 2,000 for Enterprise Plus and 20,000 for Enterprise Advanced. Remaining entitlement, the effective extraction agent/model tier and the contract must be checked for the actual account. Included units can avoid an incremental cash charge while still consuming shared capacity. [Box usage and entitlements](https://docs.box.com/en/box-ai/understanding-ai-units-in-box), [Box Extract API availability](https://support.box.com/hc/en-us/articles/48235161543955-Announcing-Box-Extract-Jan-2026)

The public [Platform pricing card](https://www.box.com/pricing/platform) displays $10, a 1,000 AI Units/month minimum purchase and an annual commitment, without an explicit per-unit or per-1,000-unit suffix. Do not derive a per-extraction price from it. The linked [AI Units consumption table](https://cloud.app.box.com/v/box-ai-units-consumption-table) could not be read through the research tools. No operation-level rate has been verified. The application does not pin a Box extraction agent tier, and file/page limits alone do not establish the unit charge. Confirm the account's terms before stating a combined Box/AWS dollar bound; no purchase or upgrade is proposed here.

## Input and packaging limitations before live acceptance

The original handoff ZIP/PDFs remain unavailable. The reconstructed interim PDFs are immutable and contain dollar symbols without an explicit `USD` token. Live normalization requires independently cited, source-supported USD currency before promoting money to supported evidence. It may correctly leave these amounts unknown or needing review. Do not infer currency from the business profile, weaken validation, rewrite the existing PDFs or claim live parity with the fixture goldens. A separate USD-bearing synthetic asset would need to be identified, reviewed and approved as a new live target. See [provider details](providers.md).

A successful HTTP response is not a passed provider gate. P01 must establish actual field/absent-value/reference/confidence shapes, units, source identity and excerpt/page correspondence; P02 must return a complete validated explanation with usage. Neither establishes eligibility or a credit estimate. The current Mac Lambda artifacts are explicitly nondeployable; Linux ARM64 container packaging and isolated native/PDF verification must pass before deployment can be proposed. See [packaging](packaging.md) and [verification](verification.md).

## One future approval checklist

The USD 10 total ceiling and temporary root-session preparation fallback are approved. Prepare the remaining concrete proposal only for unresolved operations/targets and the phases the user wants to run:

- Identify the already approved AWS account privately, source Region `us-east-1`, exact Luna inference profile/model resources and the synthetic context file. Resolve access and quota questions without creating permissions or accepting paid terms implicitly.
- Identify the actual Box inbox, fixture A/B file IDs and versions, expected service-account identity, approved PDF hashes and whether a new USD-bearing asset is required. Confirm API access, the remaining shared AI Units, effective extraction tier, consumption rule and any incremental charge. Record these targets privately rather than committing account IDs or secrets.
- State the request envelope above, its allocation within the approved USD 10 total ceiling, which ordinary API reads are included, whether existing secret retrieval or a token request is separately approved, and the stop conditions. If Box's charge cannot be bounded, obtain a confirmed entitlement/contract bound before proposing a hard total.
- If a full AWS flow is requested, review the exact SAM change set: `TallyHttpApi`, `ApiFunction`, `WorkerFunction`, `ApiRole`, `WorkerRole`, `StateTable`, `WorkQueue`, `DeadLetterQueue`, `ApiLogGroup` and `WorkerLogGroup`, plus the exact S3 artifact bucket/objects and generated API/Lambda/SQS bindings. Limit secret access to the two existing approved ARNs; list any missing IAM or OAuth changes separately. No new credential, secret, subscription, NAT gateway or broader access is implied.
- Obtain explicit human approval for the named reads, paid calls, deployment and any IAM/OAuth/secret changes included in that proposal. Smoke approval alone does not approve deployment or a recurring/live application loop. A provider flag, sign-in, private push or this document does not replace approval.
- After approval, execute only those phases, stop on gate failure or the approved request/spend boundary, retain receipts without secrets, and report actual usage, unresolved validation and any retained resources. Arrange shutdown/removal of temporary resources within the approved scope; do not leave an unattended ingestion loop running.

Proceed only within the already approved local work and scoped temporary root-session deployment preparation. New IAM grants, persistent secret writes, Box/OAuth setup and the full live provider flow remain pending their exact permissions and targets; the USD 10 ceiling does not approve Box purchases. The Docker build additionally awaits manual OrbStack launch/enablement or new approval after the explicit Computer Use startup denial; do not retry startup through another channel.
