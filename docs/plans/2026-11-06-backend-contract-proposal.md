# Backend contract proposal: authority first, transport second

## Disposition and scope

**Proposal for review, not selected architecture or SDK implementation.** Base is reviewed local commit `3852be86fb9fa8ae6aa87b6aae6fc951557936fa`; runtime source remains `e50637bd4aa604b6e5850047c7043eba901985b336a88ea7afa4e483e97bf749`, auth `04699c578cb3b208331e006e7a018b3378aae4ebf18bdc1a09031f76f1ef837d`. No dependency/pin/runtime/app/fixture/deployment/outreach change, new commit/push/CI or feature signoff is requested or inferred. Original demo is untouched; the completed BM window remains RELEASED and cannot be reused.

This answers the [measured comparison](../evidence/bootstrap-native-reference-comparison.md), not an abstract “where to put a mapping” question. Three separate contracts are necessary:

1. **Authority:** derive physical facts from the actual backend and declare logical meaning in one reviewed backend model. Reject disagreement before publication.
2. **Disclosure/access:** expose only the named operation's approved structural facts to an ordinary client, without requiring target READ/SCHEMA or privileged browser discovery.
3. **Execution/lifecycle:** bind a write to those facts across later migrations, cached clients, concurrent handlers and rollback. Authentic metadata is not a write-time precondition.

The concrete stock-server candidate below uses **generated, validated immutable API incarnations plus exclusive maintenance**. The competing stronger candidate is a **native atomic contract check** not available in the inspected official0359 interface. Neither is adopted. Offline SQLite/state-machine tests can test the specified invariants and their removal; they cannot certify real native config publication, ingress fencing, database recovery or multi-handler rollout. **Do not ask Mark to choose a carrier before those real gates pass.**

## Evidence that the proposal must not explain away

- BM01: all three complete public schemas can match except API title while actual PK differs. Guessing `id` can modify the wrong allowed logical row.
- BM02: CREATE does not imply SCHEMA or READ. Genuine INSERT-only succeeds without a read-back. A metadata permission is an added permission, not ordinary data access in disguise.
- BM03/04: native canonical UUID bodies/record paths work, but BLOB equality filters require padded base64. Base64 UUID output and INTEGER boolean output differ from canonical UUID/boolean values.
- BM05: native JSON-TEXT boolean reduces output conversion, but changes DDL/default/index/storage and does not prove numeric/string coercion parity. Current INTEGER codec is not qualified for this representation.
- BM06/09: both annotation and catalog preserve a false PK claim. Serving a descriptor—even over authenticated HTTPS—does not validate it against the backend.
- BM08: unknown fields can be dropped while a known PATCH field commits. Write-column facts are correctness requirements. Missing/foreign UPDATE/DELETE controls were not executed in that window; current envelope/cardinality/signup/default gaps remain independent.

These remain [source-bound observations](../evidence/bootstrap-native-reference-observations.json), not corrected compatibility results.

## 1. One authority boundary, not a self-authenticating descriptor

### Proposed backend release input and verification

A deployment owner maintains a **backend schema model/migration**, never an application constructor map, generated TypeScript type or value-sampling heuristic. It declares logical UUIDv4, safe integer, text/null and boolean semantics; these cannot all be inferred from SQLite storage classes. The migration produces actual SQL/config and a minimal published descriptor from the same input.

Before publishing, a deployment-only verifier must inspect the resulting **actual database**, effective native RecordApi configuration and native JSON definitions against that input:

| Fact | Required authority/check | Refuse when |
| --- | --- | --- |
| PK column and scalar domain | Actual PRAGMA/native metadata, exactly one non-null supported PK; actual UUID constraint/type where claimed | Name convention, required flag or public schema is the only evidence; unsupported/composite/ambiguous key |
| Logical codec | Explicit backend semantic declaration plus verified physical storage/constraints/native JSON declaration | BLOB merely looks like UUID, INTEGER has values0/1, or declaration disagrees with actual supported schema |
| Body/path/filter/output/ack encoding | Pinned, separately tested native protocol profile, not one universal codec | UUID body support is reused as UUID filter proof; create acknowledgement or output is assumed canonical |
| Public read/write columns | Effective native exposure/config plus declared public operation model; key writes/update restrictions explicit | Unknown columns dropped natively, excluded/generated/hidden columns published as ordinary writable fields |
| Defaults/nullability | Actual DDL and declared semantic defaults; omit values rather than synthesize them | JSON text default confused with SQL boolean; dynamic defaults leaked or guessed |
| Operation/permission policy | Effective grants/rules generated from the backend model; native remains final authorization layer | Metadata claims permission or grants target READ/DELETE just to make a workflow pass |
| Incarnation binding | Complete private binding of schema/constraints/triggers/defaults/API alias/exposure/rules/semantic profile/runtime profile | Any input affecting interpretation/authorization/side effects changes behind the same data route |

