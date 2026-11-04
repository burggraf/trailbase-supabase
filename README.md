# trailbase-supabase

A planned Supabase-shaped TypeScript SDK for TrailBase: start with a lightweight TrailBase backend, then move to Supabase with fewer application changes.

**Current delivery scope: official-only CRUD + password-auth MVP.** The newer explicit decision selects **official TrailBase0.35.9 or newer as the supported minimum**, without version autodetection or a version-setting option. The reproducible fixture pins **0.35.9** (`a106ce6338f9831140c92ac16e051901ed92d576`); **JS0.14.3** is unchanged. **Every actual route/replica must satisfy that deployment invariant: older, mixed-version or rolled-back servers are unsupported and can return misleading matching200 responses without authenticated deletion. The SDK does not detect this.** Later official versions still need wire qualification, not an assumption that all releases were tested. Self-service signup/persistent sessions remain included; realtime/migration are deferred. See the [official auth contract](docs/OFFICIAL_AUTH_CONTRACT.md), [MVP plan](docs/MVP_PLAN.md) and [future plan](docs/FUTURE_PLAN.md). Private prototypes remain historical, unadopted evidence. Original0358demo/assets/data/six containers are unchanged; repository changes do not deploy an upgrade.

**Status: CRUD/password-auth SDK under development; no feature signed off.** Private code has `createClient`, generated Row/Insert/Update and read-only View types, scalar mapping, lazy `select('*')`, six scalar filters, non-null ordering, bounded limit/range queries, `single`/`maybeSingle` and single-record mutations. Password auth includes persistence, live user validation, request/manual/background refresh, four core notifications and guarded logout. Under the explicit minimum invariant, default/global logout now validates a genuine native nonredirect receipt; failed/lost replies and native errors remain errors, not local-success fiction or a version probe. Signup/SMTP/no-resend and residual JWT/race limitations remain. Runtime coverage/candidate automation are executable; complete compatibility/security/device/release acceptance is incomplete. See [release qualification](docs/RELEASE_QUALIFICATION.md) and source-bound ledger for actual checks, not an inferred compatibility claim. A private MIT-licensed proof harness exists; no public SDK release, migration command or product gateway exists. This is an independent project, not an official TrailBase or Supabase product.

## Development data contract (not signed off)

| Methods | Implemented boundary |
| --- | --- |
| `select()` / `select('*')` | Mapped fields only; projections, count/head and extra options throw before wire. |
| Six filters, `order`, `limit`, `range` | Declared scalar domain, non-null ordering, 1000-row cap; last effective bounds win (a later limit retains the previous range offset). |
| `single()` / `maybeSingle()` | Cardinality after caller bounds; no implicit `limit(1)`. Adapter `CardinalityError` has no fabricated HTTP/SQL code. |
| `insert(record)` | One own-field plain object; omitted defaults remain omitted; success data is null. |
| `update(values).eq(key, value)` / `delete().eq(key, value)` | Exactly one explicit mapped primary-key equality; no extra/non-key/conflicting predicates, key changes, ordering, limits or returning. Missing key resolves an unsupported-feature error without a request. |

Constructor/builder validation throws before side effects; awaited backend/transport/cardinality errors resolve `{ data: null, error }`. Native errors remain native (including forbidden/missing writes), not reference no-op successes. Create acknowledgements are validated before their IDs are discarded: padded native UUIDv4 or canonical safe-integer decimal strings from the pinned server. Malformed success replies remain observable errors with unknown write outcome, never replayed. No read-after-write or replay is added; every await executes freshly, including repeated mutations. Independent builders isolate. Views require an explicit `readOnly: true` mapping for runtime write rejection; generated `public.Views` are read-only in types. Mutation primary keys must be declared non-null UUIDv4 or safe integers; text, boolean and nullable key mappings remain read-only for this slice. Arrays, inherited/unmapped fields, upsert and mutation options/returning are rejected. `npm run build:sdk`, `npm run test:sdk:unit` and `npm run test:sdk:data` exercise only the current data slice; full browser/package/security/release gates remain incomplete.

