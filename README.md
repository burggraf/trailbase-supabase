# trailbase-supabase

A planned Supabase-shaped TypeScript SDK for TrailBase: start with a lightweight TrailBase backend, then move to Supabase with fewer application changes.

**Current delivery scope: CRUD + password-auth MVP.** Self-service signup and persistent sessions included; realtime and migration work deferred. See [MVP plan](docs/MVP_PLAN.md) and [future plan](docs/FUTURE_PLAN.md). G1 signup/SMTP and G7 logout/session races remain unresolved documented auth edge cases; they do not block implementation and are not claimed fixed or signed off.

**Status: CRUD SDK implementation in progress; no feature signed off.** Private development code now has `createClient`, generated Row/Insert/Update and read-only View types, explicit scalar mapping, lazy `select('*')`, six scalar filters, non-null ordering, bounded limit/range queries, `single`/`maybeSingle`, and single-record mutations. Coverage remains incomplete; development-only signup/password login and explicit memory/persisted hydration are implemented; full lifecycle auth is not. These development methods are not verified compatibility claims. A private MIT-licensed proof harness exists; no public SDK release, migration command or gateway exists. This is an independent project, not an official TrailBase or Supabase product.

## Development data contract (not signed off)

| Methods | Implemented boundary |
| --- | --- |
| `select()` / `select('*')` | Mapped fields only; projections, count/head and extra options throw before wire. |
| Six filters, `order`, `limit`, `range` | Declared scalar domain, non-null ordering, 1000-row cap; last effective bounds win. |
| `single()` / `maybeSingle()` | Cardinality after caller bounds; no implicit `limit(1)`. Adapter `CardinalityError` has no fabricated HTTP/SQL code. |
| `insert(record)` | One own-field plain object; omitted defaults remain omitted; success data is null. |
| `update(values).eq(key, value)` / `delete().eq(key, value)` | Exactly one explicit mapped primary-key equality; no extra/non-key/conflicting predicates, key changes, ordering, limits or returning. Missing key resolves an unsupported-feature error without a request. |

Constructor/builder validation throws before side effects; awaited backend/transport/cardinality errors resolve `{ data: null, error }`. Native errors remain native (including forbidden/missing writes), not reference no-op successes. Create acknowledgements are validated before their IDs are discarded: padded native UUIDv4 or canonical safe-integer decimal strings from the pinned server. Malformed success replies remain observable errors with unknown write outcome, never replayed. No read-after-write or replay is added; every await executes freshly, including repeated mutations. Independent builders isolate. Views require an explicit `readOnly: true` mapping for runtime write rejection; generated `public.Views` are read-only in types. Mutation primary keys must be declared non-null UUIDv4 or safe integers; text, boolean and nullable key mappings remain read-only for this slice. Arrays, inherited/unmapped fields, upsert and mutation options/returning are rejected. `npm run build:sdk`, `npm run test:sdk:unit` and `npm run test:sdk:data` exercise only the current data slice; full browser/package/security/release gates remain incomplete.

## Development auth slices 1–4 (not signed off)

Enable with explicit `auth: { persistSession: true, autoRefreshToken: false }` for persistence, or `persistSession: false` for memory only alongside the existing explicit table mappings. Missing persistence settings and missing/default-true refresh settings are **not** silently disabled: unsupported settings throw before requests. Data-only clients may omit `auth`; their auth methods then fail unsupported without requests.

