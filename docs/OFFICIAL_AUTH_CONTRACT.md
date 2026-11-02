# Official TrailBase password-auth contract

## Decision and version boundary

Mark chose to continue the CRUD/password-auth MVP on **official TrailBase0.35.8**, commit `05238c02b54aabb483e9f6224b5e014d40e88a5d`, with installed **trailbase JS0.14.3**. Document the limitations rather than adopt a private fork/capability. Private prototypes are historical private evidence only; they are not dependencies, a deployment recommendation or an active parity workstream.

This is the selected development contract, not a public SDK release, full Supabase auth compatibility or feature/release signoff. Native auth, access rules and issued JWTs remain native. Runtime proof is version/configuration-bound; current-source inspection does not certify a newer release. See the [MVP plan](MVP_PLAN.md), [test plan OA01–OA06](TEST_PLAN.md) and [progress ledger](progress.json). The [version-bound checkpoint evidence](evidence/official-only-auth-checkpoint.json) retains initial failures separately from fresh corrected verification; the [focused issue draft](upstream/TRAILBASE_GLOBAL_LOGOUT_ISSUE_DRAFT.md) is a handoff for baba/parent, not an external submission.

## Selected supported subset and honest failure behavior

| Operation | Contract over official0.35.8 |
| --- | --- |
| `signUp({email,password})` | One native registration with matching password repeat. Successful registration returns `{data:{user:null,session:null},error:null}`: no returned identity or authenticated session. A prompt to check mail does not prove delivery or confirmation. |
| Duplicate pending signup | Native HTTP409 remains an error, with null user/session. No automatic retry, success conversion, password replacement, deduplication or identity repair. Follow a previously delivered genuine link if available; do not repeatedly register. |
| SMTP failure | Native HTTP424 remains an error/no session. A pending identity can remain; a later registration retry can return409. This differs from the measured reference new-user transaction rollback. Neither a healthy control nor restored SMTP proves that the failed identity recovered. |
| Confirmation/resend | Confirm through the actual delivered native link, then explicitly log in. The SDK offers **no `auth.resend`**, account repair, password recovery or admin-confirmation flow. The native trigger's generic200 is not proof of a message or a supported recovery path for pending identities. No throttle bypass or timestamp edits. |
| `signInWithPassword` | Confirmed email/password; genuine native session credentials mapped to the narrow tested fields. Incorrect/unconfirmed/unknown credentials cannot become a session. No metadata/MFA/OAuth/phone or URL callback-session adoption. |
| `getSession` / persistence | Cached native credentials with awaited owned hydration/request-time renewal; cached claims are not a live authorization decision. Browser localStorage and Node per-client memory defaults; no cross-tab or cross-request shared-session guarantee. |
| `getUser` / `refreshSession` | Argument-free live native validation and guarded renewal. Native status can rotate credentials; refresh retains the actual original refresh credential. Native refresh401 clears authoritative state; transient failures remain visible. No Supabase status/timing/token-rotation parity claim. |
| Explicit `signOut({scope:'local'})` | Immediately clear current local generation/state, remove only owned storage and request native POST revocation of the captured refresh session. Require native200; errors remain observable. Signed-out idempotence performs no remote request and is not a new revocation receipt. |
| Default/global `signOut()` | Never silently local. Attempt the native Bearer-only GET with omitted cookies/manual redirects, clear owned local state, and report `AuthGlobalSignOutUnconfirmedError` for a delivered native response because it does not authenticate global revocation. Network/storage errors remain errors. Actual sessions may already be deleted; do not replay or infer rollback. No authenticated global-success capability is advertised. |
| Notifications | Only `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `SIGNED_OUT`, with defensive snapshots and owned unsubscribe/teardown. Local signout is not a server-wide event or revocation acknowledgement. |

Other constructor options/methods remain rejected or absent. In particular, private global-logout capability flags are not accepted, `scope:'others'` is unsupported, and no private registration/resend/receipt endpoint is used. The public root SDK's existing request/session policy is unchanged by this adoption decision.

Deleting refresh sessions does **not** instantly invalidate stateless access JWTs, prevent later login, generate immediate remote-device events or prove cancellation before a server-side DELETE. Another client/process can race with a global attempt. No client construction or local clearing alone proves that outstanding server work has stopped.

## Why global acknowledgement needs an upstream capability

In the pinned [GET logout handler](https://github.com/trailbaseio/trailbase/blob/05238c02b54aabb483e9f6224b5e014d40e88a5d/crates/core/src/auth/api/logout.rs), `Option<User>` permits unauthenticated handling. Only `Some(user)` deletes all that user's sessions. The response is otherwise the same redirect, or the same plain `logged out` result when there is no root/redirect. Consequently,303 or a followed health/root200 cannot distinguish authenticated deletion from an unauthenticated no-op. Browser manual redirects may be opaque; following redirects is not an acknowledgement solution.

The local POST is refresh-token-scoped, not an owner-wide substitute. The requested upstream improvement is a documented nonredirect, authenticated machine-readable outcome **after** owner-wide deletion, with errors/no writes for invalid callers and observable database failures. The issue draft requests behavior, not adoption/publication of a private implementation or Supabase protocol emulation.

## Existing issues and source interpretation

- [#298](https://github.com/trailbaseio/trailbase/issues/298) is the existing **v0.34.3** duplicate-pending/SMTP-resend report, currently closed as completed at the reviewed snapshot. Its comment discusses the missed uniqueness constraint and pending-user cleanup. Official0.35.8 adds pending uniqueness and returns409 on conflicting pending registration: do not repeat the old claim that two such requests both succeed. Closure does not prove complete pending-resend/SMTP recovery or Supabase return-shape parity.
- [#299](https://github.com/trailbaseio/trailbase/issues/299) is closed after clarification that SSE authorization lasts for the established connection. It is unrelated to this focused global-logout request and remains outside MVP.
- Source observations and runtime results are separate. Keep historical0.34.3 and private-prototype evidence under their original version/source/profile labels; never relabel it official0.35.8 proof.

## Accepted limitations versus regressions

The decision accepts the documented official auth capability boundary for MVP development; it does not turn incompatible behavior into parity, mark historical tests passed or waive security defects. The strict research job remains visible and may remain red.

| Existing research finding | Interpretation, not a test waiver |
| --- | --- |
| Pending duplicate and SMTP recovery assertions in stock/candidate scopes | Known G1 mismatch with desired recovery semantics; native409/424 are retained errors. The candidate SQL fixture is historical investigation, not the selected backend. New OA01/OA02 assertions separately test the actual official-safe boundary and complete state invariants. |
| Installed native client's late status/refresh resurrection | Upstream-client characterization, not the root adapter's selected session implementation. Root generation/storage guards have their own required tests. A resurrection in the adapter is a new regression, not an accepted limitation. |
| Reference unawaited async hydration notifications | Reference lifecycle characterization, not permission for the adapter to recover or expose a stale owner. Awaited initialization and ownership checks remain required. |
| Raw Fetch cross-origin native-header forwarding controls | Deliberately unsafe raw-transport controls, not an adopted logout strategy or an accepted SDK credential leak. Adapter omitted cookies/redirect refusal/zero foreign credential dispatch remain mandatory. |

At the preceding exact [CI41527412783](https://github.com/burggraf/trailbase-supabase/actions/runs/41527412783), these research groups total14 failures with preserved names/statuses; supported scopes and all setup/cleanup passed. That is historical evidence, not certification of this checkpoint. A changed/missing case, new failure, setup/cleanup failure, supported-path failure, data mutation or credential exposure must be investigated, never hidden behind this baseline. See [the exact prior CI audit](evidence/ci-1fda2ea-global-logout-state-checkpoint.json).

## Next official-supported MVP work

Complete a **real packed Node consumer** for the current CRUD/password-auth subset: install the unchanged official-backed SDK tarball into a clean consumer, genuinely confirm/login, persist/reload/refresh, perform owner-isolated CRUD, assert duplicate409/null signup user and local logout, and retain global uncertainty without claiming success. Existing `test:sdk:package` currently checks injected transport/types, while packed real browser flows are separate. This closes a concrete package/integration gap without adding methods, changing the backend or restarting fork parity. Full contract/security/coverage/release runners and maintainer signoff remain separate required work.
