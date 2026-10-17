# Deployment and connection runbook

This is a review plan for connecting the verified local sample app to Box and AWS. It does not make the app production ready or authorize the commands below. P01 (Box AI), P02 (Bedrock), Linux ARM64 packaging, deployed IAM, and webhook delivery remain unverified. Original handoff reconciliation is still pending; see [provider limits](providers.md) and [packaging](packaging.md).

## Current position

The Mac build and offline tests work. AWS CLI is installed; the operator completed browser login and an STS identity check. That check identified the account root identity. Sign-in alone did not authorize more cloud work. The user subsequently explicitly approved a scoped temporary root-session fallback for deployment preparation, without creating root access keys. New IAM grants, persistent secret writes and Box operations remain pending; prefer a reviewed non-root identity when available. The read-only inventory found no Tally-named CloudFormation stacks, Lambda functions, or DynamoDB tables in `us-east-1`; this is not a complete account inventory or a reservation of resource names.

SAM CLI 1.169.0 is available in the verified official ARM64 runtime at `/tmp/tally-sam-cli-install/bin/sam`; no global installation was made. The allowlisted, credential-free container-build runner is `/tmp/tally-sam-build-zhcsm92e/run-local-build.sh`. OrbStack is stopped. Main Computer Use denied launching it with “Computer Use was not approved to use OrbStack”. Do not retry startup through CLI or another channel; manual launch/enablement or materially new approval is pending. The actual Linux ARM64 build remains NOT RUN. The Docker client is installed, but its selected OrbStack daemon socket is unavailable. No Linux ARM64 container build, deployment, or live provider inference has run. A model profile being ACTIVE does not establish invocation permission, entitlement, or successful output.

## What needs separate approval

| Step | Concrete decision before acting |
| --- | --- |
| Local tool setup | Temporary verified SAM CLI runtime is ready. OrbStack startup was denied by Computer Use; manual launch/enablement or materially new approval is pending, with no alternate startup retry. Image/dependency downloads and the actual build remain separate next steps. |
| AWS operator and IAM | Scoped temporary root-session deployment preparation is approved as a fallback; no root access keys. Resolve exact operations/targets and any reviewed non-root profile, deployment role/permissions, caller route policy and API secret-access change separately. IAM grants remain pending. |
| Box setup | Approved enterprise/account, app authentication/scopes, service-account identity, dedicated inbox, actual fixture file IDs, webhook, and any subscription or AI entitlement. |
| Secrets | Exact two secret ARNs, who creates/updates them through a secure channel, encryption choice, and permitted runtime readers. |
| Billable work | Currency amount, time window, services, maximum test calls, and stop condition. P01, P02, infrastructure, and a complete application smoke are distinct scopes. |
| Deployment | Artifact bucket/prefix, resource prefix, stack, exact change set, IAM capabilities, and data retention. |

Approval of code, login, or one smoke call does not approve these other steps. Keep `LiveProvidersEnabled=false`, `ApprovedLiveFlow=false`, and local fixture mode until the relevant gates are passed and the complete live flow is approved.

## Temporary AWS authentication

For a reviewed named non-root profile, the operator can use the following optional path. It does not erase the separately approved temporary root-session preparation fallback:

```sh
aws login --profile tally-approved
AWS_EC2_METADATA_DISABLED=true aws sts get-caller-identity --profile tally-approved
```

These are future operator steps for that named-profile path. Check the exact account/principal and authorized operation before continuing; stop for a wrong or unapproved target. Use of the existing temporary root session is limited to the explicitly approved preparation fallback, with no root keys or implicit IAM/secret/Box authority. `aws login` requires AWS CLI 2.32.0 or later, uses browser authentication, and refreshes temporary credentials for up to 12 hours subject to the principal's session duration. IAM Identity Center users should use their organization's SSO flow. No long-term access key is required. The CLI stores a local login cache; do not copy its contents, export credentials to the chat, or add them to `.env` or Git. [AWS login documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)

The proxy uses the installed JavaScript SDK credential provider chain. Explicitly select the reviewed profile with `AWS_PROFILE`; do not depend on whichever default session happens to be active. Its installed dependency includes login-session support, but the signed live proxy has not yet been exercised against AWS.

## Declared infrastructure and runtime access

[infra/template.yaml](../infra/template.yaml) declares **10 logical resources**:

| Resource | Count | Relevant behavior |
| --- | --- | --- |
| Node.js 22 ARM64 Lambda | 2 | API: 512 MiB/29 s. Worker: 512 MiB/120 s, reserved concurrency 2. |
| Lambda execution IAM role | 2 | Generated names; inline scoped policies. These are not operator login roles. |
| HTTP API | 1 | Default stage; four IAM routes and one Box signature route. |
| DynamoDB table | 1 | On-demand, encrypted; retained on deletion/replacement. One tenant state key. |
| SQS queue | 2 | Work queue plus DLQ; worker batch 1/window 0/concurrency 2; visibility 720 s; max receives 5. |
| Lambda log group | 2 | 14-day event retention; no log-group Retain deletion policy. |

