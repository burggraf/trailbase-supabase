# Bounded L1-17 live user slice (pre-code)

Only argument-free getUser. Explicit existing auth flags; no timers/default-true/logout/events. Prior 7b23133b controls and reviewer5fb are historical after source edits, not signoff.

## Verified source/capability and approved policy

Pinned auth/api/status.rs GET /api/auth/v1/status accepts optional Tokens; missing/forged/expired access is swallowed by optional tokens extractor and returns all-null200. Bearer-only branch re-encodes original claims and cannot prove live session/user. Both Authorization Bearer and Refresh-Token select reauth_with_refresh_token (auth/tokens.rs): current unexpired _session lookup, then current _user with unverified_email NULL, mint JWT from DbUser. Native client checkAuthStatus merely tests truthy token; adapter must validate more strictly. Native client headers also include CSRF but source GET tokens extractor requires only bearer/refresh; no CSRF needed. Supabase installed getUser/_getUser awaits initialization/useSession and does live GET/user; no cached user success, missing session error. Reference removes some missing-session failures; no native parity/global revocation inference.

Supervisor approved genuine status rotation install, including DB email, only after captured baseline+generation guarded successful persistence. Exact200 own exact three authenticated native fields, non-null genuine JWT/CSRF and unchanged captured genuine refresh; canonical same ID. Anonymous triple-null => sanitized AuthSessionMissingError, all failures preserve prior credentials; status401 never terminal-clears (refresh401 policy remains exclusive). Safe JSON/cookies omit/redirect error and owned cancellation; no arbitrary JWT argument. Return only canonical id/email, no invented metadata. GET rotates access credentials per native protocol, not a Supabase token side-effect parity claim.

## Proportional matrix before implementation

- U17/type: explicit flags/no overload, request-free missing cache, network each live call, own exact native fields/JWT claims, canonical narrow fresh DB-email output/defensive clone; status null/malformed/private parse/changed ID or refresh/expired returned JWT/non200/redirect preserve memory/disk; bearer+refresh only for status, data remains bearer only.
- U17/S04/S08 races: hydration and expired shared renewal, status fetch/JSON held versus new login or same-generation pendingB commit, status rotation versus fresh refresh, queued/held storage write and successful/failed newer login; no stale user/install/state clobber or hidden retry. Cancellation and parser privacy/failure latch.
- P17: 32 distinct UUID identity/native mapping vectors and missing-one-at-a-time inherited required fields; no repeated seeds, descriptor restoration.
- I17/DB/S17 owned real sdk-auth case: genuine signup/confirmation/login; raw anonymous200, live DB email edit (owned parameterized SQL) and mapped genuine updated email; forged cached signature, actual session revocation, owned identity deletion and expired access response; no cached-user success, exact SQL postconditions and independent cleanup. Expiry-native already owned shortTTL profile via sdk-refresh; no fake clock/proxy/backend configuration changes. Parent launches, not worker.
- C17: real reference live getUser/missing/owned deletion/session expiry observations remain required; preserve G1/G7 failures. Source comparison is not parity proof.
- E17/package: existing packed install/build/types and browser data/auth controls must refresh; packed live-user/browser tamper/revocation flows and complete security/fault/coverage/CI/release are still missing, not N/A.

Signoff requires current-source independent review, all real owned controls/postconditions and missing applicable layers/reference/browser/maintainer approval. Checkpoint target: RED then unit/types/build/check, exact actual runtime/source ledger, no jobs/lock/staging; parent performs fixtures.
