# Lambda packaging

Both Lambda artifacts bundle their handler at the SAM Handler path:

| Function | Handler file |
| --- | --- |
| ApiFunction | `services/api/handler.mjs` |
| WorkerFunction | `services/worker/handler.mjs` |

The PDF parser resolves modules at runtime, so an esbuild bundle alone is insufficient. Each artifact includes the complete pinned `pdfjs-dist` package (including legacy parser, PDF worker, CMaps, fonts and WASM resources), `@napi-rs/canvas`, and the native canvas package for its build platform. The current parser disables WASM, XFA, rendering and network resource fetching. Resources remain packaged for a complete module distribution. Package licenses are retained.

## Verified Mac builds

Run from the repository:

```sh
npm run build:lambdas
```

This writes host artifacts to `.aws-sam/local/ApiFunction` and `.aws-sam/local/WorkerFunction`. Each build copies its artifact to a temporary directory outside the repository and starts a fresh Node process there. Verification checks:

- Handler import and every PDF/native dependency resolve inside the artifact.
- The native canvas binary header matches the build platform and provides `DOMMatrix`.
- The real packaged PDF parser reads the two-page interim initial batch and one-page interim coverage statement.
- Network access is blocked; no Lambda handler request, AWS call or Box call is made.

The verification receipt is stored in `packaging/verification.json`. These Mac artifacts are explicitly **not deployable**: their manifest says `deployable:false`, and their entry points reject a Lambda environment or a different operating system/architecture. The isolated check does not verify the AWS runtime or live provider permissions.

## Deployment-target Linux ARM64 build

The SAM functions use `BuildMethod: makefile`, `BuildArchitecture: arm64`, Node.js 22 and ARM64. After Docker and SAM CLI are available, the build-only command is:

```sh
sam build --template-file infra/template.yaml --use-container
```

This does not deploy infrastructure. SAM invokes `build-ApiFunction` and `build-WorkerFunction` with separate `ARTIFACTS_DIR` directories. Before installing dependencies or writing artifacts, the script requires an actual Linux ARM64 process. Inside that container, `npm ci --ignore-scripts --include=optional --no-audit --no-fund` installs the lockfile dependencies, including `@napi-rs/canvas-linux-arm64-gnu`; application install scripts never run. Esbuild is imported after that install so a clean SAM source copy needs no host `node_modules`.

The same isolated parser verification runs inside the container. A successful deployment-target receipt must report `linux/arm64`, an ELF AArch64 native binding, and `deployable:true`. No cross-platform flags can turn a Darwin artifact into a Linux artifact. A direct `make build-WorkerFunction` on macOS fails the platform guard.

Deployment-target container validation is currently **not run** on this Mac: SAM CLI is absent and the installed Docker client cannot connect to its daemon socket. Host artifact verification passed; Linux ARM64 native loading and SAM execution remain pending. No deployment or live provider calls have been approved or performed.

## Validation boundary

`npm run check:infra` checks the repository's intended resource counts, route authentication, IAM scopes, gates and queue settings offline. The temporary `cfn-lint` check also passed SAM resource-schema validation and Globals handling. This is **not a full SAM-to-CloudFormation transform** and does not establish the generated resource count, Linux native loading, deployment permissions, or a working provider connection. Do not describe it as deployed AWS validation or a successful SAM container build.

A real `sam build --use-container` receipt and a later reviewed CloudFormation change set are still required. Browser login/STS success is independent of package validation and is not permission to deploy or use the account root identity. Follow [deployment and connection review](deployment.md) for remaining blockers, caller/API credential gaps, approvals, secure secret handoff and cleanup.
