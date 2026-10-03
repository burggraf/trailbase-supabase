# Detailed Level 1 implementation plan

**Status: Phase A proof harness in progress; no compatibility SDK feature is signed off.** See [PROGRESS.md](PROGRESS.md) and [progress.json](progress.json) for actual work/test evidence and restart steps. Scope remains the minimal SDK described in [PLAN.md](../PLAN.md). This document adds implementation detail and proof requirements; it does not promote the deferred richer-query, Storage, OAuth, migration-CLI, or gateway features into the first release.

Read [RESEARCH.md](RESEARCH.md) for verified documentation/source observations and unresolved gates. Read [TEST_PLAN.md](TEST_PLAN.md) for every feature's test cases and signoff requirements. All feature IDs below must remain traceable from plan → tests → CI evidence → compatibility documentation.

## 1. Release contract

### Application-facing subset

- `createClient<Database>(url, key?, options?)`; the TrailBase key is optional and carries no authorization. On Supabase migration supply the real publishable key.
- `.from(apiName).select()` / `.select('*')` with awaited results containing `data` and `error`.
- `.insert(oneRecord)`; `.update(values).eq(primaryKey, value)`; `.delete().eq(primaryKey, value)`. Default success has `data: null`; mutation `.select()` is unsupported.
- Read predicates `.eq/.neq/.gt/.gte/.lt/.lte`, AND composition, declared scalar fields only. Null comparison must not be silently translated to equality; `.is()` is deferred.
- `.order(column, { ascending })`, chained ordering over the approved non-null scalar domain; `.limit(n)` and inclusive `.range(from, to)` within the 1000-row initial cap.
- Read `.single()` / `.maybeSingle()`; apply cardinality to the query's actual bounded result, never insert an implicit `.limit(1)`.
- Email/password `.auth.signUp`, `.signInWithPassword`, `.getSession`, `.getUser`, `.refreshSession`, `.signOut` with global default and explicit local scope.
- Supporting `.auth.onAuthStateChange()` for `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `SIGNED_OUT`, with subscription cleanup. No recovery/OAuth/MFA events are promised.
- `.channel(name).on('postgres_changes', { schema: 'public', table, event }, callback).subscribe(statusCallback?)`, `.unsubscribe()`, `.removeChannel()`. One table binding per channel; `INSERT/UPDATE/DELETE/*` only.

Supported constructor options: `db.schema: 'public'`, `global.fetch`, and the tested `auth.persistSession`, `auth.autoRefreshToken`, `auth.storageKey`, `auth.storage` subset. Browser defaults persist/refresh; Node defaults use per-client memory rather than shared browser storage. `detectSessionInUrl` may only be explicitly false; no URL grant adoption. Other options must be rejected, not ignored. A compact TrailBase-only table mapping is bootstrap configuration and is removed/replaced during the backend switch, not application query logic.

### Honest compatibility limits

1. Signup returns null user/session on TrailBase because native registration supplies no user identity. **G1 approval is required.** The common application must only inspect signup success/error and explicitly log in after email verification.
2. Supported user fields are real `id` and `email` plus provable session fields (`access_token`, `refresh_token`, `token_type`, `expires_at`, `expires_in`, `user`). The narrow user type must not masquerade as a complete Supabase `User` with invented timestamps/metadata.
3. Foreign-key/user/UUID and boolean conversions use declared field mappings. Unsupported large integers, implicit date coercions, arbitrary BLOBs/JSON operators, and nullable/collation-sensitive ordering are outside the portable domain.
4. Default mutation result bodies can match; RLS no-op/error and missing-row errors may differ. Evidence and a documented G3 decision are mandatory. Do not fake success to hide a denied write.
5. Realtime payloads promise only approved common fields. No prior full UPDATE record, actual commit timestamp, durable replay, exactly-once delivery, or full Supabase event object is promised.
6. Native sessions/tokens remain native: no Supabase JWT issuer/claim/rotation emulation. A client-side session is not a server authorization decision.

The successful common application flow must work unchanged after replacing the imported factory and backend/bootstrap configuration. Known exceptions must appear in documentation and typed interfaces, not only tests.

## 2. Implementation shape

Keep **one TypeScript package**. Start with a public entry point, a small client/query adapter, field/result mapping, an auth/session adapter, and a channel adapter. Split files only when their responsibilities become real; do not introduce plugin interfaces or an abstract multi-backend production framework.

- Runtime dependency: the pinned official `trailbase` client where it passes characterization.
- Native HTTP gaps: global/local logout error reporting, server-validated user status, zero-limit handling if needed, and robust authenticated SSE if the installed parser fails. Native client session/refresh behavior also needs characterization; if it cannot honor the signed-off ownership/race/disabled-refresh contract, use native HTTP for the affected path rather than depend on private internals. Keep gaps inside the adapter, not a new gateway.
- Development tools: TypeScript; Vitest with V8 coverage/fake timers; Playwright for actual browser E2E; pinned official Supabase SDK and CLI as test oracles. These are justified test dependencies, not public SDK runtime dependencies.
- One tiny browser `todos` application doubles as the E2E/migration example. No production UI framework is required; use accessible native forms/buttons.
- Backend provisioning scripts and fixture SQL/config stay under tests. A tiny test-only factory switches between the two actual SDK imports; this is not a production backend abstraction.

Proposed layout as implementation lands, **not scaffolding to create now**:

```text
src/                         SDK implementation and declarations
examples/todos/               one portable browser application
tests/
  unit/                      pure logic and mocked upstream boundaries
  types/                     compile-positive and compile-negative consumers
  integration/               installed SDK → real TrailBase
  contract/                  common assertions → TrailBase and real Supabase
  e2e/                       Playwright → application → real backends
  fixtures/                  migrations, access rules/RLS, mail, bootstrap
  package/                   npm-packed clean-consumer checks
```

Actual files and commands must be added together with their tests. Phase A now has executable harness commands; their exact limited scopes are in [PROGRESS.md](PROGRESS.md). Do not treat these upstream/browser infrastructure probes as the future SDK's full-suite commands or scaffold the remaining layout without implementation.

## 3. Ordered work packages

Every package includes its tests in the same change. **No phase can be signed off by mocks alone.** See the feature matrix in [TEST_PLAN.md](TEST_PLAN.md) for the exact case families.

### Phase A — Freeze the contract and build the proof harness

**Features: L1-27; decisions G1–G7.** Track work packages as A01–A06 in [progress.json](progress.json); only the maintainer can sign them off.

1. Pin baseline versions/checksums and the complete backend service/version manifest; choose package name/license/runtime targets.
2. Bring up a disposable native TrailBase server, local Supabase stack, and local SMTP inbox. Configure confirmations on both backends, protected APIs/RLS, aligned row caps, and realtime publication.
3. Apply fixture migrations/config from a cold start. Test setup/cleanup, isolated user namespaces, forbidden production targets, health checks, and unconditional teardown.
4. Characterize the installed TrailBase SDK and official Supabase SDK for the seven research gates before implementing around assumptions. Record raw sanitized results separately from adapter results.
5. Record approved contracts and deviations. Unresolved faithful-mapping requirements remain blockers; do not smuggle privileges or Level 2 work into the SDK.
6. Add package scripts and required CI jobs for unit/coverage, types, fixture/database tests, integration, shared contracts, browsers, security/faults, and packed consumers. Initially fail/incomplete features remain explicitly tracked, not claimed as support.

**Signoff:** a fresh checkout can provision and tear down both local backends without hosted credentials, execute real characterization tests, and produce versioned artifacts. G1–G7 have an evidence-backed decision/owner before the relevant feature can be marked supported. Harness failures cannot be reported as skipped tests.

### Phase B — Client, types, mappings, and results

**Features: L1-01 through L1-04.**

1. Validate URL/protocol/options and expose a Supabase-shaped factory. Keep unsupported options visible and test injected fetch/CORS behavior.
2. Consume a small compatible `Database.public.Tables[name].Row/Insert/Update/Relationships` type subset and read-only `public.Views` rows; maintain distinct insert/update/read types and nullable cardinality outputs. Accept ordinary generated schema shapes without implementing relationship queries, a PostgREST type parser, or a generic schema generator.
3. Use a compact, explicitly supplied API/table mapping with primary key, known columns/types/nullability, UUID columns, and boolean columns. Validate it against fixture/backend schema; reject unmapped tables, fields, and invalid semantic values. Do not assume the key is always `id` or grant browser admin access.
4. Convert UUID bytes/base64 ↔ canonical UUID only for declared columns and user IDs; integer 0/1 ↔ boolean only for declared boolean fields. Keep values, filters, returned records, auth IDs, and realtime records consistent.
5. Normalize success/failure boundaries. Queries/auth resolve their documented error envelopes; constructor/builder/channel unsupported argument validation throws a named unsupported/validation error before side effects. Async transport/stream failures must remain observable. TypeScript exclusions do not replace runtime validation for JS consumers.
6. Define execution semantics using the reference oracle: construction is lazy; awaiting triggers execution; repeated awaits and subsequent builder calls follow the chosen documented contract. In particular, no accidental duplicate insert, shared-query contamination, or untested memoization assumption.

**Signoff:** all four feature families pass unit, type, real integration, and applicable common-contract/browser checks. Semantic conversions and unsupported validation are covered on success and failure paths. No forged Supabase-only fields.

### Phase C — Query and CRUD vertical slice

**Features: L1-05 through L1-13.**

1. Implement list reads and a read-only view fixture. Return arrays/empty arrays without exposing native cursor envelopes; respect configured access rules and declared read fields. Supabase views must use security-invoker semantics and tested grants. Hidden-column conventions are backend-specific and are tested with separate safe exposure fixtures, not assumed portable.
2. Insert one object, discard internal ID, preserve database defaults, null/omitted distinctions, and constraint failures. Reject arrays, upsert options, mutation-returning, and primary-key mutation options before execution.
3. Route update/delete only after exactly one valid primary-key equality predicate is known. Reject absent/non-key/additional/conflicting predicates, ordering/limits, and attempts to change the primary key. Never preflight a filtered write then ignore a race.
4. Translate six filter operators using native structured filters and safe encoding. Keep multiple predicates on one column, including two bounds; reject unknown/hidden columns, null equality, nested syntax, NaN/Infinity, and unsafe numeric inputs.
5. Translate approved chained sort directions. Reject unsupported nullable/reference/collation options; explicitly order fixture comparisons with a key tie-breaker.
6. Map range to offset plus `to - from + 1`. Handle zero, reversed/negative/noninteger/unsafe bounds, maximum cap, offsets past the end, and repeated/mixed limit-range calls according to characterized behavior. No overfetching to simulate unlimited results.
7. Apply `.single()` and `.maybeSingle()` after the query's filters/range/limit. Detect zero/one/many, including matches beyond TrailBase's default page. Preserve an explicit `.limit(1)` selected by the caller, but do not add one yourself.
8. Add the data part of the shared browser example and comparisons against the official SDK before declaring a query method supported.

**Signoff:** U/I/C case families 05–13 and their E2E cases pass. Two-user forbidden-write tests prove unchanged database state. Range/cap tests include more than 50 and more than 1000 records; no test suite consisting only of tiny pages counts as pagination proof.

### Phase D — Password auth and session lifecycle

**Features: L1-14 through L1-20.**

1. Register via native email/password registration, preserve enumeration resistance, and map the approved null-user success exception. Test SMTP outage without turning it into a successful completed signup.
2. Confirm email through the real local inbox/verification route, then sign in with password. Unverified/incorrect/unknown/MFA-required credentials cannot become a fabricated authenticated session.
3. Persist only the SDK's own namespaced storage entry; no clearing unrelated local storage. Support documented sync/async storage adapters and the disabled persistence case. Hydration is awaited before session-sensitive operations; corrupt/missing storage is handled safely.
4. `getSession()` exposes cached state with required refresh, but explicitly documents that local claims are not trusted authorization. `getUser()` makes a live status request and maps validated returned claims; arbitrary JWT overloads remain unsupported.
5. Centralize refresh ordering with a single-flight promise and a session generation guard. Test concurrent queries/manual refresh, delayed hydration, logout while refresh is pending, short TTLs, offline/5xx retries, and terminal revocation. Late work must not revive a session or overwrite a newly signed-in different user.
6. Honor `autoRefreshToken` for background/focus-driven renewal. When false, no background timer-driven refresh occurs; explicit refresh/getSession and request-driven refresh follow the characterized reference contract rather than an assumed ban on every refresh. Define Node timer ownership; no live handles after teardown.
7. Implement explicit native global GET/local POST logout paths with observable network failures and redirect handling. Clear local session/timers/channels even when remote revocation fails; communicate the remaining remote-session risk. Support idempotent signed-out logout; reject `others`.
8. Adapt four core auth state notifications, deliver after initialization, and support listener unsubscribe/reentrant reads without hangs. Use browser storage events for any claimed same-origin cross-tab synchronization; never assume native client callbacks provide it automatically.

**Signoff:** U/I/C14–20, applicable security cases, and mail/persistence/refresh/multi-session browser E2E pass. Test both confirmed and unconfirmed users, a server-validated tampered-token failure, and global versus local revocation across two independently signed-in sessions. A captured access JWT may retain its documented residual validity; refresh revocation is the signoff condition.

### Phase E — Realtime with honest failure behavior

**Features: L1-21 through L1-23.**

1. Validate channel name/binding/event/schema/options. One native table subscription per channel, no ignored filter or private-channel option. `.subscribe()` remains chainable; report `SUBSCRIBED` only after the native connection is established.
2. Reuse the installed native SSE subscription only if fragmented-frame, UTF-8, sequence/loss, and cancellation characterization passes. Otherwise implement a minimal buffered fetch/SSE reader through authenticated native transport, with no new runtime protocol dependency by default.
3. Map INSERT/UPDATE new rows and approved DELETE primary-key old data using the same field codec as normal queries. Do not emit private/hidden fields, full old UPDATE records, or invented commit times.
4. Track startup timeout, permissions, malformed frames, server shutdown, stream close, and loss. Report `CHANNEL_ERROR/TIMED_OUT/CLOSED` honestly, cancel resources, and require explicit resubscribe/refetch rather than imply durable replay.
5. Renew authenticated streams before their credentials expire when background refresh is enabled; otherwise close at expiry and require explicit refresh/resubscription. Stop them on terminal refresh/logout. Validate native per-event access rules for revoked roles/sessions, ownership changes, and DELETE; no indefinitely authorized stream based on stale client state.
6. Unsubscribe/removeChannel are awaitable/idempotent; late data cannot reach callbacks after cleanup or a new session. User callback exceptions must not leak a stream or suppress other independent channels.
7. Add two-real-browser synchronization, authorization, cleanup, and failure E2E. Do not assert an event is absent merely because an arbitrary sleep elapsed.

**Signoff:** U/I/C21–23 and E2E loss/expiry/delete/isolation cases pass. G5/G6 decisions reference the installed transport. No direct dependence on Supabase's Phoenix wire protocol.

### Phase F — Security, migration rehearsal, and release proof

**Features: L1-24 through L1-26; all previous gates.**

1. Audit data/credential boundaries, per-request Node clients, URLs/headers, declared-field validation, error/log redaction, forbidden mutations, and subscription visibility. Run negative tests against real access rules/RLS and direct backend requests to distinguish SDK guards from server protection.
2. Run the same example source and common operation suite against both backends; only imports and bootstrap/backend configuration differ. Normalize backend-generated nondeterminism, not query semantics or security failures.
3. Rehearse a manual export/import on disposable databases: quiesce writes, convert declared UUID/boolean/timestamp fields, explicitly map separately provisioned auth users/owner references, import in dependency order, restore policies/publication, and compare rows/invariants. Re-run export/import against a fresh target to prove determinism; never mutate a live project. Auth passwords/tokens are not migrated.
4. Build and `npm pack`, then install the tarball in isolated Node and browser consumers. Run compile checks and a real-backend CRUD/auth/realtime smoke through the packed artifact, not source-only imports.
5. Publish an exact method/argument/field matrix, confirmed version manifest, approved exceptions, example, install/test instructions, and a per-feature signoff ledger. No package publish or supported badge while any required gate is red.

**Signoff:** all feature rows in [TEST_PLAN.md](TEST_PLAN.md) have green evidence at the same commit and named maintainer approval. Three consecutive clean full-suite runs pass without retries hiding failures. Level 1 is complete only for its documented subset; future-level language stays aspirational.

## 4. Delivery and change policy

- Deliver in the order above; tests and failure cases land with each feature, not as a final cleanup phase.
- Each feature PR states feature IDs, tests at every applicable layer, exact signoff conditions, evidence links, and remaining deviations. Doc-only changes run documentation validation and must not imply runtime support.
- A bug fix adds a regression test at the lowest useful layer and reruns the affected real-backend/contract/E2E tests. Auth, mutation, mapping, and realtime changes always rerun their security suites.
- New/deferred features require plan/matrix rows and test/signoff criteria **before implementation**. This policy also applies to Levels 2 and 3 if they are later approved.
- Upstream version changes are compatibility changes: rerun characterization, update the manifest, and repeat full conformance/security/E2E/package gates before widening version claims.
- No schedule estimate substitutes for a passing gate. Known gaps have owners and decisions; no unowned "later" work inside the released contract.