SAM also generates native API/stage/integration/permission and event-source resources. The exact expanded resource count has not been verified. There is no VPC, secret, artifact bucket, budget, caller identity, or caller policy declared here.

| Route | Authentication |
| --- | --- |
| `GET /api/state` | AWS IAM/SigV4 |
| `PUT /api/profile` | AWS IAM/SigV4 |
| `POST /api/demo/analyze` | AWS IAM/SigV4 |
| `POST /api/demo/reconcile` | AWS IAM/SigV4 |
| `POST /webhooks/box` | No IAM authorizer; raw-body Box signature, timestamp, webhook ID and folder checks |

Execution roles use `dynamodb:GetItem`/`PutItem` on the one table and tenant key; exact queue actions; `logs:CreateLogStream`/`PutLogEvents` on precreated groups; and exact approved secret reads. Only the worker can invoke Bedrock, restricted to `us.openai.gpt-6-luna`, its default project, and the three US destination models through that profile. Read the full policy in the reviewed change set. A customer-managed secret encryption key would need a separately reviewed exact-key decrypt grant; none is currently declared.

### Two blocking IAM/configuration gaps

1. **Manual Box preflight cannot read its credential.** `createProductionRuntime` in [production.ts](../services/runtime/production.ts) calls `boxAndSources()` for manual inbox discovery/metadata. That invokes `getBoxCredentials()`. `ApiFunction` currently lacks `BOX_CREDENTIALS_SECRET_ARN`, and `ApiRole` can read only `BoxWebhookSignaturesSecretArn`. The worker alone receives the Box credential ARN and read grant. Manual Analyze therefore cannot pass its Box preflight as deployed from this template. A proposed fix must add that API environment reference and `secretsmanager:GetSecretValue` on the exact Box credential ARN, with explicit scope approval and focused tests. Do not combine the two secrets or substitute a wildcard. This document makes no IAM change. The webhook path enqueues without Box metadata/AI calls, so it does not remove the manual-intake gap.
2. **No local API caller is provisioned.** [signed-upstream.ts](../apps/local-proxy/signed-upstream.ts) signs the four allowlisted routes using `defaultProvider()` and service `execute-api`. SAM's execution roles do not give an operator permission to call the API. The selected caller needs approved authority for `execute-api:Invoke` on the four deployed method/path ARNs. A new caller-policy grant is still pending; temporary root-session preparation permission must not be silently expanded into a live application loop. Review literal resources such as `arn:aws:execute-api:us-east-1:ACCOUNT_ID:API_ID/$default/GET/api/state`, then the three corresponding method/path resources above. Replace placeholders from reviewed outputs; preserve the literal `$default` stage. Do not grant the whole account or expose AWS credentials to the browser. [HTTP API IAM requirements](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html), [ARN format](https://docs.aws.amazon.com/apigateway/latest/developerguide/arn-format-reference.html)

## Local build and validation

Run from `/Users/frank/mygit/Tally`, preserving `.data` and any active preview:

```sh
npm run typecheck
npm test
npm run check:infra
npm run build:lambdas -- --outdir /tmp/tally-host-review
```

Use a new empty output directory. Host receipts must say `deployable:false`; do not upload them. After separately approved tool installation and a working container daemon:

```sh
sam --version
docker info
sam validate --template-file infra/template.yaml --lint
sam build --template-file infra/template.yaml --use-container
```

The container build can download images/dependencies and run the pinned lockfile install; it is not an offline command. Require both functions' `packaging/verification.json` and `tally-lambda-artifact.json` to establish Linux ARM64, native ELF AArch64, successful packaged PDF parsing, and `deployable:true`. Local lint/schema checks are not proof of the full CloudFormation transform, deployment, or service permissions. [Build details](packaging.md), [SAM build reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-build.html)

## Box targets and secure secret handoff