No general arbitrary-SQL parser/compiler is implemented here. A first real proposal should accept a **small exact schema/config grammar**, fail on unrecognized constructs and compare actual output rather than regex-guess semantics. Views, generated columns, arbitrary CHECK/UDF/trigger graphs and attached databases remain unresolved unless explicitly modelled and verified. UUID owner FK intent must be checked, not inferred from the column name.

A descriptor digest detects accidental byte changes only. A malicious/incorrect descriptor can recompute its own digest. The verifier must independently rederive physical facts and compare semantic/config inputs; clients cannot reconstruct those privileged facts from the lossy public schema. This trusts the deployment administrator, as both systems already trust administrators to enforce schema/RLS. It is not protection from a malicious server. Runtime SQL/admin access outside the release procedure is unsupported **and must not be advertised as detected by the SDK**.

### Public minimum, shown schematically—not a new exported type

For a named public API and operation, the descriptor needs:

- Contract-format version, logical name, non-reused incarnation and exact relative native data-route identifier.
- Supported PK name/domain and per-direction codec facts: UUID canonical body/path, padded-base64 BLOB predicate/output, validated padded native create acknowledgement; INTEGER-boolean or declared JSON-TEXT boolean explicitly distinguished.
- Exact public result fields where reads are supported; exact insert/update field sets, nullability/domain and omission rules. PK equality routing and key-update prohibition are structural constraints, not authorization grants.
- Only a protocol-profile identifier for tested semantics; no invented support for unqualified native versions or default/coercion/error behaviors.

Do **not** publish physical table names, raw DDL, SQL access rules, trigger bodies, secret defaults, excluded-field names, rows, account identifiers, credentials or internal auth/session locations. Keep the complete verification binding private. Even a raw hash of private low-entropy rule/default text can allow guessing; use an opaque incarnation/public-descriptor digest rather than expose the private binding hash.

A permitted create-only client still necessarily learns accepted field names/types, PK/ack behavior and its route. That **structural disclosure is the cost**. If the deployment will not disclose the minimum, the operation cannot be advertised through a generic validating client; no fallback to sampling, admin discovery or fabricated success.

## 2. Least-privilege named-operation discovery

The generic package would resolve metadata internally during execution, keeping `createClient(URL, KEY)` and synchronous fluent construction unchanged. No app map/wrapper/import registration/global/env/lease opener is allowed. This is a proposed internal flow, not an implemented standard constructor.

Candidate discovery: a deterministic, reserved **per-logical-API/per-operation ordinary read-only metadata API**, e.g. a naming convention for the descriptor of `todos` insert. Identifier limits, collisions, URL encoding, row cap and exact single-record result must be qualified on the pinned native server. The route exposes only the approved operation descriptor; untrusted request filters must not be the access-control boundary. A shared catalog whose unfiltered listing enumerates all APIs is **not equivalent** and requires separate disclosure approval.

- Grant metadata READ to the ordinary audience of the supported target operation, without target READ/SCHEMA/DELETE. Generate policy from the same backend model; verify actual ACL/rules. Native data rules still authorize every request. Metadata eligibility is not a capability to mutate a row.
- For anonymous CREATE support, the minimum insert metadata must be intentionally world-readable; otherwise defer anonymous CREATE, not silently require login. Authenticated CREATE-only is the initial proposed proof target.
- No metadata writes through ordinary clients. Keep metadata's own physical table unexposed for mutations, and provide no alternate ordinary target cleanup route.
- Missing/denied/malformed/ambiguous metadata fails closed before data dispatch; no target read, admin fallback, value inference or write retry. Surface the failure honestly—extra metadata failure paths are observable and still require reference-compatible contract evaluation.
- Cache by origin/deployment context, logical API, operation and actual auth-owner lifetime, not user ID alone. Clear/retire on logout or owner replacement; do not share an A-only disclosure with B. The existing private operation-lifetime contract must be honoured internally; historical AL failures are not resolved by this document.
- Metadata revocation does not erase already disclosed bytes or make cached descriptors authorization tokens. Backend rules must deny later data operations independently. If previously public field names must become confidential, a cache cannot un-disclose them; that is a deployment policy decision.
- Accept only bounded same-origin data, strict format/profile versions, exact scalar keys, local identifiers and supported fields; reject unknown/duplicate/remote-reference/executable/accessor/prototype-polluting metadata. No remote `$ref`, URL execution or fetch-following. Parser/security tests are still required; the lifecycle model is not a hardened metadata parser.

