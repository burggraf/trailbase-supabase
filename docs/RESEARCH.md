# Level 1 upstream research

Research date: **2026-10-02**. The original findings below came from official documentation/pinned source review. Phase A now adds executable **upstream/infrastructure characterization**, tracked in [PROGRESS.md](PROGRESS.md) and [progress.json](progress.json). It does not verify a compatibility SDK or approve an exception; those remain separate gates.

## Reference baseline

| Component | Researched version | Evidence / implementation requirement |
| --- | --- | --- |
| TrailBase server | `v0.34.3` | Release/tag resolves to commit `eab5039392a624736ab0c6a9f07f6793423dc979`. Pin the binary/container checksum in the implementation fixture. |
| Official TrailBase JS client | `trailbase@0.14.3` | npm metadata and the server tag's client `package.json` agree. Verify the installed distribution, not only repository source. |
| Supabase JS reference | `@supabase/supabase-js@2.117.2` | npm metadata; official monorepo tag `v2.117.2`. Requires Node `>=22`. Keep this a test/reference dependency, not the production transport. |
| Supabase CLI | `v2.119.0` | Candidate fixture pin from the official release. Capture the actual local service image digests and PostgREST/Auth/Realtime versions at first successful boot. |
| Runtime target | Node 22 and 24; evergreen browsers | Proposed project support, not an upstream guarantee. Pin exact CI Node and Playwright/browser versions when implementation begins. |

Official websites are rolling documentation. The pinned source below is the reference for version-specific behavior; real-backend characterization tests resolve disagreements. These versions are a starting baseline, not a promise to follow `latest` automatically.

