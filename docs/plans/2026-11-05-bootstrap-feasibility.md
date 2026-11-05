# Standard bootstrap feasibility audit — decision pending

## Completed observations, not prospective proof

The [case-by-case comparison](../evidence/bootstrap-native-reference-comparison.md) and [source-bound extraction](../evidence/bootstrap-native-reference-observations.json) now distinguish actual native, legacy-adapter and reference results, exact permission/scalar/PK/envelope costs and missing sub-proofs. The one BM window is RELEASED; only archived bytes were inspected afterward. In particular, BM08 did not execute the planned missing/foreign UPDATE/DELETE comparison. Source-only predictions and earlier prospective wording below are not promoted into new runtime evidence. No carrier/architecture is selected; the later local evidence checkpoint does not change executed source or authorize another fixture.

## Authority and disposition

Mark's latest requirement is **limited feature coverage, exact corresponding supabase.js API and observable behavior for every claimed feature**. It is **not** all Supabase product features. The bounded MVP is incremental implementation toward that goal, not a permanent compatibility redefinition. A documented behavioral exception remains a compatibility gap. Implementation, verification and signoff are distinct.

Concrete acceptance: **no required TrailBase-specific `createClient` parameter or application-supplied mapping**. A compulsory app wrapper/import/registration/global/environment mapping merely relocates the violation. Standard optional Supabase options are fine. Backend provisioning is separate from Todo business logic, as it is for Supabase. Internal leases/codecs/channel runtimes must never become application setup.

This supersedes older required-mapping and explicit-auth-opt-in directions in PLAN/LEVEL1 for the target contract. Their implementation/evidence remain preserved, not silently reclassified as conforming. **Material architecture adoption is on hold for Mark's informed decision.** This audit adopts no resolver, manifest, gateway, fork, server patch, schema change or deployment. Daylist checkpoint **dcafdcf62f55ae8dc4175bb61c5b39bd33b74914** and live demo remain untouched. The user reports a separate limited static review of recorded Daylist source/test outputs with no actionable defect; that is not fresh-checkout review or release signoff.

## Exact current constructor and application

Current `src/index.ts:8–15,359–397`:

```ts
export type ClientOptions = {
  auth?: AuthOptions;
  db?: { schema?: 'public' };
  global?: { fetch?: typeof fetch };
  trailbase: TrailBaseMapping;
};
export function createClient<Database = unknown>(
  url: string, key?: string, options?: ClientOptions
) { /* validates options and options.trailbase before returning */ }
```

Although `options` is syntactically optional, runtime validation requires it and a nonempty `trailbase.tables` map with API name, primary key, field codecs/nullability and optional read-only metadata. `from()` synchronously consults that map. `key` is type-checked but not used for native authorization. URL must be an HTTP(S) origin without credentials, path, query or fragment. Public client currently contains only `auth` and `from`.

`examples/todos/main.js:5–12` calls `createClient(location.origin, undefined, { trailbase: ..., auth: { storageKey: ... } })`. The three-argument form itself is normal Supabase syntax; **the compulsory nonstandard `trailbase` member, undefined key versus the reference's required key, and hidden auth opt-in are the problems**. `auth.storageKey` is a standard optional option, not intrinsically TrailBase-specific.

`src/auth.ts:70,90,562–576` enables auth only when `options.auth` is supplied. Without it, even `getSession()` throws `UnsupportedFeatureError`. Removing only the mapping validation would not provide standard defaults.