## 3. Official-server candidate: immutable route incarnations with exclusive maintenance

### Invariant that replaces an unavailable atomic native precondition

For every data URL ever published at an origin, **its interpretation never changes**: PK identity, scalar encodings, public columns, defaults, constraints/side effects and API policy remain the same for that incarnation. It may be retired to a deny/absent route, but must never be rebound, resurrected after retirement or used for another schema/realm. Retired route names remain consumed even across backup restore.

This is an **operator-enforced deployment invariant**, not something a descriptor/signature/cache/SDK can guarantee. Native0359 record/transaction inputs inspected here route by API name and record ID; no inspected expected-schema precondition atomically compares the client's contract with the write. A fresh `/schema` read does not close that gap. A future native atomic check is a distinct candidate below.

The proposed route name includes a non-reused incarnation, **not just a content hash**: restoring identical schema/config must not resurrect a retired URL. Opaque publication history/non-reuse records must survive independent of rollbackable application backups, or restoration must remain fenced. No such durable release controller/journal is implemented. Untracked old handlers or an unverifiable history make publication fail, not “probably safe.”

### State machine and required receipts

| State/transition | Required observable proof | Failure outcome |
| --- | --- | --- |
| PREPARE, not advertised | Compile candidate SQL/config/metadata; inspect actual result against one backend model; reserve never-used incarnation | Nothing published; wrong descriptor does not authorize a write |
| FENCE | Block new operations at every actual reachable handler/ingress; account for all handler identities and accepted work | Unknown handler/queued request/ingress path keeps deployment fenced; no optimistic timeout |
| DRAIN / STOP | Existing work completes against old unchanged contract; join actual handler/process completion. Record lost responses and reconcile remote outcomes independently before data conversion | Abort, kill, deadline or socket closure alone is not SQL settlement. Unknown work/outcome blocks cutover; no automatic write replay |
| MIGRATE / VERIFY, all old handlers stopped | Stopped owned database recovery; transactional DDL/data/metadata where possible, exact complete data/audit constraints; stage matching native config | SQL rollback restores SQL/catalog together only. Config/files have no inherited SQL atomicity; mismatch stays closed |
| START CLOSED | Start all intended official handlers with exact verified DB/config/metadata/realm; ensure no old route/alias authorizes mutations and no unknown handler remains | Partial/mixed/config mismatch is not published; block data serving |
| PUBLISH / OPEN | Verify all named-operation descriptors and new incarnation routes, grants, ordinary-client controls and source bindings before allowing traffic | Stable metadata may be stale, but stale data URLs only deny/404; never retarget or silently refresh/replay a write |
| RETIRE | Record old incarnation permanently consumed; revoke old path operations before reopening new incarnation | An old cached builder can fail; it cannot be routed to a different row under a new PK |
| RECOVER AFTER CUTOVER | Reconcile latest committed state; build a fresh incarnation, migrate forward to the desired old *model* only if lossless/approved | Never restore an old application backup over newer acknowledged data or resurrect its old routes. If safe inverse conversion is unavailable, remain fenced |

The order RETIRE-before-OPEN is mandatory even though it is listed separately for clarity. Old and new writable copies must **not** be served concurrently: that creates split data, not a coherent migration. No dual-write/replay/silent read refresh is proposed. A stale client has an availability failure until explicitly performing a new operation; success across maintenance is not promised.

No new HTTP gateway/protocol emulator is proposed. Existing operational ingress fencing, stopping official processes and generated native config are prerequisites to prove separately, not a service added by this document. In a deployment where all write paths cannot be fenced, this stock candidate is **not viable**. A bound client can be routed to an old/mixed handler while holding valid metadata; the SDK cannot detect every such violation.

**Important limit:** a same-origin restore with a rolled-back retirement journal can revive old URLs even if the restored schema is internally self-consistent. Physical byte/schema validation alone cannot prove non-reuse. Require independently retained monotonic history or a new origin with appropriate auth re-establishment; do not claim rollback-safe publication until that procedure is tested.

## 4. Compare source-of-truth and transport mechanisms

All viable carriers must consume the **same independently verified release facts** and satisfy the lifecycle above. Changing a carrier cannot fix false source data or TOCTOU.