| Methods | Partial development boundary |
| --- | --- |
| `auth.signUp({ email, password })` | Native registration sends password_repeat once; returns `{ user: null, session: null }`, never synthesized identity/session. Real confirmation is caller-managed. Null-user compatibility approval remains pending (G1). |
| `auth.signInWithPassword({ email, password })` | Validated native credentials and JWT UUID/email/issuance/expiry claims, guarded installation only after successful current persistence commit. Failed replacement preserves good state; stale login cannot overwrite newer. No MFA/phone/metadata/options. |
| `auth.getSession()` | Awaited hydration and defensive cached result; at JWT exp joins request-time refresh. Cached result is not live user/signature verification/authorization; use argument-free getUser for live native session/user acknowledgement. |
| `auth.refreshSession()` | Argument-free, same-user native refresh; single-flight with expired getSession/data preflight. Only original genuine refresh credential retained; received CSRF remains internal. |
| `auth.getUser()` | Argument-free live native status with genuine bearer + refresh credential; maps fresh DB id/email only after guarded persistence of native credential rotation. Missing/anonymous/error status never returns cached success; failures preserve prior state (no status401 terminal-clear). Concurrent login/credential rotation can supersede a live lookup with an observable stale-operation error. Not a Supabase token side-effect parity claim. |
| `signOut`, `onAuthStateChange` | Explicit unsupported errors; no lifecycle success/notification/revocation claim. |

Invalid/unsupported arguments throw without wire; operational HTTP/decoding/stale errors return null-user/session auth envelopes. Auth HTTP shares configured fetch but never native implicit sessions/refresh. Record requests use current bearer only, omit cookies and refuse redirects. At cached JWT exp, getSession/data preflight renew once before dispatch; renewal failure returns error without anonymous fallback or CRUD replay. With persistence disabled there are zero storage calls; memory is per client. No timers, automatic refresh or logout/global-success workaround. G1/G7 failures remain unresolved.

`npm run test:sdk:auth` selects authored owned real signup/mail/login/owner-isolation plus reference failed-replacement checks. Parent verified slice1 real auth 1/1 at historical 5c55be11; parent reviewed storage/refresh controls at historical 7b23133b passed; new live-user/DB mapping/forged/revoked/deleted cases are authored and **not run** at this checkpoint; focused units/types/build are not compatibility proof. Persistence/full lifecycle, auth app, browser, packed auth consumers, complete security/fault/coverage/CI/release and signoff remain missing.

### Explicit persistent storage subset

`persistSession:true` supports sync/async `storage` with `getItem`, `setItem`, `removeItem` and an optional nonempty control-free `storageKey`. Default key is `trailbase-supabase.auth:<origin>`; default browser storage is localStorage, default Node storage is **per-client memory**, not shared/disk persistence. Custom storage may use prototype methods; only the three required methods are called. Persistent clients await initialization in auth/data paths. Store exactly version1 native access/refresh/nullable-CSRF credentials, never redundant cached user/expiry; CSRF is not public session data or a record header. Corrupt/unknown/truncated stored envelopes return sanitized errors without repair/deletion. Expired genuine credentials remain stored until renewal succeeds or native refresh401 rejects them; data/getSession perform guarded renewal, no anonymous fallback or native implicit refresh.

Within one client, generation guards cover hydration/storage awaits and writes serialize. Stale/failed writes restore the last committed credentials (or remove only the owned key if empty); successful memory installation occurs only after a current successful write. Failed replacement preserves prior good state. If compensation fails, consistency is unknown: sanitized `AuthStorageRestoreError` is latched, session results cannot report success and auth/data dispatch stops. Prior committed memory is retained internally, **not** claimed usable; disk restoration/revocation is not inferred. Recovery requires externally repaired storage and a new instance that validates the actual envelope, not merely constructing a client. This approved conservative development policy does not define future signOut/disposal cleanup behavior.

Cross-client/cross-tab synchronization is not claimed. Real custom-storage reload/owner integration and packed three-engine localStorage reload tests are authored but pending; complete lifecycle/auth-app/package/security/coverage/signoff remain missing.

### Request/manual refresh subset (development only)

`autoRefreshToken:false` disables background behavior, not request-time renewal. This slice has **no timers**, proactive margin, default-true refresh or clock/window promise. Expired getSession/data operations join the same generation-guarded flight as manual refresh; one original data request is sent only after successful preflight, never replayed after an HTTP failure. Native refresh POST sends the captured refresh credential only in JSON, with cookies omitted and redirects refused. Exact native response is access JWT plus fresh CSRF; original refresh credential is genuinely retained because pinned server/client explicitly omit it. Same user ID is required.

