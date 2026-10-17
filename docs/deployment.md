# Deployment and connection runbook

This runbook records the disabled AWS deployment and the remaining work to connect the verified local sample app to Box. The stack and exact runtime grants are deployed, and both Lambda artifacts passed direct Linux ARM64 packaging probes. P01 (Box AI), P02 (Bedrock), webhook delivery and the real application E2E remain NOT RUN. Original handoff reconciliation is still pending; see [provider limits](providers.md) and [packaging](packaging.md).

## Current position

The Mac build and offline tests work. The user explicitly approved the existing temporary root browser session for bounded Tally deployment and tests within USD 10, including the exact two Lambda-only runtime roles and two separately created secret containers for human-entered values. The reviewed disabled stack reached `CREATE_COMPLETE` with 17 deployed resources. A dedicated private artifact bucket uses all four public-access blocks, bucket-owner-enforced ownership and AES256 encryption. No root access keys or new IAM user were created. Two approved normal-application credential/token attempts have completed. Credential AWSCURRENT retrieval, JSON-format and expected-service-user checks passed internally through `SecretProvider`/`createBoxTokenProvider`. The first token attempt returned the generic sanitized `box_ccg_authentication_failed` code. The latest diagnostic retry received an actual token API HTTP 400 response with allowlisted OAuth error `invalid_client`; the latest result is not a transport failure. No specific credential field or enterprise setting is identified as the cause. The next human check is the matching OAuth Client ID and Client Secret of the new Tally app, rather than its numeric console App ID. Fresh nonsecret UI review confirmed CCG, App Access Only and Authorized/Enabled. `/users/me` was not reached; actual Box identity remains NOT VERIFIED. The signature secret was last observed empty and was not read. No raw credential, response or provider message was inspected, copied or logged. Both live gates remain false; no AI/file/folder/webhook call or real provider E2E has run. The temporary diagnostic helper passed seven offline mock tests; these are separate from the unchanged 154-test repository suite and made no production code changes. No further Box retry is permitted until the human confirms correction.

SAM CLI 1.169.0 is available from a verified temporary official ARM64 runtime; no global installation was made. Its Linux ARM64 container build remains NOT RUN. OrbStack startup was denied by Computer Use, and no alternate startup was attempted. Do not retry through another channel. Deployment instead used immutable cross-prepared ZIPs followed by direct Lambda runtime verification: both passed actual handler import, ELF/native loading, DOMMatrix and packaged PDFs [2, 1] on Linux ARM64, Node.js 22.23.2 and glibc 2.34. Original handlers were restored and code hashes stayed unchanged. No Box AI extraction or Bedrock inference has run; an ACTIVE profile or successful packaging probe does not establish provider entitlement or output.

## Approved scope and remaining prerequisites

| Step | Current scope and remaining prerequisite |
| --- | --- |
| Local tool setup | Temporary SAM CLI is ready. Container build was not run; OrbStack startup remains denied, with no alternate retry. Direct Lambda packaging verification passed. |
| AWS operator and IAM | Existing temporary root session and exact two Lambda-only runtime roles were approved; their scoped grants are deployed. No new operator identity, access key or broad IAM policy was created. Actual signed application/provider behavior remains unverified. |
| Box setup | New Developer Tally app is Authorized/Enabled, App Access Only, with file read/write, Manage AI and webhooks saved; signature-request scopes are disabled. Service account exists and is empty. Dedicated folder, files and V2 webhook remain pending. AI scope is not entitlement proof. |
| Secrets | Exact runtime readers are deployed; the two approved containers were created separately and are outside the stack. The approved credential read/internal format checks passed; CCG token acquisition failed before `/users/me`. Box identity and signature-key entry remain unverified/pending. No agent credential lookup is allowed. |
| Billable work | USD 10 total deployment/test ceiling; no Box purchase. Preserve bounded test calls and stop on unresolved entitlement, prerequisites or remaining allowance. P01/P02 and real E2E have not run. |
| Deployment | Reviewed disabled stack and private immutable artifacts are deployed. Future changes must match the approved scope and retain the documented data-retention behavior. |

