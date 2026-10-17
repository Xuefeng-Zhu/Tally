# Tally infrastructure review

`template.yaml` is an AWS SAM template in JSON form. It is an interim implementation of the read build specification, pending reconciliation with the original handoff. No stack was created and no live provider gate was run. The user approved the existing temporary root session for bounded Tally deployment preparation. Runtime grants, persistent secret configuration and Box authorization remain pending specific approval.

The template defines two Node.js 22 Lambda functions, an IAM-authorized HTTP API, one DynamoDB table, one SQS work queue and a dead-letter queue. The API has exactly these routes:

| Method | Path | Authorization |
| --- | --- | --- |
| GET | `/api/state` | AWS IAM |
| PUT | `/api/profile` | AWS IAM |
| POST | `/api/demo/analyze` | AWS IAM |
| POST | `/api/demo/reconcile` | AWS IAM |
| POST | `/webhooks/box` | Public; application validates Box signatures |

The browser talks to the local signing proxy. AWS credentials belong in the local runtime or approved role; they are never sent to the browser. No CORS rule or wildcard HTTP route is created.

Worker timeout is 120 seconds, SQS visibility is 720 seconds, batch size is 1, batching window is 0, and messages reach the DLQ after five receives. Both the event source maximum concurrency and worker reserved concurrency are explicitly 2. SQS partial failure reporting is enabled.

The API can read/write the single tenant state item, enqueue jobs, read the exact existing Box credential and webhook-signature secrets, and write its precreated log group. The API uses the credential secret only for manual inbox listing and metadata preflight; its webhook path does not call Box. The worker can read/write that item, consume/enqueue jobs, read the existing Box credential secret, write its precreated log group, and invoke the user-selected `us.openai.gpt-6-luna` inference profile from `us-east-1`. Bedrock Runtime can route that profile to `us-east-1`, `us-east-2`, or `us-west-2`. There is no model or inference-profile wildcard, secret-write permission, VPC, or `CreateLogGroup` permission. Dynamo IAM grants `GetItem` and `PutItem` because this adapter uses a conditional aggregate compare-and-swap; transaction API names do not replace the underlying item permissions.

## Parameters still required before an approved deployment

- A unique `ResourcePrefix` (defaults to `tally`).
- `BoxCredentialsSecretArn`: an **existing**, approved Secrets Manager secret in `us-east-1`, with JSON fields `access_token` and `expected_user_id`.
- `BoxWebhookSignaturesSecretArn`: an **existing**, approved secret in `us-east-1`, with `primaryKey` and optional `secondaryKey`.
- Existing approved `BoxInputFolderId`. `BoxWebhookId` defaults to empty during disabled setup. A CloudFormation rule allows an empty ID only while **both** live gates are `false`; before either gate is enabled, supply the actual approved numeric webhook ID after creating the webhook against the real endpoint. Do not invent a placeholder ID. The production runtime independently rejects a missing or non-numeric ID before constructing provider clients.
- `LiveProvidersEnabled` defaults to `false`. Keep it disabled until explicit approval and provider checks P01/P02. `ApprovedLiveFlow` also defaults to false; both gates must be enabled deliberately. A template parameter does not constitute approval.

Secret values are not template parameters and are never output. The template creates no secrets. The role assumes AWS-managed secret encryption; a supplied secret encrypted under a customer-managed KMS key would require an explicitly approved, exact-key decrypt grant before use. The deployment region must be `us-east-1`. The local signing identity must have approved invocation access to the four IAM routes. The existing temporary root profile is the approved preparation identity; no new operator user or policy is being created. This template creates no users, access keys, or credential material.

## Local review

From the repository root:

```sh
node infra/check-template.mjs
```

This performs offline assertions for the infrastructure contract and does not contact AWS. It is not a CloudFormation/SAM transform or account validation. If AWS SAM CLI is installed, these additional local commands validate and build the template; neither deploys it:

```sh
sam validate --lint --template-file infra/template.yaml --region us-east-1
sam build --template-file infra/template.yaml --use-container
```

SAM invokes the repository Makefile in a Linux ARM64 build container. Each artifact contains its bundled handler at `services/api/handler.mjs` or `services/worker/handler.mjs`, plus the PDF parser resources and native dependencies. See [packaging verification](../docs/packaging.md) for the verified host artifacts and pending container check.

Offline `cfn-lint` schema/Globals checks passed using a temporary `/tmp/tally-cfnlint-venv` installation. This did not perform the full SAM transform. Official, checksum-verified SAM CLI 1.169.0 is staged in `/tmp/tally-sam-cli-install/bin/sam`. The Docker daemon is stopped, and Computer Use denied starting OrbStack, so the Linux ARM64 `sam build --use-container` remains unrun. Deployability against an actual account, account policy, secret access, model access, and live calls remain unverified. Executing runtime grants and persistent secret configuration still awaits the specific approval request.

Authoritative references checked while authoring:

- [SAM HTTP API IAM authorization](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-httpapi-httpapiauth.html)
- [SAM SQS event configuration](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-sqs.html)
- [SAM custom make builds](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/building-custom-runtimes.html)

## GPT-6 Luna profile authorization

The central `MODEL` configuration fixes the invocation ID to `us.openai.gpt-6-luna` and the source Region to `us-east-1`. Bedrock Runtime requires this cross-Region profile; the base `openai.gpt-6-luna` ID cannot be used for a direct in-Region call on that endpoint. The documented destination set from this source is `us-east-1`, `us-east-2` and `us-west-2`. See the [AWS GPT-6 Luna model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html).

The worker has only non-streaming `bedrock:InvokeModel` permission for these exact resources:

- The deployment account's `us-east-1` system inference profile: `arn:aws:bedrock:us-east-1:${AWS::AccountId}:inference-profile/us.openai.gpt-6-luna`.
- That account's existing `us-east-1` default project: `arn:aws:bedrock:us-east-1:${AWS::AccountId}:project/default`.
- The `openai.gpt-6-luna` foundation model ARN in each of the three documented destination Regions. These model grants require `StringEquals` on `bedrock:InferenceProfileArn` matching the exact profile above, so they do not authorize direct foundation-model invocation.

The model card requires permission on the inference profile and default project. AWS's [inference-profile prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html) additionally require the underlying foundation model in every destination Region and document the profile condition used here. `${AWS::AccountId}` is resolved by CloudFormation; no account lookup, credential discovery, project creation or SDK call is performed while authoring this template. The obsolete direct-model ARN parameter was removed.

The fixed `BedrockModelId` parameter accepts only the selected US profile. No Global profile, direct-model route or fallback model is configured. Runtime/provider verification and actual account policy evaluation remain pending. Live execution remains pending concrete target/authentication/data-flow permissions and P01/P02; no actual invocation is established by the ACTIVE profile metadata. The user-approved USD 10 total deployment/test ceiling excludes Box purchases and does not authorize IAM, OAuth or the data flow.