Transient/network/malformed/other4xx failures preserve prior memory/disk and are observable. Only native refresh-endpoint401 is terminal: clear current authoritative credentials and serialize removal of only the owned key. No global/session/access-JWT revocation inference. Failed removal latches sanitized `AuthStorageRemoveError`; disk may still contain rejected credentials, and this client exposes no successful auth/session/data dispatch. Later cached reads after successful clearing may observe null. A newer login cannot be overwritten or removed by the old generation.

`npm run test:sdk:refresh` selects the authored owned short-native-auth3sec fixture case with genuine backend denial, concurrency/reload/owner and rejected-refresh postconditions; it has **not run** at this checkpoint. Installed Supabase source renews getSession with autoRefreshToken:false and a proactive margin, but this adapter only implements exact cached exp; source observation is not real reference-expiry or compatibility signoff.

## Private data package checks (not full package verification)

`npm run build:sdk` emits ESM and declarations. The existing private package name remains `trailbase-supabase`; no public name or publication is approved. `npm pack` builds first and includes only `package.json`, `LICENSE`, `README.md`, `dist/index.js` and `dist/index.d.ts`, plus exact `auth`/`common` JS/declaration modules required by the source split.

`npm run test:sdk:package` builds/packs into an owned temporary directory, inspects the archive, installs it offline into a clean Node consumer, compiles generated Database positive/negative cases against shipped declarations, and exercises installed-package data transport boundaries. It requires the existing npm runtime-dependency cache; a cache miss fails rather than silently replacing the check. Temporary resources are removed even on failure. This subset uses injected transport, not real backend or browser proof; full `npm run test:package` intentionally remains incomplete.

Browser entry is `dist/index.js` ESM, **not a standalone bundle**. Browser consumers need a bundler or complete import map resolving pinned `trailbase@0.14.3` and its transitive ESM imports. Actual Chromium/Firefox/WebKit and packed real-backend checks remain required.

## Data-only browser example (development, not verified)

`examples/todos/app.js` exports `mountTodos(root, client, { ownerId })`. Callers supply their own explicit client/bootstrap; the example implements no signup/session API. It provides labelled CRUD/filter/order/page/cardinality controls, visible errors and `dispose()` for listener teardown. Mutation refreshes are explicit UI reads, not SDK replay/read-after-write.

`npm run test:sdk:browser` is a dedicated Chromium/Firefox/WebKit fixture scope. It clean-installs the actual private tarball, serves installed SDK/native ESM with a minimal import map, and bootstraps ordinary confirmed test users privately. It does not mock successful data/auth responses or use browser admin credentials. Parent verified the data-only suite 3/3 at historical data checkpoint f065cc08; the new auth/common packed-module graph still needs fresh runtime proof; historical browser proofs are unchanged. Full E2E/package/auth/release commands remain incomplete.

## Resume development and review progress

Start with [docs/PROGRESS.md](docs/PROGRESS.md) and `npm run progress`. The checked-in [progress ledger](docs/progress.json) tracks Phase A deliverables, all 27 feature rows, seven research gates, test evidence, missing checks, maintainer signoff, and next steps. Implemented, verified, and signed off are separate states.

```sh
npm ci
npm run progress
npm run check
npm run test:unit
npx playwright install chromium firefox webkit
npm run test:phase-a
npm run test:cleanup
```

Real-service tests require local Docker; see the restart guide for exact tool versions, Linux browser dependencies, safe recovery, tested environments, and evidence. The smaller Phase A probes are not a substitute for the future SDK's full suite.

## Start small

The initial target is **Level 1 — Supabase-shaped TrailBase SDK**, not a Supabase server clone:

```text
Application → compatibility SDK → native TrailBase APIs
```

The first release will target a deliberately small subset:

