# Draft question: native SSE authentication lifetime after JWT expiry

**Not submitted.** This is a bounded lifecycle/semantics question, not a severity/CVE claim. All accounts, rows and backends are disposable owned fixtures. No tokens, identities, links, raw bodies or private logs are included.

## Environment

TrailBase v0.34.3 (`eab5039392a624736ab0c6a9f07f6793423dc979`), macOS arm64, Node 22.23.2, native owner-protected `todos` API with subscriptions enabled. An explicit fresh-depot test profile sets `auth_token_ttl_sec: 3`; production/default fixture configuration is unchanged.

## Reproduction

1. Register and genuinely confirm an owned user, then explicitly log in.
2. Open the real native `/api/records/v1/todos/subscribe/*` stream with a genuine current access JWT.
3. Confirm the token claims' actual `exp - iat` is three seconds and an ordinary protected HTTP read using that same JWT initially succeeds.
4. Keep the stream open. Wait under an 80-second bound until an ordinary raw HTTP read using the original JWT is denied, allowing the server's real clock-skew grace. No token editing, fake clock or logout substitute is used.
5. Through a separately refreshed writer of the same owner, create a new protected row.
6. Observed: the already established stream delivers the native INSERT rather than closing or sending a forbidden signal, although the original JWT no longer authorizes a new ordinary read.

The [strict lifecycle probe](../tests/expiry/expiry.test.ts) and [sanitized evidence](evidence/phase-a-native-expiry-node22.json) retain this failure against the desired compatibility requirement. Fresh writer access was verified; fixture cleanup passed. The [current diagnostics-source macOS report](evidence/phase-a-diagnostic-native-expiry-node22.json) and [Linux report](evidence/phase-a-ci-linux-safe-inventory-expiry.json) reproduce the same strict failure after successful pinned-image/loopback verification. Linux [run 37096946058](https://github.com/burggraf/trailbase-supabase/actions/runs/37096946058) at `84e1e0a` also passed 37 unit cases per supported Node version, 9 browser cases and fault cleanup; its full stock suite remains 45 passed/5 unrelated strict failures. These controls do not prove expiry policy parity with reference/browser clients or complete server stream-resource enforcement.

## Questions for upstream

- Is authentication intentionally connection-scoped for established SSE subscriptions, rather than revalidated against JWT expiry?
- What are the supported expiration/re-authentication/renewal semantics for SSE and WebSocket subscriptions?
- Can a server configuration enforce an observable close/forbidden signal at expiry without changing owner access rules?
- How should consumers coordinate logout/refresh-session revocation with existing stream lifetimes, independently of residual valid stateless JWTs?

Our proposed SDK lifecycle requirement is to stop local protected-event delivery and renew/re-authenticate explicitly, but a client-side close/timer is not server-side authorization enforcement. We will not claim otherwise or weaken owner rules. Please clarify intended guarantees before we finalize a compatibility contract.

This report does not claim foreign-owner row delivery: native owner isolation passed in its separate fixture. The reference Supabase foreign DELETE-key limitation is a different issue. The existing server signup issue [#298](https://github.com/trailbaseio/trailbase/issues/298) is also unrelated. This draft remains local pending maintainer direction on submission.