The explicit approvals above are recorded separately from login or code approval. Keep `LiveProvidersEnabled=false`, `ApprovedLiveFlow=false`, and local fixture mode until remaining human signature-key entry, real Box targets, normal-runtime credential/identity verification and the required provider checks are complete. Scope expansion still requires a new decision.

## Temporary AWS authentication

The existing reviewed temporary browser profile is the approved operator path. If that session expires, the human can reauthenticate the same approved profile without creating long-term keys:

```sh
aws login --profile "$TALLY_REVIEWED_PROFILE"
AWS_EC2_METADATA_DISABLED=true aws sts get-caller-identity --profile "$TALLY_REVIEWED_PROFILE"
```

Check the exact account/principal and authorized operation before continuing; stop for a changed or unapproved target. The temporary root session is limited to the explicitly approved Tally scope and USD 10 ceiling. Human-only secret entry and the remaining Box prerequisites still apply. `aws login` requires AWS CLI 2.32.0 or later, uses browser authentication, and refreshes temporary credentials for up to 12 hours subject to the principal's session duration. IAM Identity Center users should use their organization's SSO flow. No long-term access key is required. The CLI stores a local login cache; do not copy its contents, export credentials to the chat, or add them to `.env` or Git. [AWS login documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)

The proxy uses the installed JavaScript SDK credential provider chain. Explicitly select the reviewed profile with `AWS_PROFILE`; do not depend on whichever default session happens to be active. Its installed dependency includes login-session support, but the signed live proxy has not yet been exercised against AWS.

## Declared infrastructure and runtime access

[infra/template.yaml](../infra/template.yaml) declares **10 logical resources**:

| Resource | Count | Relevant behavior |
| --- | --- | --- |
| Node.js 22 ARM64 Lambda | 2 | API: 512 MiB/29 s. Worker: 512 MiB/120 s; no reserved concurrency. |
| Lambda execution IAM role | 2 | Generated names; inline scoped policies. These are not operator login roles. |
| HTTP API | 1 | Default stage; four IAM routes and one Box signature route. |
| DynamoDB table | 1 | On-demand, encrypted; retained on deletion/replacement. One tenant state key. |
| SQS queue | 2 | Work queue plus DLQ; batch 1/window 0; single-source maximum concurrency 2; visibility 720 s; max receives 5. |
| Lambda log group | 2 | 14-day event retention; no log-group Retain deletion policy. |

SAM also generates API/stage/permission and event-source resources; the completed stack contains 17 resources. The separate private artifact bucket and two separately created secret containers are outside this template. No VPC, budget, caller identity or caller policy is declared here. The worker reservation was removed because the account concurrency pool is 10 and AWS requires 100 to remain unreserved before allocating a reservation. The single SQS source remains capped at 2; direct invocations or additional sources are not covered by that cap, and API/worker share the account pool. Probes were sequential. [AWS concurrency requirements](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html), [SQS source scaling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)

| Route | Authentication |
| --- | --- |
| `GET /api/state` | AWS IAM/SigV4 |
| `PUT /api/profile` | AWS IAM/SigV4 |
| `POST /api/demo/analyze` | AWS IAM/SigV4 |
| `POST /api/demo/reconcile` | AWS IAM/SigV4 |
| `POST /webhooks/box` | No IAM authorizer; raw-body Box signature, timestamp, webhook ID and folder checks |

Execution roles use `dynamodb:GetItem`/`PutItem` on the one table and tenant key; exact queue actions; `logs:CreateLogStream`/`PutLogEvents` on precreated groups; and exact approved secret reads. Only the worker can invoke Bedrock, restricted to `us.openai.gpt-6-luna`, its default project, and the three US destination models through that profile. Read the full policy in the reviewed change set. A customer-managed secret encryption key would need a separately reviewed exact-key decrypt grant; none is currently declared.

