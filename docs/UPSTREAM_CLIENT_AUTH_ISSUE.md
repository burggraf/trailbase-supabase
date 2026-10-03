# Draft: trailbase@0.14.3 late auth responses restore logged-out client state

**Draft only, not submitted.** All observations use disposable owned resources, genuine confirmation/login and the installed package. Tokens, credentials, links, bodies and raw diagnostics are omitted.

## Environment and evidence

- `trailbase@0.14.3`, TrailBase v0.34.3 (`eab5039392a624736ab0c6a9f07f6793423dc979`), Node 22.23.2, macOS arm64.
- [Real lifecycle tests](../tests/phase-a/auth-lifecycle.test.ts), [sanitized report](evidence/phase-a-auth-lifecycle-node22.json): eight passed, two strict native late-response failures; owned cleanup passed.
- [Installed distribution](https://unpkg.com/trailbase@0.14.3/dist/index.js): `refreshAuthToken` and `checkCookies` unconditionally commit a completed response through `setTokenState`.

## Reproduction (both refresh and status validation)

1. Log in a confirmed owned account with a fresh installed native client.
2. Start `refreshAuthToken({force:true})`, or separately `checkCookies()`.
3. At the documented transport boundary, forward the real request to the local server and receive/buffer its genuine successful response. Hold only delivery of that response to the SDK.
4. Call and await `client.logout()`. Cached user/tokens are cleared.
5. Directly retry the original refresh token against the real native refresh endpoint; it is denied with HTTP 401.
6. Release the previously received response and await the pending SDK operation.
7. Observed: cached user/tokens are restored. Required regression: the client must remain locally logged out.

No JWT/session/response is fabricated and no system auth schema is changed. This demonstrates installed-client stale-state resurrection, not broken server refresh revocation or privilege escalation. A still-valid stateless access JWT and a live refresh session are separate concepts.

## Expected behavior

Do not commit an auth response belonging to an earlier local auth epoch after logout. Consider the same requirement for automatic constructor status validation, refresh, cookie hydration and account switching. Keep transport errors observable without logging credentials. The reference installed Supabase client discards the held late refresh with `AuthRefreshDiscardedError` in the same disposable fixture.

Related characterization, not additional severity claims: native simultaneous forced refreshes make two real requests; native constructor hydration exposes cached claims before async validation; native logout clears local state but returns `true` on an injected undelivered transport failure while remote refresh remains usable.

## Reproduction repository

See [setup](../README.md); run `npm run test:unit` then `npm run test:phase-a -- auth-lifecycle` in this repository. The two native late-response assertions intentionally remain failing. The current SDK compatibility project has no production SDK implementation or signed-off wrapper workaround.