Bounded BQ01–BQ04 browser acceptance in `test:sdk:browser` targets the existing1000-row cap, declared six-operator and setter/execution matrix against real packed TrailBase and official Supabase clients. L1-09 repeated same-operator predicates use the official native indexed-AND encoding (including permission-checked zero limit), not duplicate flat keys that the pinned server rejects; this preserves existing AND semantics, not a new public query feature. Count/head and richer operators remain unsupported; no invented count, native HTTP416 or Unicode/collation parity. See [the test plan](docs/TEST_PLAN.md) and current-source ledger for actual execution status, not an inferred feature/security/release signoff.

## Development password auth (not signed off)

Enable with `auth: {}` alongside explicit table mappings. Within this opt-in, persistence and background refresh default to true. Use `persistSession:false` for memory-only credentials and `autoRefreshToken:false` for no timer/focus renewal. Disabled background renewal does not disable request/manual refresh. Browser persistence uses localStorage; Node fallback storage remains per-client memory. Data-only clients may still omit `auth`; auth methods then fail unsupported without requests. This explicit auth opt-in is narrower than Supabase's constructor defaults.

| Methods | Partial development boundary |
| --- | --- |
| `auth.signUp({ email, password })` | Native registration sends password_repeat once; returns `{ user: null, session: null }`, never synthesized identity/session. Real confirmation is caller-managed. Null-user is the selected documented official-only MVP limitation (G1), not Supabase signup parity. Native409 remains an error; never fabricate an identity or convert conflict to success. |
| Confirmation/resend | Follow genuine delivered email, then explicitly log in. No SDK `auth.resend`, password-recovery or identity-repair flow. Native SMTP424 may leave a pending identity; retry can return409. A native resend200 is not proof of delivery. |
| `auth.signInWithPassword({ email, password })` | Validated native credentials and JWT UUID/email/issuance/expiry claims, guarded installation only after successful current persistence commit. Failed replacement preserves good state; stale login cannot overwrite newer. No MFA/phone/metadata/options. |
| `auth.getSession()` | Awaited hydration and defensive cached result; at JWT exp joins request-time refresh. Cached result is not live user/signature verification/authorization; use argument-free getUser for live native session/user acknowledgement. |
| `auth.refreshSession()` | Argument-free, same-user native refresh; single-flight with expired getSession/data preflight. Only original genuine refresh credential retained; received CSRF remains internal. |
| `auth.getUser()` | Argument-free live native status with genuine bearer + refresh credential; maps fresh DB id/email only after guarded persistence of native credential rotation. Missing/anonymous/error status never returns cached success; failures preserve prior state (no status401 terminal-clear). Concurrent login/credential rotation can supersede a live lookup with an observable stale-operation error. Not a Supabase token side-effect parity claim. |
| `auth.signOut({ scope:'local' })` | Clear local generation/memory immediately, remove only owned storage, and send one native POST with the captured refresh credential. Exact HTTP 200 acknowledgement required; remote failures remain observable. |
| `auth.signOut()` / `{ scope:'global' }` | Default is global, never silently local. With captured credentials, one native GET sends Bearer + exact request `Content-Type: application/json`, omits cookies and refuses to follow redirects. Require nonredirect200, expected URL if supplied, UTF8 plaintext and complete exact ten-byte `logged out` receipt/EOF within10s. Native/request/receipt/storage failures remain errors after owned local clearing, even if DELETE already occurred. Under the official0359+ invariant this is native refresh-session revocation acknowledgement, **not version detection**. Empty-client no-op success sends no request and is not a receipt. |
| `auth.onAuthStateChange(callback)` | `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `SIGNED_OUT`; defensive snapshots, asynchronous delivery, reentrant reads and idempotent unsubscribe. Callback throws/rejections are isolated; no cross-tab synchronization claim. |

Invalid/unsupported arguments throw without wire; operational HTTP/decoding/stale errors return null-user/session auth envelopes. Auth HTTP shares configured fetch but never native implicit sessions/refresh. Record requests use current bearer only, omit cookies and refuse redirects. A configured custom fetch is trusted to honor those redirect/credential options: rejecting an already-followed response cannot undo a foreign request made by that custom transport. At cached JWT exp, getSession/data preflight renew once before dispatch; renewal failure returns error without anonymous fallback or CRUD replay. With persistence disabled there are zero storage calls; memory is per client. Background renewal, when enabled, starts after owned hydration/login, uses the same guarded refresh flight, and owns its timer/focus/visibility resources. No global-success workaround, logout renewal, version probe or replay is added. Expired captured JWTs return native401/no DELETE/error after local clearing; reference proactive renewal/401-403-404 suppression is a separate policy, not deletion proof. Refresh-session deletion does not instantly invalidate stateless access JWTs, prevent later login, notify other devices or guarantee survival of a racing session. Genuine0359 receipt support does not fix older servers or sign off broader G1/G7/security/release gates; strict historical failures stay source/version-bound. New supported-path, setup/cleanup, ownership or credential failures are regressions, not accepted limitations. Native-client/reference/raw-Fetch research controls are distinguished from supported adapter behavior in the [contract and evidence guide](docs/OFFICIAL_AUTH_CONTRACT.md#accepted-limitations-versus-regressions).

`npm run test:sdk:auth` selects owned real signup/mail/login/owner-isolation, live-user/forged/revoked/deleted identity and local/global logout/reference checks. `npm run test:sdk:refresh` adds genuine short-TTL renewal and retained-credential revocation. The separate `npm run test:sdk:auth:negative` scope targets AN01–AN06: owned registration-disabled403/existing-user login, genuine native MFA-required403 without session installation, distinct unchanged-reference disabled TOTP enrollment, actual packed three-browser memory/storage/events, exact policy restoration and ordinary owned cleanup. Fixture-only TOTP enrollment/completion does not add an SDK MFA API or enable reference MFA; Node-only disposable reference identity cleanup never sends an admin key to a browser. Exact executed counts, source hashes, failures and missing layers are in [the progress ledger](docs/progress.json), not inferred from authored tests or historical passes. Full shared-contract/security/fault/coverage/CI/release gates and signoff remain incomplete.

### Explicit persistent storage subset

`persistSession:true` supports sync/async `storage` with `getItem`, `setItem`, `removeItem` and an optional nonempty control-free `storageKey`. Default key is `trailbase-supabase.auth:<origin>`; default browser storage is localStorage, default Node storage is **per-client memory**, not shared/disk persistence. Custom storage may use prototype methods; only the three required methods are called. Persistent clients await initialization in auth/data paths. Store exactly version1 native access/refresh/nullable-CSRF credentials, never redundant cached user/expiry; CSRF is not public session data or a record header. Corrupt/unknown/truncated stored envelopes return sanitized errors without repair/deletion. Expired genuine credentials remain stored until renewal succeeds or native refresh401 rejects them; data/getSession perform guarded renewal, no anonymous fallback or native implicit refresh.

Within one client, generation guards cover hydration/storage awaits and writes serialize. Stale/failed writes restore the last committed credentials (or remove only the owned key if empty); successful memory installation occurs only after a current successful write. Failed replacement preserves prior good state. If compensation fails, consistency is unknown: sanitized `AuthStorageRestoreError` is latched, session results cannot report success and auth/data dispatch stops. Prior committed memory is retained internally, **not** claimed usable; disk restoration/revocation is not inferred. Recovery requires externally repaired storage and a new instance that validates the actual envelope, not merely constructing a client. This approved conservative development policy does not define future signOut/disposal cleanup behavior.

Cross-client/cross-tab synchronization is not claimed. Custom-storage reload/owner integration and packed three-engine localStorage tests exist; consult the current-source ledger for executed results. The bounded PS01–PS08 cases in `test:sdk:browser` exercise genuinely saved corrupt payloads on reload, unavailable/throwing/rejected storage operations, compensation/removal disk effects and held storage races using ordinary real password authentication. A rejected write/remove may already have changed disk: errors and fail-closed memory do not establish restoration, deletion or remote revocation. Recovery requires explicit external repair and a new instance validating actual credentials; a latched instance stays blocked. These are session-persistence tests, not the deferred Storage product, cross-tab support or complete security/release acceptance. Explicit logout invalidates pending hydration and serialized writes. A decoded stale login is cleaned with one exact-session local revocation only if its credential is distinct from current authoritative state and storage is consistent; cleanup failure is observable. Missing/undecodable replies or a storage-consistency latch cannot establish remote cleanup.

### Request/manual refresh subset (development only)

`autoRefreshToken:false` disables background behavior, not request-time renewal. Expired getSession/data operations join the same generation-guarded flight as manual refresh; one original data request is sent only after successful preflight, never replayed after an HTTP failure. Enabled background renewal targets 30 seconds before cached expiry, with a one-second minimum delay and ten-second transient retry delay; these are local scheduling choices, not exact Supabase timer parity or a production timing guarantee. Focus/visible-document events join renewal within that margin. Logout, terminal rejection and storage-consistency failure stop owned timers/listeners; Node timers do not keep the process alive. Reusing a client across server requests remains unsupported. Native refresh POST sends the captured refresh credential only in JSON, with cookies omitted and redirects refused. Exact native response is access JWT plus fresh CSRF; original refresh credential is genuinely retained because pinned server/client explicitly omit it. Same user ID is required.

Transient/network/malformed/other4xx failures preserve prior memory/disk and are observable. Only native refresh-endpoint401 is terminal: clear current authoritative credentials and serialize removal of only the owned key. No global/session/access-JWT revocation inference. Failed removal latches sanitized `AuthStorageRemoveError`; disk may still contain rejected credentials, and this client exposes no successful auth/session/data dispatch. Later cached reads after successful clearing may observe null. A newer login cannot be overwritten or removed by the old generation.

`npm run test:sdk:refresh` uses the owned short-native-auth3sec fixture for genuine backend denial, concurrency/reload/owner, background notifications and rejected-refresh/logout postconditions. Request-driven renewal still uses exact cached exp rather than the reference's proactive getSession margin. Source observations, fake-clock tests and focused real checks do not establish complete reference-expiry or compatibility signoff.

`npm run test:sdk:browser:refresh` is the separate PB01–PB04 genuine short-auth packed-browser acceptance scope defined in [the test plan](docs/TEST_PLAN.md): request-driven actual expiry/shared renewal and held real renewal versus local logout, direct B login, and logout then B login, with persisted identity/events/zero stale write checks on all three pinned engines. Background renewal is disabled explicitly in the PB01–PB04 cases. The same command also contains bounded BF01–BF08 background/focus-handler and terminal/transient fault-recovery acceptance cases: genuine timer renewal, disabled-option control, coalesced DOM event stimuli, cancelled Fetch/injected failure-only HTTP replies/truncated genuine bytes with real retry/recovery, and genuine refresh401 termination/explicit-login recovery. Controlled DOM stimuli are not physical focus/hidden-tab proof; failure injection is not a claimed real backend outage or Supabase timer/error parity. These cases do not establish the complete browser expiry/focus/fault/storage/resource matrix or release acceptance. Consult current source-bound ledger evidence for execution status.

The default `npm run test:sdk:browser` also contains bounded SR01–SR02 native live-status generation schedules: hold an unchanged genuine successful A `getUser()` reply across local logout or B login; require null/stale lookup, complete authoritative session/persistence/event coherence, exact native session deltas and no late A installation or writes. Genuine B controls and ordinary exact-owned cleanup include a committed row DELETE with its reply lost. These six three-engine schedules exercise existing S08 requirements, not a new API, SDK MFA, Supabase `/user` rotation parity or complete security/resource/release acceptance. Cancellation invocation and SDK signal abortion do not prove completed transport cancellation. See the source-bound ledger for execution, review closure, failures and remaining checks.

## Executable candidate qualification (not release approval)

Use exact Node22.23.2 and24.21.0 in separate clean checkouts with the existing Docker/mail/browser prerequisites and locked npm runtime metadata cache. `npm run test:sdk:coverage` measures every runtime SDK module with95% statement/line/function and90% branch thresholds, globally and per module; sanitized, source-bound results include exact uncovered locations under `artifacts/sdk-coverage/`. No exclusions or lower thresholds are used.

`npm run test:release:candidate` executes15 supported commands (static/types, units, coverage, package, real installed Node, auth, bounded negative auth controls, refresh, shared data, database, constraints, three-engine packed browser, separate short-auth packed browsers, example and cleanup), records independent outcomes and **exits nonzero while release acceptance is incomplete**. It refuses a pre-existing fixture/runner lock. Never bypass the retained demo lock; use an independent checkout. Each suite owns/provisions/cleans its fixture; this is not a provision-once full suite. Do not run the runner concurrently with fixture jobs in that checkout. Raw logs stay private in `.runtime/release-candidate/`; summaries are in `artifacts/release-candidate/`.

`npm run test:release:automated` runs exactly the same commands but its exit status covers **only that automation subset**. Even on success its report says `qualification: blocked`, lists remaining acceptance, and never supplies signoff. Strict upstream research CI stays separate and red; no historical failure becomes an official-supported pass. Standalone full contract/security/E2E/package/all placeholders remain fail-closed because their complete active requirements are not yet implemented. See the [requirement/evidence map and checklist](docs/RELEASE_QUALIFICATION.md).

## Private data package checks (not full package verification)

`npm run build:sdk` emits ESM and declarations. The existing private package name remains `trailbase-supabase`; no public name or publication is approved. `npm pack` builds first and includes only `package.json`, `LICENSE`, `README.md`, `dist/index.js` and `dist/index.d.ts`, plus exact `auth`/`common` JS/declaration modules required by the source split.

`npm run test:sdk:package` builds/packs into an owned temporary directory, inspects the archive, installs it offline into a clean Node consumer, compiles generated Database positive/negative cases against shipped declarations, and exercises installed-package data transport boundaries. Disposable Node/browser consumers use test-only exact overrides derived from the existing lockfile runtime graph and verify installed versions and integrity against that baseline; the shipped SDK dependency constraints are unchanged. This prevents fresh registry metadata selecting an untested newer patch. It requires the existing npm runtime-dependency cache; a cache miss fails rather than silently replacing the check. Temporary resources are removed even on failure. This subset uses injected transport, not real backend or browser proof; full `npm run test:package` intentionally remains incomplete.

### Real packed Node integration (bounded, not full package/release signoff)

With local Docker and **Node22.23.2 or24.21.0**, run `npm run test:sdk:node`. It provisions a new owned official0.35.9/short-native-auth fixture, builds/packs/installs the actual tarball offline into a disposable Node consumer, compiles both data/auth consumers against shipped declarations and executes the installed bare package—not repository imports or a workspace link. A live fixture lock is refused; never bypass it to run alongside the retained demo. Exact results are recorded in `artifacts/sdk-node/*.json` and the progress ledger, not inferred from this command description.

PN01–PN08 cover two SDK-created/real-mail-confirmed users, native duplicate409/null signup results, password failures, async fixture disk storage and a separate real Node-process reload, live getUser, mapped owner-isolated CRUD/query guards, genuine access expiry and single-flight/manual/background refresh, local revocation, genuine native global acknowledgement under the minimum invariant and a before-dispatch aborted-Fetch logout error. The disk adapter is test-only, not a new SDK storage implementation; Node defaults remain per-client memory. Ordinary fresh cleanup credentials and read-only database checks verify zero owned pending identities/sessions/rows, complete old-account/data preservation and exact audit operations before unconditional fixture removal. No fabricated success, identity repair, private candidate, redirect-following or global-success workaround is used. Both pinned Nodes run independently in CI; successful supported scopes do not replace missing stock research assertions after a startup0 failure. Full security/coverage/package/release/device/maintainer gates remain incomplete.

Browser entry is `dist/index.js` ESM, **not a standalone bundle**. Browser consumers need a bundler or complete import map resolving pinned `trailbase@0.14.3` and its transitive ESM imports. Packed real-backend Chromium/Firefox/WebKit suites exist; complete release verification remains required.

## Browser examples (development, not signed off)

**Run the real client-only app:** follow [examples/todos/README.md](examples/todos/README.md), then `npm run example:todos` from this repository. It builds/clean-installs the packed SDK, starts a generated isolated TrailBase instance with local confirmation mail, and prints the App/inbox URLs. All listeners bind loopback; no browser admin key, hosted credentials or backend URL configuration is accepted. Ctrl-C/`quit` removes only its disposable resources. `npm run test:example:todos` executes the same launcher with readiness/shutdown checks. This uses the existing Docker-backed fixture/mail infrastructure, not a new production server or deployment.

`examples/todos/index.html` now boots `main.js` itself. Both signup/login accounts in the standalone browser isolation case authenticate through the SDK; no fixture sessions are injected into storage. The UI covers real confirmation guidance, persisted reload/manual/default refresh, row selection/edit/delete, loading/error/recovery and explicit logout scopes. Use separate browser profiles/private contexts for two users; cross-tab synchronization is not claimed. Signup/SMTP and logout failure/expiry/residual-JWT limitations remain visible. Global success requires the supported minimum and an actual complete native receipt; older/mixed/rolled-back deployments are unsupported, not detected.

`examples/todos/app.js` retains `mountTodos(root, client, { ownerId })` for caller-authenticated data-only use and adds `mountAuthTodos(root, client)` for signup/explicit post-confirmation login, live user validation, refresh, local/default-global logout and the same CRUD controls. Both provide labelled controls, visible errors and `dispose()` for owned UI/listener teardown. The supplied client belongs to the caller: dispose does not revoke its sessions; explicitly sign out when ending that client lifecycle. Mutation refreshes are explicit UI reads, not SDK replay/read-after-write.

Keyboard task completion restores focus to the current task checkbox after success or failure; if the task leaves the current filter, focus moves to New task. A delayed result does not take focus back from another control. The bounded KF01 real adapter/reference three-browser tests cover this existing keyboard CRUD behavior, not full accessibility or resource-lifecycle acceptance. Consult the source-bound ledger for verification.

Task navigation keeps the last successfully displayed page/filter authoritative until the destination read succeeds, including the existing one-page empty-page fallback. A failed Next/Previous/filter/fallback read shows a safe error without silently changing what Refresh or the next navigation will request. The bounded NR01 schedule in `test:sdk:browser` checks this normal UI against the packed adapter and official Supabase client on all three engines; reference transport retries are explicitly disabled to deliver the read failure, not to claim default retry parity. No new query method, automatic mutation replay or live-demo deployment is added. Consult the source-bound ledger for actual verification and remaining acceptance.

`npm run test:sdk:browser` clean-installs the private tarball and runs Chromium/Firefox/WebKit. In addition to the self-booting two-user SDK-authenticated app and existing fixture-authenticated data/storage checks, the shared auth app runs the same operations with the packed adapter and official Supabase client: real signup/mail confirmation/login, CRUD, reload, live lookup, manual renewal and logout. No mocked successful auth/data response or browser admin credential is used. Native0359 receipts and genuine failure/loss/storage/held-generation cases are checked separately from reference policy; no old0358 failure is normalized into new success. Full E2E/security/package/release commands remain incomplete; the ledger records which authored checks actually ran.

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

The selected reproducible **official native fixture is TrailBase0.35.9**, commit `a106ce6338f9831140c92ac16e051901ed92d576`, under the explicit0359+ supported minimum with no version detection; `trailbase` **JS0.14.3** and other dependency pins are unchanged. Only Linux/x64 has current runtime proof; other native platforms have metadata-only evidence until exercised. Native executable caches are version-separated and0.34.3 remains available for isolated upgrade/rollback verification. Historical reports keep their original version/source binding. New pending-email migration deletes unconfirmed identities older24h and adds uniqueness: do not upgrade an existing depot without a complete stopped backup, protected-copy aggregate preflight and verified restore. G1 signup/SMTP differences and broader G7/lifecycle/security acceptance remain unresolved. Official0359 supplies the narrow authenticated acknowledgement; older0358 failure evidence remains unchanged, not fixed or retrospectively signed off. No private fork/capability is adopted, deployed or published, and no further fork parity work is planned by default.

Phase A reports keep original test names/statuses and add only registered failure-step IDs with fixed categories for selected signup/SMTP/lifecycle assertions. Unknown errors remain `UNCLASSIFIED`; expected/actual values, messages, headers, account/task data and arbitrary metadata stay in private diagnostics. A step identifies the first tagged failure observed, not a compatibility verdict or every later cleanup error. Browser reports retain attempt statuses and still fail multiple-attempt cases; no retry is normalized into success. Permanent `tests/unit/sdk-redirect-boundary.test.ts` exercises eight actual-SDK paths against two synthetic ephemeral HTTP origins; its separately labeled unsafe raw-Fetch control is not a live-session leak or an SDK defect.

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