- `createClient()` and Supabase-style `{ data, error }` results.
- Table reads and basic insert/update/delete operations.
- Basic filters, sorting, pagination, and single-row results. Positive-offset/zero-limit queries expose an explicitly adapter-generated range error, not a fabricated native HTTP 416.
- Password signup, login, and logout with the session handling those flows need.
- Database change subscriptions are deferred beyond MVP.

TrailBase SSE authentication is connection-scoped: a valid token establishes a stream, and access lasts for that connection's lifetime even after token expiry. New connections require valid credentials. Logout/teardown must cancel local subscriptions; that is not server-side revalidation or full Supabase authorization parity.

DELETE event payloads are limited to primary keys. TrailBase keeps owner-only delivery; Supabase may deliver another owner's DELETE key even when ordinary row reads are denied. Primary-key confidentiality is **not portable**; protected row values must remain private. No permissions are weakened to reproduce this difference.

See [PLAN.md](PLAN.md) for scope and future levels, and the [detailed Level 1 plan](docs/LEVEL1_PLAN.md) for the researched contract and implementation sequence.

## Verification is part of every feature

The [full test plan](docs/TEST_PLAN.md) defines unit/type/property, database, real integration, shared Supabase contract, browser E2E, security/fault, and packaged-consumer tests, with **27 feature-specific signoff rows**. Tests land with implementation, not afterward. Chromium, Firefox, and WebKit exercise real disposable TrailBase/Supabase backends and actual email-confirmation flows.

Release requires reproducible CI evidence and maintainer signoff—not mocks alone. [Upstream research](docs/RESEARCH.md) records seven open decisions, including signup return shapes, field conversions, auth lifecycle, and streaming behavior. Upstream/harness checks are being implemented and exercised; SDK feature implementation and signoff remain pending.

## Future migration goal (not MVP deliverable)

For applications that stay within the documented subset, the goal is to change the SDK import and backend configuration without rewriting application queries:

```diff
- import { createClient } from '@trailbase/supabase'
+ import { createClient } from '@supabase/supabase-js'
```

`@trailbase/supabase` is the discussion's proposed package name, not a published package or a reserved npm scope. Final package naming is still to be decided.

**An import change does not migrate the backend.** Schema, records, users, files, and authorization rules need separate migration work. SQLite and Postgres semantics, TrailBase access rules and Supabase RLS, and auth identities are not interchangeable. The first version will document these limits and demonstrate a small manual migration rather than promise an automatic migration tool.

## Eventual goals

| Level | Goal | Status |
| --- | --- | --- |
| 1 | Supabase-shaped SDK calling native TrailBase APIs | Initial focus; minimal subset first |
| 2 | HTTP compatibility gateway allowing the real Supabase SDK to use TrailBase | Future goal; no implementation now |
| 3 | Drop-in Supabase server replacement, including wider protocol and semantic compatibility | Long-term aspiration; feasibility unproven |

Storage, OAuth, richer queries, and other additions to Level 1 are deferred until a real application needs them. Levels 2 and 3 must not expand the first release.

## Project documents

- [docs/PROGRESS.md](docs/PROGRESS.md): restart guide, commands, evidence, and signoff workflow.
- [docs/progress.json](docs/progress.json): authoritative per-deliverable/feature/gate status and next steps.
- [PLAN.md](PLAN.md): roadmap and acceptance criteria.
- [docs/LEVEL1_PLAN.md](docs/LEVEL1_PLAN.md): detailed work packages and completion gates.
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): mandatory full-suite and per-feature signoff requirements.
- [docs/RESEARCH.md](docs/RESEARCH.md): official sources, researched versions, differences, and open decisions.
- [AGENTS.md](AGENTS.md): instructions for coding agents and contributors.
- [Source discussion](https://chatgpt.com/share/6ac02347-6a48-83e8-b8b8-8ef8986f9a0f): the project's starting point, not a verified API specification.

Phase A commands are documented above and in the restart guide. Full SDK contract/security/application-E2E/package/release commands deliberately fail while unimplemented; they do not silently substitute a smoke test. See [LICENSE](LICENSE) for MIT terms.
