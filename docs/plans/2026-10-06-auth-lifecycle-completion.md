# CRUD/auth lifecycle completion

Approved target remains the narrow CRUD + password-auth SDK MVP, not PostgREST/GoTrue HTTP services. Preserve G1/G7 failures, pins, private upstream isolation and all historical evidence; no deployment, repin, compatibility exception or signoff.

## L1-19 logout contract and pre-code checks

- Validate global-default/local-only options and arity before any side effect. Invalidate local generation/memory immediately, serialize deletion of only the owned storage key, and never allow held hydration/login/refresh/status/storage work to revive cleared state or remove a newer login.
- Local logout makes one native POST containing only the captured refresh credential; cookies omitted, redirects refused, exact native 200 acknowledgement required. Repeated signed-out calls are request-free. Observe errors and cleanup failures; storage-removal failure remains fail-closed.
- Default global makes the native GET with bearer only, omitted cookies and manual redirects. No redirect follow, health acknowledgement or substitution with local logout. The pinned backend cannot provide authenticated global acknowledgement: return a recognizable unconfirmed-revocation error even when the native operation revoked sessions. Never claim G7 is fixed.
- A newly decoded stale login must not install; revoke only its own distinct refresh credential once and surface cleanup failure without modifying newer/sibling state. Missing/undecodable replies cannot establish cleanup.
- U19/S01/S07/S08: scopes/transport, no-session, network/HTTP/redirect/opaque replies, owned storage and failure latch, held hydration/response/JSON/write, newer successful/failed login, concurrent calls and exact cleanup credential. T19 public result/scope checks. I19/C19: actual local-versus-global two-session revocation, unrelated user and full row invariants, reference scopes and strict native unconfirmed result. Packed three-browser equivalents required.

## L1-20 and L1-18 remaining lifecycle

- Four events only: INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT. Defensive snapshots, initialization before transitions, asynchronous/reentrant-safe delivery, callback failure isolation, idempotent unsubscribe and no callbacks after removal. No cross-tab synchronization claim.
- Explicit autoRefreshToken:false retains no timer behavior. Background/default behavior must own and clean timers/listeners and use the same generation-guarded single flight, with deterministic clock and real-expiry tests. Do not advertise defaults until their complete controls pass.

## Product and verification boundary

- Keep existing single-record data contract; no richer-query, Storage, Realtime or migration additions.
- Extend the existing todos example rather than scaffold another app. Genuine signup/mail/login/CRUD/reload/refresh/logout in Chromium/Firefox/WebKit through the packed package; no fake primary success responses.
- Run static/types, mixed units, packed consumer, relevant SDK auth/refresh/data/database/constraints and browser scopes at immutable final source. Add focused real/reference cases with each feature. Missing coverage/security/shared-contract/CI/release layers remain explicit, not replaced by focused checks. Only maintainer signs off. Update README and authoritative ledger with exact attempts, failures and restart steps.
