# Existing secret readers

This module contains local code and mocked verification only. No Box secret was read or created and no Box OAuth grant was issued. A separately approved AWS CLI browser login was completed by the user and STS identified a root session. The user subsequently approved that existing temporary session for bounded Tally deployment preparation; runtime IAM grants, persistent secret configuration and Box authorization remain pending specific approval.

`SecretProvider` selects only `BOX_WEBHOOK_SIGNATURES_SECRET_ARN` and `BOX_CREDENTIALS_SECRET_ARN` from a server-side environment snapshot. Each must be an exact full `arn:aws:secretsmanager:us-east-1:<12-digit-account>:secret:<name>-<six-character-suffix>` ARN; short names, alternate regions, prefixes, selectors and wildcards are rejected. Existing IAM policies must independently authorize those exact approved ARNs.

The default AWS reader uses `GetSecretValueCommand` with `VersionStage: AWSCURRENT`, one SDK attempt, and a ten-second overall abort signal. Importing or constructing it does not resolve credentials or contact AWS. Inject `reader` or `transport` for ordinary tests.

Webhook JSON has exactly `primaryKey` and optional `secondaryKey`. Both must be nonempty strings. The provider caches current keys for 30 seconds by default, at most 60 seconds. It deduplicates concurrent reads. A forced refresh drops the cached value before reading; failure never restores a previous key or serves an expired cache entry. That forced refresh is a provider capability verified offline, not current handler behavior. Production calls `getWebhookKeys()` once for a request, verifies that returned pair, and returns 403 on signature failure; it does not force-refresh or reverify automatically. Any future refresh-on-failure integration needs its own focused regression, and must never fall back to an older cached pair.

Box credential JSON has one of these shapes:

```json
{"access_token":"existing approved token","expected_user_id":"numeric service-account ID"}
```

```json
{"client_id":"existing client ID","client_secret":"existing client secret","enterprise_id":"numeric enterprise ID","expected_user_id":"numeric service-account ID"}
```

Existing access tokens may additionally include `expires_at` as a real UTC ISO timestamp. An expired token is rejected, and the cache never extends beyond that timestamp. Unknown expiry remains explicitly unknown. Unknown or mixed fields, binary values, empty values, malformed JSON, and payloads over 16 KiB are rejected with fixed error codes; provider messages and secret metadata are not exposed.

`createBoxTokenProvider` constructs an inert token supplier. Calling it requires the runtime's explicit live-flow approval before any secret read. The access-token branch returns the existing token. The CCG branch posts only to Box's fixed HTTPS OAuth endpoint using the enterprise subject for the service account, without redirects. Its token cache is bounded by both expiry and 60 seconds; credential rotation invalidates that cache. Expected-user identity must still be checked against Box `/users/me` by the caller before document access. No secret value belongs in logs, receipts, browser code, or committed configuration.

The CCG request follows [Box's official setup guide](https://developer.box.com/guides/authentication/client-credentials/client-credentials-setup). This code does not authorize an account change or live request.

The user-approved USD 10 total deployment/test budget excludes Box purchases and does not grant IAM, OAuth, secret-read or data-flow permission. The existing-account Tally app was created after specific approval, but authorization/configuration and service-account generation remain pending. No secret fetch or API call is established by that UI milestone. AI entitlement/quota remain unverified; neither the Individual label nor a missing Manage AI option proves denial.