| Mechanism | Authority and least-privilege feasibility | Lifecycle / viability after BM |
| --- | --- | --- |
| Ordinary native schema alone | Native running facts but loses PK/logical codecs and requires target SCHEMA | **Insufficient** for current Todo: BM01/02/04. Hashing it does not add lost facts |
| Hidden annotation on target schema | Can hold generated descriptor, but native accepts false annotations; CREATE-only lacks SCHEMA; Insert/Update needed | Conditional transport only after verifier + explicit SCHEMA disclosure, otherwise fails CREATE-only requirement. Adds target DDL; not preferred for the initial proof |
| Generated same-DB metadata, narrowly exposed per operation | Actual physical facts + explicit backend semantics validated before insert; separate metadata READ, no target READ/SCHEMA | **Candidate for real proof**, not selected. DDL/catalog can transact; native config/handlers still cannot. BM09's handwritten false row is not this verifier |
| Generated static same-origin descriptor | Same verifier authority; no target permissions needed, but public file may disclose structures to everyone | Conditional if disclosure acceptable. DB/file/config split publication must remain fenced; stale file points only to immutable retired route, never repointed alias. No static service/files installed here |
| Deployment-bundled descriptor | Same verifier; zero discovery fetch, but per-deployment artifact/version and stale bundles | Lifecycle still needs immutable data routes; cannot introduce compulsory app map/import registration or imply generic package support. Not needed for the first proof |
| Enriched official-native metadata **plus atomic expected-contract write** | Backend derives PK/exposure facts, validates declared semantics and checks version in the same operation/transaction | Stronger candidate, **unavailable/unproved** in inspected0359. Metadata enrichment alone still races. Requires upstream work/version qualification, separately authorized—not a fork or patch in this task |

For the atomic candidate, the server would have to reject an expected-contract mismatch **before authorization-dependent mutation and in the same schema/transaction snapshot used by the actual write**, including PK routing, codecs and policy changes. Checking a header before later schema resolution is not enough. No invented header is sent today; unknown headers may be ignored. Even this cannot make rollbacked data loss or stale auth policies safe automatically.

**Conditional research preference:** test generated per-operation metadata with immutable incarnation routing first because it can use existing official native primitives and isolates CREATE-only disclosure. Compare static carrier publication with the exact same verifier/lifecycle controls, not a second handwritten truth. This selects a proposed experiment, not product architecture; real feasibility and maintenance cost remain open. No user choice is requested now.

## 5. Executable offline controls and real proof gate

New controls are scoped to L1-01/03/04/05–13/24/27 research and BC01–BC12 below, not new supported feature rows. They must use real in-memory SQLite facts/transactions plus a clearly labelled deployment state model. They must retain counterexamples when safeguards are removed; no HTTP/auth/native-handler claims from synthetic responses.

| Control | Required observation |
| --- | --- |
| BC01 | Derive different actual PKs from controlled SQLite tables; reject false descriptor even if its digest is recomputed |
| BC02 | Distinguish declared UUID body/path/output/filter and INTEGER-vs-JSON boolean plans; reject unresolved/conflicting declarations, wrong config/columns |
| BC03 | Model CREATE-only metadata access with zero target READ/SCHEMA/DELETE; denied metadata dispatches zero target work; disclosure excludes private fields/SQL/table names |
| BC04 | Demonstrate real wrong-row update using a stale PK after unsafe route rebinding, despite a fresh valid descriptor digest |
| BC05 | Fencing joins an accepted old operation before stop; unknown work/outcome prevents migration/open, not deadline-to-success |
| BC06 | Real SQLite DDL/catalog transaction rollback preserves old state; nontransactional config mismatch stays fenced |
| BC07 | Safe cutover retires old URLs before opening new ones; old cached requests cannot touch new target/control rows |
| BC08 | Refuse in-place contract mutation or route reuse, including retire→restore→same-name ABA; removing non-reuse reproduces unsafe routing |
| BC09 | Require all actual modelled handlers to match candidate binding; mixed/unknown handlers block open; no live enumeration implied |
| BC10 | Post-cutover recovery preserves newly committed data, uses a fresh route and never reinstates a retired URL; unsafe backup restoration must be rejected |
| BC11 | Metadata cache cannot grant mutation permission; owner replacement/metadata denial cannot reuse prior audience disclosure |
| BC12 | Apply the same safe/unsafe lifecycle to catalog and static carriers; carrier swap does not cure a false descriptor or stale-write race |

The model must state its trusted preconditions explicitly: a complete modelled handler set/fence, non-reuse history retained outside restored app data and controlled SQL/config changes. Mutation/negative controls show why those assumptions matter; they do not prove a deployment provides them.

