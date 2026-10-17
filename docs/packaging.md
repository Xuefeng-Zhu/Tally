# Lambda packaging

## Current verification status

The approved disabled AWS stack is CREATE_COMPLETE with 17 resources. Both immutable cross-prepared ZIPs passed actual Linux ARM64 Lambda packaging probes, including handler import, native loading and real PDF page counts `[2,1]`; both original handlers were restored and CodeSha256 remained unchanged. Both live gates remain false. This direct-runtime verification is separate from the SAM container build, which remains NOT RUN after OrbStack startup was denied. See [current verification](verification.md) and the [verification matrix](verification-matrix.md) for the hash-bound evidence and remaining live gates.

The separate Box authentication gate remains failed after two approved normal credential/token attempts; the latest actual token response was HTTP 400 `invalid_client`, and `/users/me` was not reached. This does not invalidate packaging proof or establish Box identity. See [current verification](verification.md) for the safe receipt boundary and next human credential check. Further Box retry is paused until human correction confirmation.

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

The SAM functions use `BuildMethod: makefile`, `BuildArchitecture: arm64`, Node.js 22 and ARM64. Official SAM CLI 1.169.0 is available locally. Once Docker startup is permitted and its daemon is available, the build-only command is:

```sh
sam build --template-file infra/template.yaml --use-container
```

This does not deploy infrastructure. SAM invokes `build-ApiFunction` and `build-WorkerFunction` with separate `ARTIFACTS_DIR` directories. Before installing dependencies or writing artifacts, the script requires an actual Linux ARM64 process. Inside that container, `npm ci --ignore-scripts --include=optional --no-audit --no-fund` installs the lockfile dependencies, including `@napi-rs/canvas-linux-arm64-gnu`; application install scripts never run. Esbuild is imported after that install so a clean SAM source copy needs no host `node_modules`.

The same isolated parser verification runs inside the container. A successful deployment-target receipt must report `linux/arm64`, an ELF AArch64 native binding, and `deployable:true`. No cross-platform flags can turn a Darwin artifact into a Linux artifact. A direct `make build-WorkerFunction` on macOS fails the platform guard.

Deployment-target container validation remains **NOT RUN**: the Docker daemon is unavailable and Computer Use explicitly denied starting OrbStack. No alternate startup route was attempted. The separately approved direct Lambda probes verified Linux ARM64 native loading using immutable cross-prepared artifacts. Their original `deployable:false` manifests were not rewritten after verification; hash-bound sidecars record the actual runtime result. No provider call or live E2E is established by either packaging path.

## Validation boundary

`npm run check:infra` checks the repository's intended resource counts, route authentication, IAM scopes, gates and queue settings offline. The temporary `cfn-lint` check also passed SAM resource-schema validation and Globals handling. This is **not a full SAM-to-CloudFormation transform** and does not itself establish the generated resource count, Linux native loading, deployment permissions, or a working provider connection. The later actual disabled deployment and Lambda probes provide separate evidence; they do not turn the static check into a successful SAM container build.

A `sam build --use-container` receipt remains absent. The approved direct-runtime route and reviewed disabled CloudFormation deployment are recorded in [current verification](verification.md); neither certifies Box/Luna connectivity. Browser login/STS success alone confers no deployment or root-session permission; the later explicit temporary-session and scoped setup approvals are recorded separately. Follow [deployment and connection review](deployment.md) for secure credential handoff, remaining live-flow gates and cleanup.