The user or approved administrator should configure the app/account and review only the capabilities needed for this flow: file/folder read/download, Box AI extraction entitlement, and webhook management. Review the actual scopes with Box; do not enable broad enterprise access or impersonation by default. The current CCG implementation authenticates as the enterprise service account, not an arbitrary managed user. Confirm the returned user ID and share only the designated synthetic inbox with that identity. App authorization, scope changes, creating a folder/app, uploading files, and creating a webhook all require the relevant approval. [Box CCG setup](https://developer.box.com/guides/authentication/client-credentials/client-credentials-setup)

Record the actual numeric inbox ID, expected user ID, fixture A/B file IDs and versions, and webhook ID. Do not substitute the local fixture IDs. Keep originals immutable; the reconstructed PDFs do not prove USD currency in the live normalizer.

An approved owner enters secret values directly into the approved secure store, outside chat, recordings, shell arguments/history, source files, and agent tool output. Pass only complete `us-east-1` secret ARNs to SAM. Current accepted JSON shapes are:

- Box credentials: `access_token`, `expected_user_id`, optional `expires_at`; or `client_id`, `client_secret`, `enterprise_id`, `expected_user_id`.
- Webhook signatures: `primaryKey`, optional `secondaryKey`.

These are field names only, not sample values. The adapter rejects extra fields. Static access tokens are not automatically renewed; the CCG path obtains short-lived tokens without persisting them. Rotation and any paid entitlement still need an owner and approval. Tally's template creates no secrets.

After an approved endpoint exists, configure one folder-bound V2 `FILE.UPLOADED` webhook to the exact `BoxWebhookUrl` output. The current template requires a numeric webhook ID before deployment, so endpoint/webhook-ID ordering must be planned with the operator; no placeholder webhook is a verified connection. Keep live gates off while resolving this bootstrap sequence. Verify the signature keys and real delivery without exposing payload credentials. [Box webhook setup](https://developer.box.com/guides/webhooks/v2/create-v2)

## Review a change set before executing

Resolve both IAM/configuration gaps and all approved targets first. Deployment permissions must cover artifact upload, CloudFormation change-set review/execution, creation/configuration of the listed services, and passing only the two Lambda execution roles. The runbook is not a complete deployer policy; account policies, boundaries, encryption and existing resources need review.

The following **cloud-writing preparation** command is for a later approved upload/change-set step. Each `TALLY_REVIEWED_*` value must already identify an approved target; it contains no secret values. Use an existing approved artifact bucket rather than implicit bucket creation.

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

`--no-execute-changeset` uploads artifacts and creates a change set; it does not apply it. `CAPABILITY_IAM` acknowledges the two unnamed IAM roles. It is not human approval. Review the returned change-set ARN, account, region, additions/replacements/deletions, full IAM statements, resource names, secret ARN parameters, artifact provenance, and both disabled gates. Present that exact result for explicit approval **before execution**. A changed template or target needs a new reviewed change set; do not silently rerun without the no-execute flag. [SAM deploy reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html), [change-set inspection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets-view.html)

A stack deployed with the current live gates false intentionally returns `503 RUNTIME_UNAVAILABLE` for the AWS API runtime. That proves neither a broken model nor a successful live application. Enabling the gates is a separately reviewed stack update after P01/P02 and full-flow approval.

## Approved live verification and local proxy

First obtain the P01/P02 approval described in [providers.md](providers.md). P01 permits one three-field Box extraction against the exact reviewed synthetic file, with bounded identity/metadata/download checks. P02 permits one 350-output-token, one-turn, one-attempt Bedrock call with a 20-second deadline and deterministic fallback. Do not warm up, repair, repeat, subscribe, or increase the token/time budget merely to obtain a passing result. Record actual shape/usage and stop on a failed or unsupported result.

After approved deployment, passed gates, the reviewed caller policy, and explicit full-flow approval, start an **isolated** local proxy using the reviewed profile and exact API origin:

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

The user approved USD 10 total for deployment/tests, excluding Box purchases. Allocate that ceiling across concrete operations, set a call budget/time window and identify who can stop it before live work. The cap does not independently approve IAM grants, persistent secrets, OAuth or data flow. Include Box AI units/plan, Bedrock tokens, Lambda/API/SQS/DynamoDB/Secrets Manager/logs, artifact storage, and any subscription. No zero-cost promise is made. One-attempt SDK settings, concurrency 2, bounded PDFs and 350 output tokens limit individual operations; they are not a total-spend enforcement mechanism. AWS Budgets alerts can be delayed and usage can exceed a threshold before notification. Creating budgets/actions or changing limits also needs approval. [AWS Budgets timing](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)

For a reviewed shutdown, stop only the isolated live local proxy, then use the approved operator process to disable new Box deliveries and ingestion, examine pending work/DLQ without replaying it, and stop further provider execution. Gate changes, webhook updates and worker/event-source changes are cloud/Box writes requiring approval; no automatic kill switch or timer is installed.

Before deletion, inventory the exact stack, generated resources, artifact prefix, queues/DLQ, logs and retained table; confirm what evidence must be exported and what synthetic data may be discarded. Present the concrete deletion plan for approval. Stack deletion retains the DynamoDB table, but deletes queues and their pending messages and can delete the log groups despite their 14-day event retention setting. Existing secrets, Box app/folder/webhook, and the external artifact bucket are outside this stack and need separate owner review. Do not purge queues, delete retained data, rotate/revoke credentials, delete shared buckets, or run stack cleanup automatically. No cleanup has been performed by this runbook.