### Runtime access and remaining caller verification

1. **The manual-preflight credential gap is resolved.** `ApiFunction` receives `BOX_CREDENTIALS_SECRET_ARN`, and `ApiRole` has only `secretsmanager:GetSecretValue` for the exact credential and webhook-signature secret ARNs. The worker reads the credential secret only. The approved change is deployed and covered by focused tests. The approved normal-runtime credential-secret read and internal format checks passed, but token acquisition failed before `/users/me`; actual Box identity/access remains unverified. The webhook path enqueues without Box metadata/AI calls.
2. **The local signing path remains unverified.** [signed-upstream.ts](../apps/local-proxy/signed-upstream.ts) signs the four allowlisted routes using `defaultProvider()` and service `execute-api`. It uses the existing approved temporary operator profile; no new caller user or policy was created. Runtime roles do not confer operator API authority. Keep the reviewed caller scope limited to the four deployed method/path resources and never expose AWS credentials to the browser. For a separately reviewed scoped caller, preserve the literal `$default` stage in resource patterns such as `arn:aws:execute-api:us-east-1:ACCOUNT_ID:API_ID/$default/GET/api/state` and the three corresponding routes above. Actual IAM-signed application requests remain unverified. [HTTP API IAM requirements](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html), [ARN format](https://docs.aws.amazon.com/apigateway/latest/developerguide/arn-format-reference.html)

## Local build and validation

Run from the repository root, preserving `.data` and any active preview:

```sh
npm run typecheck
npm test
npm run check:infra
npm run build:lambdas -- --outdir /tmp/tally-host-review
```

Use a new empty output directory. Mac host receipts must say `deployable:false`; do not upload them. The deployed cross-prepared ZIPs were verified directly in Lambda with their immutable local ZIP hashes bound to AWS code hashes and fresh runtime receipts. Their embedded manifests remain unchanged with `deployable:false`; do not flip the flag or repackage tested bytes. This is distinct from a SAM container-build receipt.

The following optional container path remains NOT RUN and must not be used to bypass the denied OrbStack startup. It requires a separately permitted working daemon:

```sh
sam --version
docker info
sam validate --template-file infra/template.yaml --lint
sam build --template-file infra/template.yaml --use-container
```

The container build can download images/dependencies and run the pinned lockfile install; it is not an offline command. Require both functions' `packaging/verification.json` and `tally-lambda-artifact.json` to establish Linux ARM64, native ELF AArch64, successful packaged PDF parsing, and `deployable:true`. Local lint/schema checks are not proof of the full CloudFormation transform, deployment, or service permissions. [Build details](packaging.md), [SAM build reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-build.html)

## Box targets and secure secret handoff

The new Developer Tally app is Authorized and Enabled, with App Access Only, file read/write, Manage AI and Manage webhooks persisted; signature-request scopes are disabled. The earlier app and Default App are untouched. The service account exists and is empty. Within the approved setup scope, the next steps are a dedicated synthetic inbox, its permitted service-account access, fixture files and one V2 webhook. No broad enterprise access or managed-user impersonation is configured. The CCG implementation authenticates as the service account; verify its actual identity before use. The AI scope does not establish effective entitlement or available units. [Box CCG setup](https://developer.box.com/guides/authentication/client-credentials/client-credentials-setup)

Record the actual numeric inbox ID, expected user ID, fixture A/B file IDs and versions, and webhook ID. Do not substitute the local fixture IDs. Keep originals immutable; the reconstructed PDFs do not prove USD currency in the live normalizer.

Both approved secret containers exist outside the stack. The approved normal-application credential read/internal format checks passed, but token acquisition failed with a sanitized code before actual identity verification. Signature-key entry remains pending; that secret was last observed empty and was not read. No manual agent inspection of raw values occurred. The human enters credentials and webhook signing keys directly into that secure store, outside chat, recordings, shell arguments/history, source files and agent output. No agent credential lookup is allowed. Pass only complete `us-east-1` secret ARNs to SAM. Current accepted JSON shapes are:

- Box credentials: `access_token`, `expected_user_id`, optional `expires_at`; or `client_id`, `client_secret`, `enterprise_id`, `expected_user_id`.
- Webhook signatures: `primaryKey`, optional `secondaryKey`.

These are field names only, not sample values. The adapter rejects extra fields. Static access tokens are not automatically renewed; the CCG path obtains short-lived tokens without persisting them. Rotation and any paid entitlement still need an owner and approval. Tally's template creates no secrets.

The disabled stack already provides the endpoint. After creating the dedicated folder, configure one folder-bound V2 `FILE.UPLOADED` webhook to the reviewed `BoxWebhookUrl` output. The template permits an empty webhook ID only while both live gates are false; bind the actual numeric ID before enabling either gate. The new app’s folder and webhook are not yet created. Verify human-entered signature keys and real delivery without exposing credentials or recording the endpoint/identifiers in committed docs. [Box webhook setup](https://developer.box.com/guides/webhooks/v2/create-v2)

## Review a change set before executing

The initial reviewed change set has been executed successfully with both gates false and only the approved runtime roles. For subsequent updates, review actual targets, artifact hashes, encryption and resource changes before execution. The existing deployment scope covers only the stated Tally resources and exact grants; this runbook does not expand it.

The following **cloud-writing preparation** command is the optional SAM route for a later permitted container-built artifact; it is not the path used for the current deployment and must not be run against a nonexistent `.aws-sam/build` output. The current stack used reviewed immutable ZIPs, AWS CLI packaging and a reviewed CloudFormation change set. Each `TALLY_REVIEWED_*` value must identify an approved target and contain no secret values. Use the existing approved artifact bucket rather than creating another one. A disabled update may leave the webhook variable empty only while both gates are false.

```sh
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --profile "$TALLY_REVIEWED_PROFILE" --region us-east-1 \
  --stack-name "$TALLY_REVIEWED_STACK" \
  --s3-bucket "$TALLY_REVIEWED_ARTIFACT_BUCKET" \
  --s3-prefix "$TALLY_REVIEWED_ARTIFACT_PREFIX" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "ParameterKey=ResourcePrefix,ParameterValue=$TALLY_REVIEWED_RESOURCE_PREFIX" \
    "ParameterKey=BoxCredentialsSecretArn,ParameterValue=$TALLY_REVIEWED_BOX_SECRET_ARN" \
    "ParameterKey=BoxWebhookSignaturesSecretArn,ParameterValue=$TALLY_REVIEWED_WEBHOOK_SECRET_ARN" \
    "ParameterKey=BoxInputFolderId,ParameterValue=$TALLY_REVIEWED_BOX_FOLDER_ID" \
    "ParameterKey=BoxWebhookId,ParameterValue=$TALLY_REVIEWED_BOX_WEBHOOK_ID" \
    "ParameterKey=LiveProvidersEnabled,ParameterValue=false" \
    "ParameterKey=ApprovedLiveFlow,ParameterValue=false" \
  --no-execute-changeset
```

`--no-execute-changeset` uploads artifacts and creates a change set; it does not apply it. `CAPABILITY_IAM` acknowledges the two unnamed IAM roles. It is not human approval. Review the returned change-set ARN, account, region, additions/replacements/deletions, full IAM statements, resource names, secret ARN parameters, artifact provenance, and both disabled gates. Check that exact result against the approved scope before execution. A scope expansion needs a new decision; changed templates or targets need a fresh reviewed change set. Do not silently rerun without the no-execute flag. [SAM deploy reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html), [change-set inspection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets-view.html)

A stack deployed with the current live gates false intentionally returns `503 RUNTIME_UNAVAILABLE` for the AWS API runtime. That proves neither a broken model nor a successful live application. Enabling the gates is a separately reviewed stack update after P01/P02 and full-flow approval.

## Approved live verification and local proxy

Check each planned P01/P02 request against the approved bounded scope described in [providers.md](providers.md), after human secret entry and actual-target verification. P01 permits one three-field Box extraction against the exact reviewed synthetic file, with bounded identity/metadata/download checks. P02 permits one 350-output-token, one-turn, one-attempt Bedrock call with a 20-second deadline and deterministic fallback. Do not warm up, repair, repeat, subscribe, or increase the token/time budget merely to obtain a passing result. Record actual shape/usage and stop on a failed or unsupported result.

After human secret entry, actual Box targets, passed provider gates and confirmation of the approved full-flow scope, start an **isolated** local proxy using the existing reviewed profile and exact API origin:

```sh
AWS_PROFILE="$TALLY_REVIEWED_PROFILE" \
AWS_EC2_METADATA_DISABLED=true \
TALLY_EXECUTION_MODE=aws \
TALLY_API_ORIGIN="$TALLY_REVIEWED_API_ORIGIN" \
TALLY_APPROVED_LIVE_FLOW=true \
TALLY_LOCAL_PORT=4321 TALLY_WEB_ORIGIN=http://127.0.0.1:5176 \
TALLY_DATA_PATH=/tmp/tally-approved-aws-review.json \
npm run dev:api
```

Check that those ports are unused first; keep the working 4318/5173 fixture pair untouched. In a separate terminal, use `TALLY_WEB_PORT=5176 TALLY_API_PROXY_TARGET=http://127.0.0.1:4321 npm run dev:web`. The browser calls only loopback; the server signs four fixed routes. The origin must be the deployed `https://API_ID.execute-api.us-east-1.amazonaws.com` with no path/query/credentials. This is a local operator demo, not a public multi-user authentication system.

Within the approved call budget, verify profile save, manual intake, source provenance, stable opportunity ID, expected evidence update, one real webhook delivery, duplicate idempotency, and all eight unresolved annual checks. A `403` can indicate caller IAM/signing; a `503` can indicate gates/configuration/secrets; inspect a correlation ID and redacted logs before considering another chargeable attempt. Do not print raw secrets, tokens, full provider responses or source PDFs into shared logs.

## Spend controls and shutdown

The user approved USD 10 total for deployment/tests, excluding Box purchases. Allocate that ceiling across concrete operations, set a call budget/time window and identify who can stop it before live work. The two exact runtime roles, separately created secret containers and App Access Only setup have separate explicit approval; the spending cap does not expand those permissions or permit agent secret lookup. Include Box AI units/plan, Bedrock tokens, Lambda/API/SQS/DynamoDB/Secrets Manager/logs, artifact storage, and any subscription. No zero-cost promise is made. One-attempt SDK settings, the single SQS source maximum 2, bounded PDFs and 350 output tokens limit individual operations; they are not a total-spend enforcement mechanism. AWS Budgets alerts can be delayed and usage can exceed a threshold before notification. Creating budgets/actions or changing limits also needs approval. [AWS Budgets timing](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)

For a reviewed shutdown, stop only the isolated live local proxy, then use the approved operator process to disable new Box deliveries and ingestion, examine pending work/DLQ without replaying it, and stop further provider execution. Gate changes, webhook updates and worker/event-source changes are cloud/Box writes requiring approval; no automatic kill switch or timer is installed.

Before deletion, inventory the exact stack, generated resources, artifact prefix, queues/DLQ, logs and retained table; confirm what evidence must be exported and what synthetic data may be discarded. Present the concrete deletion plan for approval. Stack deletion retains the DynamoDB table, but deletes queues and their pending messages and can delete the log groups despite their 14-day event retention setting. Existing secrets, Box app/folder/webhook, and the external artifact bucket are outside this stack and need separate owner review. Do not purge queues, delete retained data, rotate/revoke credentials, delete shared buckets, or run stack cleanup automatically. No cleanup has been performed by this runbook.