Installed official **@supabase/supabase-js2.117.2** has `createClient(supabaseUrl: string, supabaseKey: string, options?: SupabaseClientOptions<...>)`; see installed `src/index.ts:48–71`, `src/lib/types.ts:108+` and [official reference](https://supabase.com/docs/reference/javascript/initializing). Its broader generics/options are not all required for the bounded milestone. Current installed/lockfile auth-js, storage-js and realtime-js versions are also2.117.2. No dependency was changed. Current Context7 docs were consulted for orientation; pinned installed source governs these version-specific findings.

### Reproduced offline, not inferred from signatures

On each exact Node22.23.2/24.21.0, five construction observations against actual built current SDK and installed official reference, with process-local network blocked:

- Official `createClient(URL, KEY)` constructs; empty-memory `getSession()` resolves null session/no error. Configured defaults are persist/auto-refresh/URL-session-detection true; this is configuration inspection, not browser callback behavior proof.
- Candidate two-argument call throws at missing options.
- Candidate standard auth options without a TrailBase map still throw.
- Candidate legacy map without auth constructs, then `getSession()` throws unsupported.
- Candidate legacy map plus standard auth options constructs and returns null session/no error.

**Zero network calls**, no backend/accounts/data. These prove two concrete incompatibilities, not full constructor/auth or same-Todo parity. No source/runtime fix was made during this audit.

## What official0359 metadata actually supplies

Pinned public source was fetched read-only from official commit **a106ce6338f9831140c92ac16e051901ed92d576**, not assumed from an old local source directory:

- [Schema route/authorization](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/core/src/records/json_schema.rs), especially25–56: per-record-API schema lookup; table-level **SCHEMA** permission and schema access rule checked with the ordinary optional user. This is not admin discovery. A READ or CREATE grant alone is not a SCHEMA grant.
- [Schema generation](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/schema/src/json_schema/mod.rs), especially88–357: title, properties, required fields, JSON definitions and primitive wire types. Insert/Select/Update modes differ; omitted mode defaults to Insert. Enum spellings in this source are `Insert`, `Select`, `Update`.
- [JSON-check extraction](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/schema/src/db/metadata.rs),407–455: recognized `jsonschema` / `jsonschema_matches` checks, not arbitrary SQL CHECK interpretation.
- [Record API configuration](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/core/proto/config.proto),266–347: API/table names, world/authenticated ACLs, excluded columns, access rules and expansions are server configuration. They are not all included in the public JSON schema.

The route is `/api/records/v1/<api>/schema`. This is source evidence, **not a new captured live response** or proof that an arbitrary deployment/user grants access. No admin endpoint, browser admin credential, live schema/data query or permission change occurred.

### Completeness barrier for this Todo schema

The existing fixture DDL uses BLOB UUID primary/owner keys, INTEGER `completed` with a0/1 CHECK, other INTEGER fields and TEXT. From the pinned generator/extractor:

- Ordinary BLOB **and** TEXT emit JSON `string`; `is_uuid_v4(...)`/FK semantics are not emitted as UUID codec declarations.
- `completed` emits `integer`, like `priority`/`created_at`. A0/1 range constraint is not a declaration that JavaScript values must be boolean. Other integer domains can legitimately contain0/1.
- No explicit primary-key marker is emitted. Required/default-derived fields do not uniquely identify a PK, especially with other defaulted fields. Assuming the name `id` is unsafe; the existing `integer_todos` fixture deliberately uses `todo_key`.
- Custom JSON `$defs` can describe configured JSON values; that does not restore missing raw BLOB/PK/boolean semantics for the existing table.
- API aliases, read-only intent and permission policy are not a complete portable runtime mapping in that envelope. The backend remains the authorization layer regardless.

Thus **ordinary official0359 JSON-schema discovery alone is insufficient to reconstruct all necessary current Todo semantics safely**. This does **not** prove that the whole existing mapping is necessary: the deeper native-mechanism audit below eliminates some requirements. The remaining output/PK/filter ambiguities are lossy information, not something erased TypeScript generics or sampling row values can solve. Converting every UUID-looking string corrupts legitimate text; converting every0/1 integer corrupts integer columns. Never fetch all records to infer types.

### Least-privilege and lifecycle constraints

Any future metadata mechanism must not require table READ for create-only clients, expose admin credentials/configuration, auto-grant SCHEMA/world access, bypass access rules or trust cross-origin redirects. Structural metadata disclosure is itself a security choice. Failure/denial/ambiguity must fail closed before unsafe writes, not trigger an admin fallback or guesses. Resolve only the named API rather than enumerate unrelated tables. Cache ownership, origin/schema-version binding, role changes, stale metadata and auth replacement require tests; a cached user ID is not an owner-lifetime proof.

## Reduce requirements first: concrete native mechanisms

The existing full per-field application map is **not a proven minimum**. Additional exact-commit source review found:

1. **No API-to-table map is necessary for the basic profile.** Resolve `.from('todos')` to native RecordApi name `todos`. Native `RecordApiConfig.name/table_name` already supplies the server-side alias; the SDK need not learn its underlying SQL table. Different public/API-name aliases can remain unsupported. This is ordinary backend provisioning, not app mapping.
2. **Canonical UUID mutation JSON and record-ID paths need no SDK BLOB conversion.** [Native scalar conversion](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/schema/src/json/mod.rs),80–116, recognizes36-character UUIDs for BLOB columns; TEXT remains text. [RecordApi primary_key_to_value](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/core/src/records/record_api.rs),589–597, delegates using the actual PK type. Server-side column knowledge avoids guessing. This is pinned-source proof, not a new real mutation run.
3. **JSON mutation booleans already convert to native INTEGER0/1**, `flat_json_to_value` lines18–41. That removes a body-encoding need, not the need to return true/false instead of0/1 on reads. Filter encoding is a separate path.
4. **Do not generalize UUID support to filters.** [filter.rs](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/core/src/records/filter.rs),45–77, base64-decodes BLOB filter strings, rather than UUID-parsing them. A canonical UUID can decode as27 unrelated bytes, not its16-byte ID. A schema-aware UUID filter encoder is still needed if claimed. The actual basic Todo has boolean read filters and UUID PK mutation predicates routed to record-ID paths, not arbitrary UUID read filters.
5. **Native JSON columns can avoid boolean output conversion.** A server-declared TEXT JSON column using `jsonschema`/`jsonschema_matches` with boolean schema receives validation/JSON serialization in [params/mod.rs](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/core/src/records/params/mod.rs),437–526, and is read as raw JSON by [record.rs](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/schema/src/json/record.rs),99–129. Public schema has its boolean `$defs` instead of generic integer. This reduces a requirement using an existing native mechanism, **but changes physical schema/storage/defaults/index/filter behavior** and needs real tests. A plain `json_type` CHECK alone does not trigger native JSON metadata. No migration is authorized.
6. **PK field name remains necessary for safe generic update/delete.** Knowing the caller wrote `.eq('id', value)` does not prove `id` is native PK. Native path routing consumes only a record ID. The [transaction API](https://github.com/trailbaseio/trailbase/blob/a106ce6338f9831140c92ac16e051901ed92d576/crates/core/src/records/transaction.rs),22–36, also takes `record_id`, not an arbitrary atomic SQL predicate. Read-ID-then-write loops add READ, races and side effects; they are not a fix.
7. **Do not blindly delegate unknown-column validation.** Native Params explicitly filters unknown fields rather than rejecting them, lines355–357. Supabase/PostgREST unknown-column failures cannot be matched by silently dropping fields. A trusted write-column allowlist may still be needed even when native handles scalar conversion. Do not expose excluded/private fields just because default Insert schema contains them; Select schema hides underscore-prefixed columns.

Consequently a smaller possible internal description is **PK identity + necessary output/filter exceptions + allowed write columns**, not necessarily the old API/table/all-field/nullability/codec map. Whether ordinary schema plus authoritative exceptions is enough needs differential tests. Missing metadata must not be replaced by value-shape heuristics.

### Can representation/conventions make basic Todo metadata-free?

**Not established for the existing Todo schema.** Its canonical UUID IDs/owner fields must be returned as canonical UUIDs, `completed` as boolean, and PK predicates must target the intended column. JSON booleans solve one of those; integer IDs reduce UUID PK work only if the *same* agreed app/model on both backends stops generating UUID IDs. Current app explicitly generates UUIDs, inserts `user_id`, reads `select('*')`, filters completed and mutates by `id`; that is the baseline, not a license to quietly change business logic.

Canonical TEXT UUID data columns avoid BLOB output conversion, but a native RecordApi requires integer or UUID-BLOB PK; `metadata.rs:541–632` recognizes suitable PKs/UUID checks. An arbitrary TEXT PK is not a drop-in native solution. Views retain PK/type/mutation constraints. Extra hidden BLOB identity plus public canonical text, generated values/triggers or owner columns could be researched as a backend profile, but require proof of identity equality, native create/RETURNING acknowledgements, foreign keys, permission evaluation, defaults, update/delete and events. Hiding an internal field from native output does not by itself give the same Supabase `select('*')` shape. No such profile is adopted or claimed working. A fixed `id` convention without authoritative enforcement/verification can hit the wrong authorized row (proof M02).

## Concrete alternatives: source, permissions and deployment lifecycle

These are distinct candidates, not interchangeable names for a map. **No adoption or premature decision request.**

| Approach | Actual source and normal client permission | Lifecycle / concrete limitation |
| --- | --- | --- |
| Existing per-API `/schema` + native scalar handling | Native running API/DB; ordinary SCHEMA ACL + rule, independent of READ/CREATE | Generic package, no new endpoint, but missing PK/output semantics for current Todo. Three modes/local JSON definitions need handling. Anonymous, CREATE-only and schema-denied clients remain unresolved. |
| Native JSON-schema annotation carrier | Existing `jsonschema_matches`/registered JSON schema preserves its pattern under `$defs`; ordinary SCHEMA on the existing route | Could carry a generated internal descriptor in a hidden JSON column/definition without a new endpoint. It still adds backend DDL/config; Insert versus Select hidden-field behavior and validator support require real proof. Copied PK/codec annotations are a second truth unless generated/checked against actual schema. Not implemented or claimed viable. |
| Reduced interoperable native schema/profile | Existing native JSON semantics + backend-provisioned IDs/API names, not app annotations | Potentially less metadata; existing UUID Todo still lacks safe PK/UUID output resolution. Changes require dual-schema/data migration and exact existing-source Todo proof. A hardcoded or unchecked profile is not generic compatibility. |
| Operator-generated static same-origin artifact | Deployment tooling reads actual schema/RecordApi config plus explicit native semantic declarations; browser reads a narrowly published artifact | Generic package possible, but adds a deploy artifact and public structural disclosure. DB/config/file publish and rollback are not atomic by default. CDN/browser caches, partial rollout and unchanged JSON schema with changed PK must be addressed. Handwritten application maps or wrapper imports are disallowed. |
| Generated catalog stored in same DB and exposed through an ordinary read-only native API | Metadata rows generated with migrations; clients get only catalog READ, not target-table READ/admin | DB DDL + catalog can share a transaction (M06); config reload/replicas, separate HTTP lookup/write race (M07), response visibility and catalog ACLs still need proof. It adds backend schema/API and permission surface, not a zero-setup library. No catalog has been installed. |
| Deployment-generated artifact bundled in a private client build | Operator build consumes authoritative metadata; no runtime metadata network permission | Couples package/bundle to each deployment/schema. CDN/cache/offline bundles and rollback can retain stale codecs; a browser cannot independently certify current DB from an old bundle. Required app import/registration of mappings is unacceptable; whether a deployment-specific build itself is acceptable is a future informed choice. |
| Enriched official native schema contract | Native owns PK/JSON/wire/logical descriptors and authorization in one ordinary route | Best direct source-of-truth location conceptually; not present in inspected0359 envelope. Boolean logical intent still needs an actual declaration, not inference from0/1. Requires upstream feature/version availability and proof; no patch, fork, outreach, repin or deployment authorized. |

Request/deployment costs are concrete: ordinary schema discovery may need separate Insert/Select mode reads; a combined static/catalog descriptor is at least one additional metadata read per uncached API/epoch; a bundled build adds no metadata network request but loses runtime freshness. These are design costs, not measured latency estimates or adopted call counts. Metadata must be resolved lazily inside execution, not by changing synchronous `createClient`/fluent builder APIs. Extra metadata requests can introduce authentication/permission failures and refresh events and need differential testing.

A SQL introspector can deterministically recover PK/native type facts (M05), **not arbitrary intended logical boolean or UUID meanings**. An authoritative `is_uuid` CHECK/FK chain or native JSON declaration is stronger than sampled data; constraints/aliases must be parsed with real semantics, not guessed by regex/name. If a generator needs an explicit logical model, its source belongs in reviewed backend schema/provisioning, not a second app-maintained map. A handwritten deployment JSON file can still become a second drifting truth; calling it generated does not solve that.

### Security and drift rules common to candidates

- **Permission:** never require READ to obtain an INSERT-only path, auto-grant SCHEMA, publish admin configuration or use privileged discovery in browsers. Metadata ACL denial must stay a real error. An ordinary catalog READ grant is itself an additional permission/deployment decision, not identical to native SCHEMA or free access. Per-user schema rules mean an A-visible cache must not silently become B-visible metadata.
- **Published minimum:** API name, verified identity/codec/write-column facts only; no rows, SQL bodies/default secrets, credentials, auth realm tokens, unrestricted table catalog or excluded columns. Raw DDL can leak more than intended; inspect it only inside the operator boundary. Generated SQL identifiers/data must be safely handled. JSON schemas are untrusted input: bounded size/depth, safe keys, allowlisted descriptors/local `$defs`, no remote `$ref` fetch or executable evaluator.
- **Source binding:** cover actual table/PK/constraints, native API alias/excluded columns/semantic declarations and deployment realm, not just a file timestamp or a lossy public JSON-schema hash. Same wire JSON can hide a PK change (M01). DDL hash improves detection but is not browser-verifiable without an authoritative matching source.
- **Lifecycle:** generate/validate from the same migration source; fail the build on unresolved/ambiguous facts; publish with the matching DB/config; verify rollout and rollback; invalidate caches on relevant schema/role/owner change. Existing private auth/operation lifetime must apply internally, never an app token getter/lease opener. Current three AL cleanup failures remain open.
- **Race:** transactionally updating DB/catalog prevents some split-source drift, not the gap between HTTP metadata lookup and write. A hash, ETag, signature or fresh fetch does **not** supply a native atomic expected-schema precondition. No such generic precondition was found in inspected record/transaction contracts. Any immutable-profile/maintenance/versioned-API deployment restriction needs explicit disclosure and proof, not an unannounced rollout assumption. Mixed/rollback handlers must be assessed; receipts do not detect server versions.
- **Safety failure:** wrong-PK metadata can write the wrong allowed row, not just throw. Rejecting unknown metadata is safer than guessing, but rejection is availability loss and still fails Todo acceptance. Never retry writes after metadata refresh, add hidden read-back, weaken RLS or label deployment failure compatible.

No deferred feature implies a gateway/fork. These comparisons identify costs to measure; none authorizes one.

## Small non-deployed contract proof and remaining measurements

Runnable [prototype](../prototypes/bootstrap-metadata-contract.mjs):

```sh
node docs/prototypes/bootstrap-metadata-contract.mjs
```

Uses only built-in Node SQLite/assert/crypto, generated in-memory databases, no listeners/network/filesystem database or installed service. **Nine controls passed on each exact Node22.23.2/24.21.0**, all7databases explicitly closed. M01–M08 first ran in a separate private eight-control script; those raw results remain separate, not replaced by the later public proof.

- M01: all three modeled schema modes match while actual SQLite PKs differ.
- M02: assuming `id` routes the same value to a different logical row under another PK.
- M03: actual SQLite BLOB/TEXT values can produce the same modeled wire value/schema.
- M04: INTEGER0/1 storage cannot choose between legitimate target boolean/integer contracts.
- M05: actual deployment-only PRAGMA introspection recovers PK/native types/fingerprint but deliberately leaves logical codecs unresolved.
- M06/M07: actual DDL/catalog rollback is transactional; even a fresh fetched epoch races a later migration before an independent operation.
- M08: actual SQLite JSON boolean representation can eliminate a modeled output conversion; the native semantic CHECK/serializer path is separately source-reviewed, not faked by this test.
- M09: canonical UUID bytes and its base64-decoded filter bytes differ, demonstrating why the two pinned parser paths must not be conflated.

**Qualification:** scalar/required wire schemas and parser contrasts are explicitly limited source-derived models, not executed Rust/HTTP responses. SQLite PRAGMAs/writes/transactions are real local engine operations, not pinned TrailBase SQLite3.54.1/real Supabase compatibility qualification. No success is claimed for permissions, generic resolver, same-source Todo, schema migration, mixed deployment or native JSON-column E2E. Constructor controls independently execute the actual two clients; AL controls execute actual built Core/Fetch. Keep those scopes separate.

Before an informed architecture choice, useful remaining measurements are: exact schema/JSON-column/list/filter/write results under anonymous, SCHEMA-only, READ-only, CREATE-only and ordinary authenticated roles; absent/denied metadata with no write effect; excluded/renamed fields and API aliases; actual PK swap/conflicting metadata without mutation; JSON boolean defaults/filter/index/round trips; static-vs-catalog rollback and stale/in-flight rollout; packaged same-source Todo behavior. These need a reviewed frozen plan and a **fresh bounded handoff**, not reuse of the released47c fixture. No live demo changes, no architecture adoption.

## Claimed-path gaps versus legitimate deferral

**Concrete gaps in current implemented candidate paths:**

1. Constructor mapping/auth defaults above. Public key acceptance currently is not Supabase key enforcement; never invent a native API-key security model or send service/admin credentials to browsers. Standard call spelling and real authorization semantics are separate questions.
2. Query results expose `{data,error}` only, while the reference exposes `count/status/statusText` as well. Current row mapping creates null-prototype objects. Cardinality errors are `CardinalityError`, not complete PostgREST error/result parity. Error classes/fields/nullability and synchronous-throw versus asynchronous-result boundaries need differential verification.
3. Native missing/foreign mutation403 versus reference RLS zero-row success is a recorded behavior difference. Native constraint status/codes also differ. A documentation exception is not100% compatibility, and blanket403-to-success or invented SQL error codes would hide security/failures.
4. Current signup null-user/session, pending registration409 and the narrow user/session shape remain gaps against corresponding reference behavior/configuration. Do not fabricate identity metadata, timestamps or successful fields. Existing accepted MVP limitations are historical delivery decisions, not new exact-parity signoff.
5. Auth defaults, storage formats, persistence/refresh/callback timing, owner/expiry/logout races and returned fields need the selected real reference contract. Residual issued-JWT validity is **not automatically a difference**: the reference also has limits; compare rather than assume.

**Explicitly unsupported is not itself a defect:** projected reads, mutation returning, bulk/upsert, relationships, RPC, Functions, additional schemas/options, OAuth/SSR/MFA, Storage and unshipped Realtime may remain outside selected coverage. Do not implement them merely to fill a product checklist. Existing basic Todo uses `select('*')`, supported filters/order/range and separate ordinary single-row writes/read refresh; it need not be rewritten to mutation `.select().single()`. Explicit owner IDs/UUID generation are application choices supported by both backends, not inherently TrailBase-specific APIs.

Storage and Realtime lanes are private, unmerged candidates, **not supported public features**. Read-only lane feedback was checked against root constructor/auth and installed reference, with later scope/citation corrections retained:

- Storage path normalization/default MIME/cache behavior, StorageError semantics and lazy memoized `download()` cannot inherit CRUD's fresh-per-await behavior. Old stricter-path interpretations are not approvals under this goal. UUID-only paths are an optional sample convention, not SDK validation parity. The injected reference duplicate response is not a real backend golden.
- Native upload200/metadata/download500 remains a genuine failure, not repaired by requiring application read-back. A hidden GET also adds READ permission to an INSERT-only upload path and cannot prove rollback/durability. Leave Storage unavailable rather than promote the prototype.
- Realtime fluent/default unsubscribe behavior, payload fields/visibility and lifecycle require exact selected proof. Default timeout/error outcomes are observable even if optional timeout configuration is deferred. No fake commit timestamp/full old row or weakened native permission rule. Broadcast/Presence and unrelated channel features may stay unsupported. `removeChannel` is required only if selected/advertised, not automatically for a Todo using standard `channel.unsubscribe()`.
- Sample optional MOCK/unavailable panels demonstrate UI preparation only. They do not establish reference-compatible supported Storage/Realtime or full same-source Todo parity.

## Independently fixable API work versus backend-dependent barriers

| Work | Can be evaluated without selecting a metadata architecture? | Boundary |
| --- | --- | --- |
| Decouple auth construction from table map; standard optional options/auth defaults; corresponding public types | **Yes**, isolated client-side TDD is possible | Do not make a constructor-only pass look like working CRUD. Removing validation/marking map optional does not supply safe data behavior. Keep unimplemented calls explicit. Full applicable auth/regressions still mandatory. |
| Plain result objects; default `count/status/statusText`; error object/classes and cardinality envelope | **Mostly**, pinned reference controls and current native facts can drive tests | Verify each status/value/error boundary; do not copy wrong native status, invent count/backend SQL codes or use unsafe prototype setters. Invalid-input timing/thenable behavior belongs in the comparison. |
| Remove redundant UUID/body boolean conversion internally | **Potentially**, supported native source already provides it | Must prove real native body/path behavior and retain validations/security. Do not apply to BLOB filters or output. No runtime change was made here. |
| Map native403 to reference zero-row mutation success, constraint status/codes | **Not safely by formatting alone** | Missing/foreign/no-op/forbidden are not sufficiently distinguished by a blanket403 mapping. Preserve denial. Native evidence/reference oracle or backend guarantees are needed. |
| Full User/session fields, signup user/null/duplicate semantics | **Mixed/needs endpoint facts**, not solved by DB metadata | Client formatting can fix known shape/defaults; absent server identity/timestamps/confirmation facts must not be fabricated. Audit ordinary supported auth endpoints before claiming a server change is necessary. Existing signup409/null limitations remain. |
| Generic safe mutation PK and current BLOB/boolean output semantics without app maps | **No complete existing solution proven** | This is the metadata/backend-representation decision still under investigation, now with reduced requirements. |

Nothing in the independent column has been implemented or signed off in this audit. No need to wait on all missing Supabase features, and no need to adopt a manifest to test a result-envelope correction. Conversely fixing an envelope does not resolve a backend semantic difference.

## Incremental route and measurable same-source gate

**Proposed evaluation mechanism, not adoption:** standard constructor with standard auth defaults, SDK-private resolution of complete authoritative backend metadata, no app codec/runtime plumbing. Official0359 schema can provide part of that metadata, not all. Resolve the missing-semantic-source decision with Mark before implementation.

Target spelling (illustrative; **does not work with the current candidate**):

```js
import { createClient } from '<selected SDK package>';
const client = createClient(PROJECT_URL, PUBLIC_KEY);
// The same supported Todo application receives client on both backends.
```

Standard optional settings may be identical on both. Only package/import selection, URL and appropriate public credentials change. Appropriate native key handling must be decided honestly; an unused key must not be portrayed as a security mechanism. No map, custom native owner/lease/channel opener, required adapter/global or environment side channel enters Todo code.

After an informed decision: write constructor/default/type/security regressions first; implement the smallest internal metadata/default change; then run **the same agreed Todo source and supported calls** against pinned real Supabase and isolated official TrailBase, including real confirmation/login, scalar round trips, ordered pages, owner/missing/denied mutations, error/result shapes, refresh/persistence/logout and teardown. Include malformed/denied/stale metadata and no-extra-READ create cases where claimed. No successful auth/data stubs for primary comparative E2E. Mock UI and independently seeded demos do not prove parity or migration. Scope every optional argument/path explicitly; no silent ignore, behavioral exception renamed as support, skipped failure or invented field. Preserve all current regression assertions and historical reds.

Planning checkpoint: no fixture was then assigned. Standing direction already authorizes isolated, non-deployed proofs: **no fresh Mark approval is required**. Storage/Realtime conditionally yielded the next exclusive window, not a host/resource audit or allocation. The [bounded native/reference plan](2026-11-05-native-metadata-proof.md) received a read-only independent GPT6.1Sol/high plan review; the subsequent exact419file implementation freeze83b4fc3a was independently reviewed and **rejected on four concrete release/parsing/termination/postcondition blockers**. Both-pin offline checks passed but do not override that failure. Execution initially stopped with zero live guards/allocations/dispatches. User then requested only those four fixes:20offline controls observed4PASS/16FAIL then20/20PASS each pinnedNode, with bounded controller/scalar/full-effect repairs. These synthetic/source/pure controls are not native runtime success. Fresh current-source checks/new freeze/exact review and then unchanged fresh strict clearance still precede any dispatch; zero allocation/dispatch remains. Source/controller freeze, once-only scopes, unchanged competition/capacity/ownership/original-demo guards, owned isolation, separate CREATE-only fixture-administrative cleanup without added DELETE grants, independent teardown audit and explicit release remain mandatory. Remote main must be inspected/reconciled before any eventual normal push; unexpected divergence stops work, no force/rebase/reset shortcut. Exact pushed-commit CI/artifacts must be inspected, not inferred. No push/CI or new commit was performed for this audit.

Completed follow-through: the four bounded repairs and R3 error-preservation followup passed24repair controls/24ownership/3import/types/check/392units per pinnedNode. Independent exact462file review accepted freezef9b224; unchanged fresh strict guards passed and the one authorized native/reference fixture ran **BM01–BM09:9entered9PASS, once/retries0**. Separate CREATE-only administration proved1to0rows/audit+1each without SELECT/DELETE grants; independent resource/original-demo audit/archive1324/ownedsource removal passed and the window is **RELEASED**, owned liveTCP0. Rejected419/444freezes, observed reds and accepted source/root bytes remain preserved; no post-release global replay. These cases exercise expected native/reference differences and actual legacy-bootstrap Todo helper, not a mapping-free constructor, mounted browser application, new supported API or full compatibility. The architecture decision remains pending; no commit/push/CI/deployment/outreach or signoff.

## Migration implications

Application-call parity does not migrate the backend:

- Translate schema/defaults/constraints/indexes/sequences and safely convert UUID BLOB bytes, booleans, safe integers, nulls and timestamps. An epoch integer and a Postgres timestamp are not interchangeable without a chosen model. Preserve identities/order/BLOB bytes and validate postconditions.
- Translate native access rules to actual Postgres grants/RLS; do not assume automatic equivalence or weaken owner isolation. Trigger/FK side effects need explicit review.
- Auth identities/password hashes/confirmation state require a supported import or reset plan. Native JWT/refresh sessions and browser persistence cannot be reused as Supabase sessions; plan reauthentication and owned key cleanup. No fabricated auth attributes or automatic credential portability.
- Files/bucket/object metadata/ACLs and actual stored bytes migrate separately; Realtime transport/payload/publication configuration is another concern. None is implied by swapping a client import.
- Rehearse with generated owned fixtures and exact data/identity/access invariants after authorization, never the live demo. No migration implementation or live action is adopted here.

## Independent AL diagnosis — stronger hypothesis, no historical fix claim

Archived three cleanup diagnostics rehash to their existing47c hashes; real result stays **5entered/2PASS/3FAIL, RELEASED**. Native aggregate does not label the failing lease. Browser page-evaluate error transport omitted nested aggregate reasons; the private observation captured checks, not per-lease/body cancellation outcomes. This is a confirmed diagnostic information gap.

New source-bound offline controls use actual built unchanged Core/auth04699c57 plus native Fetch to a tiny synthetic owned loopback HTTP server, **not TrailBase/Supabase/auth/JWT/backend fixtures**. On each pinned Node, unread streaming and unread complete responses held across lease disposal cause native `body.cancel()` to reject **AbortError**, and Core correctly retains **AuthOperationCleanupError**. A fully EOF-consumed and unlocked control cancels successfully and its receipt fulfills. This explains how the observed class can occur without proving the original native/browser cause. It is **not** a proposed workaround that drains/replaces genuine responses or changes the real test challenge.

Owned mock sockets are explicitly closed/joined; the open-body case still had one socket before explicit platform teardown, so no natural/universal quiescence is claimed. A preliminary data-URL control had different behavior and is not a network substitute; a drained data response retained a reader lock. These distinctions remain recorded, not generalized away.

Do not ignore AbortError cancellation rejection, weaken assertions, rewrite historical failures or patch Core based on this possibility. Next warranted work is a narrowly reviewed test-only capture of actual held-response body state, original cancellation settlement and per-lease/plain nested browser errors, without changing successful wire bytes or promise identity. Genuine diagnosis needs a fresh handoff. No runtime fix is justified yet, and all three genuine failures remain open.