### Executed offline model, not a real lifecycle pass

Run `node --test docs/prototypes/backend-contract-lifecycle.test.mjs`; [model source](../prototypes/backend-contract-lifecycle.mjs), [controls](../prototypes/backend-contract-lifecycle.test.mjs). **BC01–BC12 passed12/12 on each exactNode22.23.2/24.21.0**, with per-test in-memory SQLite close hooks succeeding. Initial BC01 observed a genuine assertion mismatch in the new naive model (`id` versus actual `alternate`); a later BC03 extension initially failed because the model's CREATE operation was absent. Those are new model-construction reds, not SDK/native regressions. An intermediate12PASS predates the CREATE/backup-loss extensions and remains separate.

Scope is deliberately narrower than a real controller: derivation validates only two fixed integer/text SQLite fixture shapes; UUID/boolean directional plans are facts copied from BM observations, not implemented native codecs or a constraint compiler. CREATE-only/owner/cache/handler/fence behavior is explicitly modelled. BC09 checks a supplied h1/h2 inventory, not discovery of every reachable handler. BC10 republishing the same physical model under fresh URLs preserves current rows; bypassing the policy with an actual SQL backup restore demonstrably loses newer values. It does **not** implement a lossless inverse schema migration, persistent publication journal or real recovery. BC12 varies the carrier label through the same model; it does not implement static-file or catalog HTTP/ACL/publication behavior. The direct Map/SQL bypasses are intentional unsafe negative controls, not supported release APIs.

This is a **conditionally coherent, tested model of the proposed lifecycle**, not a tested official TrailBase lifecycle. The real gates below remain failed-to-prove/unexecuted; no carrier-choice request is warranted.

**Before proposing adoption or asking a carrier decision**, a separately coordinated, frozen/reviewed real plan must prove at least:

1. Official0359 exact named-operation metadata API/route naming, visibility/rules/grants, no alternate target READ/DELETE, malformed/absent metadata and zero data-dispatch on refusal. Real mail-confirmed ordinary CREATE-only actors and exact administrative cleanup, no grant widening.
2. Generated verifier against actual native metadata/config: wrong PK, UUID/filter mismatch, INTEGER/JSON boolean declaration mismatch, hidden/generated field, unknown write fields, false self-hashed descriptors all refused before publication; unchanged complete data/audits.
3. Two real official handlers with controlled stale/cached/in-flight clients: exact fencing/stopping/SQL outcomes; config/database mismatch stays unavailable; old API path cannot mutate new schema after cutover. Kill acknowledgment alone supplies no SQL/row receipt.
4. Actual SQL+metadata rollback and separately failed config publish; post-cutover forward recovery preserves latest rows/audits and retired route history. Backup restore cannot resurrect an old URL under the original origin. Mixed/unknown/rolled-back handler negative controls must fail safely.
5. Same agreed Todo source through actual installed package and pinned reference, three browsers, real auth/CRUD/error/refresh/teardown, bounded public subset and no required app mapping; parser/input security and existing AL/cleanup gaps independently addressed. Metadata success alone is not full data/auth parity.

These tests require their own coordinated fixture window and strict guards. **None is scheduled or run here.** No BM permit/controller/claim, old handoff, root lock or historical clearance can be reused. Existing budgets/pins/assertions stay fixed. Setup/fence/config/outcome uncertainty is failure/incomplete, never skipped or promoted to signoff. Preserve the BM08 mutation omission, BM05/07 gaps, genuine47c2PASS/3FAIL and all strict/Storage/Realtime/missing evidence.

## 6. Independent small API correction—proposal only

The parallel read-only assessment recommends **ordinary own-property objects for successfully decoded mapped read rows**, not constructor/auth-default changes or fabricated outer envelope fields. See [the bounded result-data proposal](2026-11-06-result-row-proposal.md).

`mapRow` currently returns null-prototype rows; pinned reference JSON decoding produces ordinary objects. A safe `Object.fromEntries`/own-data-property construction can address that one observable difference for list/single/maybeSingle without metadata architecture. Simple `{}` assignment is unsafe for an own `__proto__` field. Keep mapped validation, codecs, timing, internal mutation dictionaries, auth/defaults, status/error fields and all current data limitations unchanged.

This is **identification and finite test planning, not an SDK edit**. A constructor-default change would also affect hydration/storage/bearer/refresh/URL detection and existing data-only callers; it is not bundled here. No mapping-free CRUD or complete result-envelope parity follows from ordinary row prototypes.
