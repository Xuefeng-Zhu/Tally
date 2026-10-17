.PHONY: build-ApiFunction build-WorkerFunction

# SAM must run these inside its Node.js 22 Linux ARM64 build container.
# A host make invocation fails before installing dependencies or writing artifacts.
build-ApiFunction:
	node scripts/build-one-lambda.mjs ApiFunction --sam --artifacts-dir "$(ARTIFACTS_DIR)"

build-WorkerFunction:
	node scripts/build-one-lambda.mjs WorkerFunction --sam --artifacts-dir "$(ARTIFACTS_DIR)"
