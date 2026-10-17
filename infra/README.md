# Tally infrastructure review

`template.yaml` is an AWS SAM template in JSON form. It is an interim implementation of the read build specification, pending reconciliation with the original handoff. No stack was created, no account or credentials were configured, and no live provider gate was run.

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

The API can read/write the single tenant state item, enqueue jobs, read the existing webhook-signature secret, and write its precreated log group. The worker can read/write that item, consume/enqueue jobs, read the existing Box credential secret, write its precreated log group, and invoke the exact direct Qwen3 Next 80B A3B model in `us-east-1`. There is no inference-profile wildcard, secret-write permission, VPC, or `CreateLogGroup` permission. Dynamo IAM grants `GetItem` and `PutItem` because this adapter uses a conditional aggregate compare-and-swap; transaction API names do not replace the underlying item permissions.

## Parameters still required before an approved deployment

- A unique `ResourcePrefix` (defaults to `tally`).
- `BoxCredentialsSecretArn`: an **existing**, approved Secrets Manager secret in `us-east-1`, with JSON fields `access_token` and `expected_user_id`.
- `BoxWebhookSignaturesSecretArn`: an **existing**, approved secret in `us-east-1`, with `primaryKey` and optional `secondaryKey`.
- Existing approved `BoxInputFolderId` and `BoxWebhookId`.
- `LiveProvidersEnabled` defaults to `false`. Keep it disabled until explicit approval and provider checks P01/P02. A template parameter does not constitute approval.

Secret values are not template parameters and are never output. The template creates no secrets. The role assumes AWS-managed secret encryption; a supplied secret encrypted under a customer-managed KMS key would require an explicitly approved, exact-key decrypt grant before use. The deployment region must be `us-east-1`. The local signing identity needs a separately reviewed execute-api invocation policy for the four IAM routes; this template creates no users, access keys, or credential material.

## Local review

From the repository root:

```sh
node infra/check-template.mjs
```

This performs offline assertions for the infrastructure contract and does not contact AWS. It is not a CloudFormation/SAM transform or account validation. If AWS SAM CLI is installed, these additional local commands validate and build the template; neither deploys it:

```sh
sam validate --lint --template-file infra/template.yaml --region us-east-1
sam build --template-file infra/template.yaml
```

SAM esbuild bundles from the repository root so shared contracts/services are included. The source handlers are `services/api/handler.handler` and `services/worker/handler.handler`; SAM resolves the bundled handler path during its build. The model uses non-streaming Converse, authorized by `bedrock:InvokeModel` on `qwen.qwen3-next-80b-a3b` only.

Offline `cfn-lint` validation, including the SAM transform, passed using a temporary `/tmp/tally-cfnlint-venv` installation. SAM CLI is not installed, so `sam build` is still pending. Deployability against an actual account, account policy, secret access, model access, and live calls remain unverified. No deployment command is included because deployment is not authorized.

Authoritative references checked while authoring:

- [SAM HTTP API IAM authorization](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-httpapi-httpapiauth.html)
- [SAM SQS event configuration](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-sqs.html)
- [SAM esbuild configuration](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build-typescript.html)

Qwen3 Next 80B A3B is the final selection after the requested price/performance comparison. Model ID and exact ARN defaults match the central `MODEL` configuration; no other live model fallback is configured. All live calls remain blocked pending approval and P02.