Metadata sources: [TrailBase release](https://github.com/trailbaseio/trailbase/releases/tag/v0.34.3), [TrailBase npm metadata](https://registry.npmjs.org/trailbase/0.14.3), [Supabase npm metadata](https://registry.npmjs.org/@supabase/supabase-js/2.117.2), [Supabase SDK tag](https://github.com/supabase/supabase-js/tree/v2.117.2), [Supabase CLI release](https://github.com/supabase/cli/releases/tag/v2.119.0).

## Findings that change the implementation plan

### 1. CRUD maps well, but mutation results and authorization do not map automatically

Supabase insert/update/delete do **not** return modified rows by default; returning rows requires mutation `.select()` [SB2]. TrailBase's client returns an ID from create and no record from update/delete [TB3]. The adapter should discard the internal create ID and return `data: null` for the supported default mutation calls. No extra read-after-write is necessary or desirable.

TrailBase update/delete are record-ID endpoints. Only exactly one primary-key equality predicate is initially supported. Any extra predicate must be rejected before sending a write; dropping it could write a row that the caller did not intend to modify.

Supabase RLS can make an unauthorized update a successful no-op [SB9]. TrailBase record endpoints perform access checks and may return an error [TB6]. Match **data safety**, but do not relabel every 403/404 as success. Characterize missing-row and forbidden-row behavior, publish the difference, and obtain contract signoff.

### 2. Unknown-column handling needs a regression test, not an assumption

The pinned list handler contains an old comment saying unknown filters are dropped, but the current `listing.rs` mapping returns an unknown-column error [TB5]. This is a documentation/source-comment discrepancy, not proof that the current release silently ignores filters.

The adapter must validate known columns and reject unknown names regardless of upstream behavior. A typo must never broaden a query. Exercise this against the installed server and installed JS package.

### 3. Pagination defaults differ; `limit(0)` needs deliberate handling

TrailBase defaults to **50 rows** and a default hard maximum of **1024**, with a configurable API hard limit [TB1, TB5]. Supabase commonly caps requests at 1000 rows, but this is project configuration, not a universal SDK constant. Supabase ranges are zero-based and inclusive: `range(1, 3)` requests three rows [SB3].

Use explicit native offset/limit, never cursor translation or whole-table downloads. Adopt a documented 1000-row initial SDK cap and align both fixtures. Preserve the user's supplied order; an unordered result has no portability guarantee.

The TrailBase JS client's `ListOperation.query()` uses a truthiness check for `limit`, so passing zero omits it [TB3]. The server itself supports zero-row results [TB5]. Return an empty result deliberately or use a verified low-level request for zero while still validating the query/access contract; test that it cannot unexpectedly return a default page. Pin tests for mixed/repeated `.limit()` and `.range()` calls against the reference SDK before choosing precedence.

### 4. UUIDs, booleans, timestamps, and large integers need an explicit portable schema

TrailBase strict SQLite tables use fundamental storage types [TB2]. Native row serialization emits integers as JSON numbers and BLOBs as URL-safe base64 strings [TB7]. JWT `sub` is also a URL-safe-base64 user ID [TB4]. Supabase user IDs and UUID columns use canonical UUID strings.

Therefore the example cannot simply use a Postgres `uuid/boolean/timestamptz` DDL string on SQLite. Use a reviewed, small table mapping for primary keys, UUID/owner columns, and boolean columns. Convert only declared fields; do not guess that every base64 string is a UUID or every 0/1 integer is a boolean. Use safe integer IDs/numbers and one explicit timestamp convention initially. Reject unsupported lossy values rather than silently changing them.

TrailBase's JSON schema endpoint requires separate Schema permission and defaults to insert mode; select mode must be requested for read validation [TB8]. Its ordinary schemas do not provide a complete portable semantic contract for every field. A small checked-in schema/mapping literal is the recommended bootstrap, with integration checks against backend schemas; do not require browser admin privileges or build a general schema generator.

### 5. Ordering is portable only over a defined domain

TrailBase supports multi-column `+/-column` ordering [TB1, TB3]. Supabase supports chained ordering and `nullsFirst` options [SB3]. SQLite/Postgres default null placement and text collation can differ.

Initially support ascending/descending ordering over declared **non-null numeric fields and the documented common text domain**; use a primary-key tie-breaker in examples/tests. Reject nullable ordering, `nullsFirst`, referenced-table ordering, and collations until they have a faithful native implementation. Unordered results are compared as sets, not as a made-up cross-backend ordering promise.

### 6. Signup is a genuine return-shape gap

TrailBase email registration sends verification mail, forbids login before confirmation, never logs in the user, and returns a plain success response with **no user ID/object** [TB9]. Its insertion-error path reports success to resist enumeration, but v0.34.3's new unverified-email storage does not actually enforce pending-address uniqueness; see the blocking regression below. Supabase confirmation-enabled signup ordinarily exposes a user and a null session; confirmation-disabled environments can create a session immediately [SB4, SB5].

Recommended minimal contract: email/password only, confirmations enabled in both fixtures, TrailBase signup success returns `{ data: { user: null, session: null }, error: null }`. This is an **explicit compatibility exception requiring maintainer approval**, not full Supabase signup parity. Never fabricate a UUID/user object, use browser admin APIs to retrieve one, or silently auto-confirm accounts.

The pinned [Auth v2.197.0 signup handler](https://github.com/supabase/auth/blob/v2.197.0/internal/api/signup.go) returns `user_already_exists` for a confirmed duplicate if **either** email or SMS auto-confirmation is enabled, independently of whether phone signup is enabled. The initial local fixture exposed that response because SMS confirmations defaulted off. Require both confirmation flags for the reference fixture while keeping phone signup disabled; this strengthens confirmation/identity protection, not phone support. A sanitized duplicate user is still not full response-shape parity or a universal enumeration-resistance guarantee.

Test real confirmation through a local SMTP inbox and both backends' verification links. The application tells users to check mail and explicitly sign in afterward; automatic Supabase callback-session adoption is outside scope. If identical signup user results are required, resolve the missing native capability before claiming Level 1 complete.

### 7. `getSession()` is not `getUser()`

Supabase `getSession()` reads stored session state and refreshes as needed; its cached user must not be trusted for server authorization. `getUser()` performs server validation [SB6]. TrailBase `client.user()` merely decodes JWT claims [TB4]. Do **not** expose that as a network-validated `getUser()`.

TrailBase `/api/auth/v1/status` validates supplied tokens and, when a refresh token is present, checks the live session and remints claims. Without a refresh token it can validate only the still-valid JWT [TB10]. Use this verified server path for the current-session `getUser()` subset, and publish which user fields actually exist. No fabricated `created_at`, identities, or metadata. An arbitrary `getUser(jwt)` overload is deferred.

### 8. Refresh and logout have important native differences

Supabase refresh-token rotation/reuse rules differ from TrailBase's refresh implementation, which retains the existing refresh token [SB7, TB11]. The public fields can be mapped without emulating Supabase's server-side security mechanism. Document the distinction.

Supabase `signOut()` defaults to **global**, not local [SB8]. TrailBase has two routes: GET logout deletes all of the user's sessions, while POST logout with a refresh token deletes one session [TB12]. The official TrailBase client uses the local POST and catches/logs failures [TB4]. Therefore calling its `logout()` alone cannot faithfully implement Supabase's default scope or surface revocation errors. Use narrowly scoped native requests for global/local logout; reject `others` initially. Avoid redirect-following surprises, clear local state even on outage, and report failed remote revocation.

Neither backend can revoke an already-issued stateless access JWT instantly merely by deleting refresh sessions [TB9, SB8]. Test refresh revocation and local credential removal, and separately document access-token residual lifetime. Never assert that a captured access token immediately becomes unusable.

Persisted-token construction in the native JS client initiates an asynchronous status check [TB4]. Characterize startup/refresh/logout races and single-flight refresh before reuse; a late response must not restore a signed-out session. Cross-request server clients must never share user state.

### 9. Realtime is an event adapter, not a Supabase protocol implementation

TrailBase exposes HTTP streaming/SSE and native change objects `{ Insert: row }`, `{ Update: row }`, `{ Delete: row }`, plus errors and sequence numbers [TB3, TB13]. Supabase uses its own channels and database-change payloads [SB10]. Supabase setup requires adding the fixture table to the realtime publication; old row data depends on replica identity/RLS configuration.

Initially support one table binding per channel, schema `public`, events `INSERT/UPDATE/DELETE/*`, and subscribe/unsubscribe/removeChannel. Do not accept filters, arbitrary schemas, Broadcast, Presence, or private channel options and then ignore them.

Map only provable payload fields. TrailBase does not supply a prior UPDATE row or a database commit timestamp in its basic change object. Do not perform speculative reads or invent a commit timestamp. Establish the common tested `eventType/schema/table/new/old` subset; restrict DELETE old data to declared primary keys and verify RLS behavior. Full old UPDATE records and exact Supabase payload parity are not initial claims.

The pinned native SSE parser splits each decoded chunk on frame boundaries without retaining an incomplete frame, and its previous sequence variable is local to each transform call [TB3]. These are **source-level risks to characterize**, not a runtime test result. Force byte-by-byte frames, multibyte UTF-8 splits, merged frames, comments, sequence gaps, loss errors, and cancellation against the installed package. If it fails, use a minimal, regression-tested buffered SSE path through native authenticated HTTP or an upstream fixed version; do not implement Phoenix/WebSocket compatibility.

Subscriptions are not a durable log or an exactly-once transport. Surface terminal connection/permission/loss errors, require resubscription and refetch, and ensure logout/client teardown cancels streams and late callbacks. TrailBase authenticates SSE when the connection is established and expects access to last for the connection lifetime: JWT expiry does not revalidate/close that stream; no continuous server-side revalidation guarantee is promised. An expired JWT is denied on a new connection. This is an explicit compatibility limitation, not a server-side expiry guarantee. Test isolation for INSERT/UPDATE/DELETE: Supabase DELETE authorization behavior differs from row reads and can expose keys [SB10]. A common fixture must not accidentally use a privileged subscriber.

### 10. Fixture grants, views, and hidden fields need explicit protection

Supabase grants and RLS are separate checks; set least-privilege grants and owner policies together, including UPDATE `with check` to forbid ownership reassignment [SB9]. A default Postgres view can bypass underlying RLS; the shared read-only view must use `security_invoker = true` on the supported Postgres version and have its own tested grants.

TrailBase hides underscore-prefixed columns during reads [TB1]; Supabase does not adopt that convention automatically. Keep internal columns out of the common `todos` API and use separate restricted-field fixtures/safe projection views for exposure tests. Do not claim that a column named `_secret` is private on Supabase or silently normalize away an exposed field.

Production auth requires HTTPS, while controlled test fixtures may use loopback HTTP. Include a local TLS/proxy streaming smoke and document reverse-proxy buffering requirements [TB14]; passing only direct loopback SSE is not evidence that an example deployment works through a proxy.

## Phase A runtime observations (limited scope)

Use the progress ledger's exact reports/source hashes to see current versus historical runs; this summary does not waive any required test family.

- Native declared BLOB UUID inputs require **padded** URL-safe base64. An unpadded fixture encoder initially caused 400 responses; the corrected fixture and 1000 seeded round-trip vectors retain `==` padding. Production codecs still need full trust-boundary validation and declared-field mapping tests.
- Installed native list defaults to 50, `.list({ pagination: { limit: 0 } })` omits zero and returns a page, and direct native `?limit=0` yields zero rows. The 1000 cap and two bounds on one scalar column were exercised on 1001 real records.
- The reference range is inclusive; later limit/range calls replace the limit while an earlier range offset persists. Awaiting the same reference insert builder twice sends it again, demonstrated by a successful first insert and duplicate-key failure on the second. These are observations to formalize under G4, not permission to memoize or duplicate mutations arbitrarily.
- Real SMTP confirmation and explicit password login, native nullable registration result versus reference user/null session, protected owner CRUD/views, and missing/forbidden mutation differences have initial upstream checks. Duplicate-account/mail-outage/full browser application behavior remain separate required cases.
- Real two-session local/global logout and native refresh-token retention were exercised. Native stateless access-JWT residual validity is distinct from refresh revocation. Storage/expiry/concurrency/hydration/remote-outage behavior is not thereby certified.
- A healthy real native stream supplied INSERT/UPDATE/DELETE. Replaying its captured INSERT frame through the **installed** native parser one byte at a time loses the event. This confirms a reuse blocker, not a working fallback; G5 recommends the planned minimal buffered native HTTP path unless an upstream fix is pinned and retested.
- The installed reference Realtime SDK documents that default `SUBSCRIBED` can mean channel join **before Postgres Changes is ready**. Its `postgres_changes_options.wait` option waits for CDC readiness. The upstream event probe uses this test-only configuration rather than arbitrary sleeps; no new option is silently added to the future SDK contract. TrailBase stream lifetime is now characterized as connection-scoped per upstream [#299](https://github.com/trailbaseio/trailbase/issues/299); G6 still needs readiness/payload/DELETE-security decisions and broader lifecycle/resource evidence.

## Blocking G1 regression: duplicate pending registrations

Real native v0.34.3 probes on 2026-10-03 fail confirmation with **HTTP 400** after two registrations for the same unconfirmed address. The pinned [auth migration](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/migrations/main/U1785764695__unverified_email.sql) makes only verified `email` unique; `unverified_email` has no unique index. [Registration](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/register.rs) inserts each pending row, and [verification](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/verify_email.rs) updates all matching pending addresses, conflicting with verified-email uniqueness. The observed result is blocked confirmation, not evidence of privilege escalation.

Real SMTP shutdown yields native HTTP 424 and reference HTTP 500 with no session. Native registration inserts before delivery; retries while SMTP is down return 424 again, rather than an opaque success. After restart, a healthy fresh control account can confirm, and retry mail reaches the failed address. Delivery alone is not recovery: the retained duplicate pending rows must still pass confirmation/login. Keep that regression red rather than silently adding constraints to native system tables or pretending a client-side deduplication guard fixes direct backend calls.

G1 and Phase A contract completion are **blocked** pending a maintainer decision: upstream fix/verified repin, or a separately reviewed deployment constraint with baseline-versus-mitigated evidence. No auth-schema workaround, scope exception, or signoff has been approved. Confirmed-duplicate/password-preservation checks and the prior green foundation reports do not certify this new failure path.

### Authorized deployment-migration investigation

The maintainer authorized investigation (not live deployment or G1 signoff) of an explicit auth uniqueness requirement. [The candidate and prerequisites](AUTH_MIGRATION_INVESTIGATION.md) preserve stock-versus-mitigated contexts/reports. A unique pending index and cross-column INSERT/UPDATE guards resolve the duplicate confirmation flow in an opt-in native depot; they refuse ambiguous existing identities instead of merging/deleting accounts.

Uniqueness alone does **not** resolve SMTP recovery. The pinned public resend handler looks up verified `email`, while the failed registration is stored only as `unverified_email`. Candidate retries then correctly hit the reservation guard but cannot generate a missing confirmation message. G1 stays blocked pending a safe native recovery capability/approved deployment process and all remaining checks; client-side fake verification or automatic account deletion is not acceptable.

## Decisions requiring characterization/signoff

All are **open** until the corresponding executable tests and evidence exist.

| Gate | Decision / blocker | Evidence required |
| --- | --- | --- |
| G1 | Approve the signup null-user exception and explicit post-confirmation login flow, or require a native capability change | Registration responses and complete mail-confirmation E2E on both backends |
| G2 | Approve portable field mappings, supported scalar domains, and explicit page cap | Real schema/serialization tests, UUID round trips, boolean/null/default tests, 50/1000/cap boundaries |
| G3 | Approve mutation no-op/error differences without weakening authorization | Missing-row/forbidden-row/constraint results and database postconditions on both backends |
| G4 | Approve narrow ordering and exact builder execution/limit-range/cardinality contract | Reference SDK traces, null/text/numeric fixtures, repeated-query and call-order characterization |
| G5 | Choose installed SDK SSE reuse, fixed upstream version, or a minimal buffered fallback | Fragmentation/loss/cancel characterization using the installed distribution and real streaming backend |
| G6 | Approve realtime payload subset, connection-scoped stream lifetime, and DELETE security limits | Two-session/owner isolation E2E, payload captures, expired-token handshake denial, established-stream expiry characterization, revocation/error and cleanup checks |
| G7 | Approve supported user fields, persistence/refresh lifecycle, and global/local logout behavior | Status/refresh/logout traces, outage and race tests, two sessions, no-secret evidence |

An approved exception needs a named maintainer, rationale, affected test IDs, and user-facing documentation. A failed required behavior is a blocker, not an exception that a test normalizer may erase.

## Primary sources

### TrailBase

| ID | Official documentation / pinned implementation |
| --- | --- |
| TB1 | [Record APIs](https://trailbase.io/documentation/apis_record/), [pinned document](https://github.com/trailbaseio/trailbase/blob/v0.34.3/docs/src/content/docs/documentation/apis_record.mdx) |
| TB2 | [Models and relations](https://trailbase.io/documentation/models_and_relations/), [type safety](https://trailbase.io/documentation/type_safety/) |
| TB3 | [Record client source](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/assets/js/client/src/record_api.ts) |
| TB4 | [Auth/client source](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/assets/js/client/src/client.ts), [JWT claims](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/jwt.rs) |
| TB5 | [List handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/records/list_records.rs), [filter validation/limits](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/listing.rs) |
| TB6 | [Update handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/records/update_record.rs), [delete handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/records/delete_record.rs) |
| TB7 | [Native row serialization](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/schema/src/json/record.rs) |
| TB8 | [Schema endpoint](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/records/json_schema.rs), [schema construction](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/schema/src/json_schema/mod.rs) |
| TB9 | [Auth documentation](https://trailbase.io/documentation/auth/), [registration handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/register.rs) |
| TB10 | [Status handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/status.rs), [token validation](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/tokens.rs) |
| TB11 | [Refresh handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/refresh.rs) |
| TB12 | [Global/local logout handlers](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/logout.rs) |
| TB13 | [Change event definitions](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/records/subscribe/event.rs), [subscription permission checks](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/records/subscribe/handler.rs) |
| TB14 | [Install/run](https://trailbase.io/getting-started/install/), [migrations](https://trailbase.io/documentation/migrations/), [production](https://trailbase.io/documentation/production/) |

### Supabase

| ID | Official documentation / pinned implementation |
| --- | --- |
| SB1 | [Initialize](https://supabase.com/docs/reference/javascript/initializing), [TypeScript support](https://supabase.com/docs/reference/javascript/typescript-support) |
| SB2 | [Select](https://supabase.com/docs/reference/javascript/select), [insert](https://supabase.com/docs/reference/javascript/insert), [update](https://supabase.com/docs/reference/javascript/update), [delete](https://supabase.com/docs/reference/javascript/delete) |
| SB3 | [Equality](https://supabase.com/docs/reference/javascript/using-filters-eq), [inequality/nulls](https://supabase.com/docs/reference/javascript/using-filters-neq), [order](https://supabase.com/docs/reference/javascript/using-modifiers-order), [limit](https://supabase.com/docs/reference/javascript/using-modifiers-limit), [inclusive range](https://supabase.com/docs/reference/javascript/using-modifiers-range), [single](https://supabase.com/docs/reference/javascript/using-modifiers-single), [maybeSingle](https://supabase.com/docs/reference/javascript/using-modifiers-maybesingle) |
| SB4 | [Signup](https://supabase.com/docs/reference/javascript/auth-signup), [password auth and local mail testing](https://supabase.com/docs/guides/auth/passwords) |
| SB5 | [Pinned auth client](https://github.com/supabase/supabase-js/blob/v2.117.2/packages/core/auth-js/src/GoTrueClient.ts) |
| SB6 | [Get session](https://supabase.com/docs/reference/javascript/auth-getsession), [get user](https://supabase.com/docs/reference/javascript/auth-getuser) |
| SB7 | [Sessions and rotation](https://supabase.com/docs/guides/auth/sessions), [refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession) |
| SB8 | [Sign out scopes and residual JWT lifetime](https://supabase.com/docs/reference/javascript/auth-signout), [auth event listener](https://supabase.com/docs/reference/javascript/auth-onauthstatechange) |
| SB9 | [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database/application tests](https://supabase.com/docs/guides/local-development/testing/overview) |
| SB10 | [Postgres Changes setup, payloads, RLS and limits](https://supabase.com/docs/guides/realtime/postgres-changes), [subscribe status](https://supabase.com/docs/reference/javascript/subscribe), [removeChannel](https://supabase.com/docs/reference/javascript/removechannel) |
| SB11 | [Pinned response/cardinality implementation](https://github.com/supabase/supabase-js/blob/v2.117.2/packages/core/postgrest-js/src/PostgrestBuilder.ts), [query modifiers](https://github.com/supabase/supabase-js/blob/v2.117.2/packages/core/postgrest-js/src/PostgrestTransformBuilder.ts) |
| SB12 | [Local migrations](https://supabase.com/docs/guides/local-development/overview), [CLI local development](https://supabase.com/docs/guides/local-development) |

Non-official generated documentation found during search was not used as an authority. Source review informed risks; it did not replace executable conformance checks.
