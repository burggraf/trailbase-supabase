# What the completed BM01–BM09 window actually established

## Bottom line

**The native data mechanisms can support the tested Todo workload through the existing mapped adapter. They do not yet support standard Supabase-style bootstrap or establish exact observable API parity.** Nine passing diagnostic cases mean the expected observations, including incompatibilities, were observed—not nine compatible features.

The strongest reductions are real: official TrailBase accepts canonical UUID mutation bodies/record-ID paths, and a native JSON-typed TEXT boolean returns actual JavaScript booleans. The remaining problems are also real: public schemas lose primary-key identity, schema permission is independent of CREATE/READ, UUID BLOB predicates use a different encoding, raw output and result/error envelopes differ, and a metadata annotation/catalog can lie without native rejection.

**Recommendation:** keep the current implementation classified as development-only; do not adopt a metadata carrier or announce drop-in support. Separate client-only API/default/envelope corrections from the unresolved authoritative data contract. This evidence does not justify asking Mark to pick “annotation versus catalog” yet: neither tested mechanism meets the full authority/permission/lifecycle requirement. A later data-design proposal must show where PK/output/filter/write-column facts come from, how CREATE-only clients obtain them without added target READ, and what prevents stale facts routing a write to the wrong row. No such proposal is implemented or adopted here.

## Evidence identity and scope

The [machine-readable extraction](bootstrap-native-reference-observations.json) binds each case to its exact private result and observation-stream lengths/SHA256s, plus the executed test, mutation oracle, transport, SDK, app, fixture config/migrations and dependency metadata. It publishes only allowlisted structural observations, statuses, counts, types, fixed synthetic control values and hashes—not generated identities, credentials, row contents, URLs or raw errors/logs.

| Binding | Executed identity |
| --- | --- |
| Root base | `dcafdcf62f55ae8dc4175bb61c5b39bd33b74914` |
| Root runtime source | `e50637bd4aa604b6e5850047c7043eba901985b336a88ea7afa4e483e97bf749` |
| Auth | `04699c578cb3b208331e006e7a018b3378aae4ebf18bdc1a09031f76f1ef837d` |
| Accepted 462-file freeze | `f9b224f138a307171c122011f9522055f20a327eed25fc2ae6643071c0e08f31` |
| Archive manifest, 1,324 files | `223efc5b6f6a1e4f23bf20c80a18491424965f497bbec720ba224ea7762d58a3` |
| Executed private test | `d3ebd220f11415111ae67bf2ef01105c371918f086cc50f79ac8ba04296a6141` |
| Runtime | Node22.23.2; official TrailBase0.35.9/a106ce6338f9831140c92ac16e051901ed92d576; nativeJS0.14.3; SupabaseJS2.117.2/local CLI2.119.0 |

Exactly one new default-profile fixture ran nine serial cases once, retries0: **9 entered/9 diagnostic PASS/0 FAIL/0 unexecuted**. Genuine signup, delivered confirmation and password login were used. The candidate used repository source and **explicit mapping/auth options**; the reference used its installed official SDK. Generated fixture overlays are separately bound; the root source hash does not describe the entire overlaid checkout.

The completed window is **RELEASED**. Accepted client work settled; separate exact-owned CREATE-only administration on each backend proved1row→0 and one new DELETE audit, without adding ordinary READ/DELETE grants. Harness cleanup and independent resource/original-demo audit passed; owned live TCP0, archived source rehashed before exact owned-parent removal. TIME-WAIT absence is not claimed. This extraction rehashed all1,324 archive files and re-evaluated four BM07 plus one BM08 immediate full mutation/audit checks from the captured snapshots. It made **no live/network/resource/guard queries**, did not reuse claims and did not rerun a backend case.

The original [plan](../plans/2026-11-05-native-metadata-proof.md), [feasibility audit](../plans/2026-11-05-bootstrap-feasibility.md) and [repair/execution record](standard-bootstrap-feasibility.json) remain separate. This comparison narrows conclusions to executed assertions, not every prospective sentence in those plans.

## Case-by-case observations

### BM01 — full public schema does not identify the primary key

- Two generated tables exposed integer `id`/`alternate`, string `user_id`/`title`. Their **entire actual Insert, Select and Update schemas matched after replacing only the API title**. No other keyword was discarded. Insert required user/ title, Select required all four fields, Update required none; these differences between modes did not distinguish the tables.
- Read-only physical introspection established PK=`id` in one table, PK=`alternate` in the other.
- Both contained controlled rows `(id=1, alternate=2)` and `(id=2, alternate=1)`. Native record-path update of key1 changed exposed `id=1` in the first, **exposed `id=2` in the second**, preserving the other row.

**Implication:** assuming the conventional name `id` can silently change a different authorized row. Required/default flags and a hash of the public schema cannot supply missing PK identity. This is a controlled counterexample, not proof that every native schema is identical or that a production PK migration was exercised.

### BM02 — least privilege is not schema discoverability

Each cell below is **schema GET / data-list GET / create POST** status. A's POST used A ownership; B's deliberately attempted A ownership. The six aliases and three actors produced18 cells/54 requests. Reads/schema lookups and forbidden creates were checked for unchanged complete rows/audits; permitted creates had one row and one INSERT audit added.

| Native API permission profile | Anonymous | A | Foreign B |
| --- | --- | --- | --- |
| Full owner API | 403 / 403 / 403 | 200 / 200 / 200 | 200 / 200 / 403 |
| Authenticated SCHEMA only | 403 / 403 / 403 | 200 / 403 / 403 | 200 / 403 / 403 |
| READ only | 403 / 403 / 403 | 403 / 200 / 403 | 403 / 200 / 403 |
| CREATE only, separate physical table | 403 / 403 / 403 | 403 / 403 / 200 | 403 / 403 / 403 |
| SCHEMA ACL with false schema rule | 403 / 403 / 403 | 403 / 403 / 403 | 403 / 403 / 403 |
| World SCHEMA only | 200 / 403 / 403 | 200 / 403 / 403 | 200 / 403 / 403 |

B's permitted list reads were exactly empty, not access errors. Sequential A list counts differed with prior allowed inserts; counts are not a permission guarantee.

Reference INSERT-only ordinary `.insert()` returned201/null data/no error without SELECT permission. SELECT returned403/`42501`; B's ownership spoof returned403/`42501` with complete state unchanged. DELETE privilege remained false; the independent administrative receipts separately confirmed SELECT/DELETE grants false and exact cleanup. No alternate ordinary cleanup route was provided.

**Implication:** forcing metadata discovery through target SCHEMA or target READ would reject an otherwise legitimate CREATE-only flow. Publishing world schema, granting SCHEMA or adding a catalog is an explicit disclosure/permission/provisioning choice, not invisible parity. SCHEMA ACL alone also does not bypass a false schema rule.

### BM03 — UUID bodies/paths and INTEGER boolean output are different questions

- Native create accepted canonical UUID strings for PK/owner and JSON `true` for INTEGER `completed`. Record-ID canonical UUID GET/PATCH/DELETE returned200.
- Returned IDs were native base64url strings; physical PK was16bytes. Native read returned `completed:1`; SQLite reported INTEGER. Native PATCH accepted JSON false.
- The corresponding reference canonical UUID update/read/delete succeeded; its read returned JavaScript `false`.

**Implication:** native server knowledge can remove redundant UUID/body boolean encoding, but not output conversion or UUID filter encoding. This case did not immediately read back the native false update before deletion; do not infer an extra standalone post-update observation from the200 status. BM07 separately verifies mapped UPDATE effects in full.

### BM04 — canonical UUID read predicates fail to match

For the same generated row, native `.list()` with canonical UUID predicate returned **0** rows; padded-base64 native predicate returned the exact **1** row; reference `.eq('id', canonicalUUID)` returned the exact **1** row.

**Implication:** accepting UUIDs in bodies/record paths is not canonical UUID filter support. The pinned parser contrast explains the observation, but this is a real installed-client/backend result, not merely the earlier source-derived model. A generic `.eq()` implementation cannot guess BLOB semantics from a string's appearance.

### BM05 — native JSON-TEXT boolean is promising, not a free substitution

- Provisioned `completed TEXT NOT NULL DEFAULT 'false'` with supported `jsonschema_matches` boolean declaration, plus a column index. The default is JSON text **`'false'`**, not SQL boolean `false`.
- Omitted default and explicit false/true yielded two false rows and one true row. Native and reference boolean equality predicates returned exactly those included/excluded IDs. Native JSON output values were actual booleans; SQLite stored strings `false`/`true`.
- Native numeric1 insert failed400 with complete native rows/audits unchanged. **Reference accepted numeric1 with201/null data/no error.** Thus even this representation does not establish input-coercion parity. Its exact inserted value was not immediately asserted as a dedicated control.
- Malformed string input failed native400 and reference400/`22P02`. Native JSON string `"true"` was accepted and read as boolean true; blanket “all strings are invalid” would be wrong. An update of the default row to true was read back as true.
- Owned SQLite `EXPLAIN QUERY PLAN SELECT ... WHERE completed='true'` reported `SEARCH todos_json USING INDEX todos_json_completed (completed=?)`. This proves index use for that explicit SQL query only—not the native HTTP query plan, performance or arbitrary JSON expressions.

**Implication:** an existing official mechanism can reduce output codec needs, at the price of different storage/DDL/defaults/index design and migration work. The current SDK's INTEGER boolean codec was **not** qualified for this JSON-TEXT table; BM05 used the native client, not an adopted mapping-free SDK. Predicates were tested before the update, not rerun afterward. DELETE occurred in later cleanup, not a dedicated BM05 delete/predicate matrix. UUID output and PK authority remain unresolved.

### BM06 — an annotation carrier transports assertions, including false ones

Insert and Update schemas preserved hidden `_compat` JSON `$defs` containing `x-record-profile`; Select schema properties and definitions hid the carrier, and normal data output hid it. The good marker named actual PK=`id`. An intentionally false marker named `not_a_key` while independent PRAGMA still reported `id`; native exposed the false annotation without certifying it. It was never used to route a write.

**Implication:** this avoids a new endpoint, not the need for an authoritative generator/check, extra DDL, SCHEMA permission and lifecycle controls. Select-only schema lookup cannot retrieve this carrier. Native JSON-schema validation of a column's value does not validate custom metadata against the table's physical PK.

### BM07 — actual Todo helper succeeds only with legacy bootstrap

The unchanged `loadTaskPage` helper ran against current mapped source SDK and installed official reference. Each backend used three generated UUID rows, a timestamp tie, pageSize1 and an explicit id tie-breaker:

- Three pages returned one exact row each, `hasMore=[true,true,false]`.
- Active/completed filters returned the exact2/1 IDs, with correct page boundaries.
- A separate omitted-default control read `completed:false`, `priority:0`, `note:null`, then was deleted before pagination.
- UPDATE changed the intended target's completion; DELETE removed that exact target. Immediate complete target/control/table snapshots and exactly one new matching audit row per mutation were asserted, with all prior audit rows preserved. The same assertions were re-evaluated from the archive during this extraction. The other workload rows were unchanged.

**Implication:** the real data workload and helper are useful existing adapter evidence, not a toy substitute, but **mapping/auth were still supplied by the test harness**. No standard constructor, mounted UI, browser, installed candidate package, metadata resolver or JSON-TEXT adapter codec was tested. B was authenticated for other controls, but BM07 had no populated opposite-owner Todo row; its preserved controls are the other A workload rows, not an invented foreign-row mutation proof. Exact HTTP request-count/replay parity was not separately asserted by this case.

### BM08 — observable results and known/unknown PATCH effects still differ

- Current mapped candidate returns own fields `data,error`. The installed reference returns `success,error,data,count,status,statusText` in these captured results.
- Zero and multiple-row `.single()` calls errored on both clients. Candidate: null data and `CardinalityError` with `name,message`; reference:406 and `PGRST116` error fields `code,details,hint,message`. One-row results succeeded, reference200. Shared rejection categories are not identical error/envelope behavior. `.maybeSingle()` and full status/default/throw timing were not exercised here.
- Native PATCH containing a real title change plus unknown field returned200, **applied only the intended title change**, and added exactly one UPDATE audit; full other rows/tables/history were unchanged. Reference returned400/`PGRST204` and complete state was unchanged. This is a real partial-application difference, not just a response-code mismatch.
- Native direct foreign/missing record GET returned403; reference filtered foreign list returned200/empty/no error. These are different endpoint shapes, not a like-for-like mutation comparison.
- Actual standard two-argument candidate construction still threw before data operations.

**Important plan-versus-execution gap:** the plan discussed missing/foreign mutation403 versus reference zero-row writes. **BM08 did not execute missing/foreign UPDATE/DELETE controls.** Older source-bound research covers related behavior separately; it cannot be promoted into this window. Preserve all9 whole-case diagnostic passes while recording this missing sub-proof explicitly. Do not map every403 to success or fabricate reference SQL/status fields.

### BM09 — a catalog can expose physical facts without target READ, but can drift

A separate ordinary read-only native API returned two catalog descriptors while target CREATE-only schema/data GETs both returned403. One generated descriptor matched actual PK=`id` and physical BLOB/INTEGER/TEXT facts; it explicitly left logical codecs `UNRESOLVED`. A second inert descriptor asserted `not_a_key` and was also readable. Neither directed writes.

**Implication:** an independently granted catalog solves a narrow access route, not authority enforcement, logical intent, atomic lookup/write binding or rollback safety. It adds a table, API, generation step and metadata READ permission; target data remains protected. Native serving of a catalog row does not prove that the row matches the actual table. No migration, stale cache, mixed handler or rollback schedule ran in BM09.

## Mechanism tradeoffs after measurement

| Mechanism | What the evidence supports | What still blocks standard Todo acceptance |
| --- | --- | --- |
| Native body/path scalar handling | Canonical UUID bodies/path; JSON boolean into INTEGER accepted | Base64 UUID/number boolean output; distinct BLOB filter path; PK field authority |
| Ordinary per-API schema | Real mode-specific types/required fields; permission enforcement | Three whole schemas can hide different PKs; CREATE/READ do not imply SCHEMA; write allowlist must not expose hidden fields |
| JSON-typed boolean representation | Actual boolean output, tested defaults/equality/update, explicit SQL index use | Different schema/storage; coercion difference; migration and current SDK codec unqualified; UUID/PK problems remain |
| Hidden schema annotation | Uses existing route; hidden from Select/data | Can lie; requires Insert/Update lookup and SCHEMA; authoritative generation/validation and drift protection absent |
| Generated same-DB catalog | Physical facts separately readable without target READ/SCHEMA | Extra API/grant; unresolved logical semantics; inconsistent row accepted; separate lookup/write race remains |
| Static artifact / bundled descriptor | Prior source/SQLite-model analysis only | **Not executed by BM**; publication/cache/DB/config/rollback binding unproved; app-supplied registration remains forbidden |
| Enriched official schema contract | Conceptually places physical facts at their source | Not present in inspected official0359 response; no upstream change, fork, outreach or deployment authorized here |

A fresh lookup, schema hash, signature or ETag can detect some stale inputs; **none by itself atomically binds a later native record-path write to the PK/schema observed earlier**. The actual PK counterexample makes that a correctness concern, not just cache performance. The earlier in-memory SQLite rollback/race models remain separate from real migration/rollout proof.

## Practical next step and decision boundary

1. **Retain this evidence checkpoint; do not rerun BM or reuse the completed permit.** No architecture was selected. Leave the original demo, public SDK surface and runtime behavior unchanged.
2. A separately scoped client-side evaluation can address standard constructor/auth defaults, declarations and honest result/cardinality shape. It must preserve native authorization/errors and prove observable behavior, not merely make construction return an object. Do not invent missing signup/user/error/status facts. This work is not implemented or automatically authorized by this report.
3. Before generic mapping-free **data** implementation, require one concrete backend-contract proposal that covers verified PK identity, declared UUID/output/filter semantics and allowed writes, including CREATE-only access, hidden fields, absence/denial, owner changes and stale/mixed/rollback handlers. Prefer facts generated/validated from actual native schema over handwritten annotations; the measured catalog is a useful research candidate, **not a selected solution**. Expose any immutable-schema/versioned-API deployment restriction plainly; do not quietly rely on it.
4. The genuinely necessary maintainer decision comes **when that proposal can state the exact backend provisioning/disclosure and deployment invariant it needs**: whether that cost is acceptable for the selected subset, or whether implementation must wait for a stronger official-native contract. No compulsory app map/wrapper/registration/global/env fallback is an option under the clarified goal. Current evidence cannot certify either route, and no new choice is requested merely to continue analysis.

The missing/foreign mutation semantics and auth signup/default/user/session behavior remain independent barriers to exact claimed-feature parity. Neither changing the constructor nor selecting a metadata transport fixes them. Honest deferral of unrelated methods/products remains acceptable; documentation does not turn a mismatch in an advertised method into compatibility.

## What this checkpoint does not establish

No new runtime/API/schema/dependency/pin/deployment change; no architecture adoption, public publication, push or CI. This is an offline evidence extraction. The prior bounded source checks and actual once-only backend results retain their own source bindings; new documentation checks do not recertify runtime/package/browser behavior.

Untested here: generic resolver/metadata input security, actual migration/data conversion, cache invalidation/role change, schema/config publication, atomic expected-schema writes, mixed replicas/rollback, full coercion/null/default/order/error matrix, `.maybeSingle()`, exact request parity, mounted or installed mapping-free Todo, current package/browser/security/fault/TLS/platform/mobile/accessibility/release qualification. No layer is waived and no feature/gate/maintainer signoff is added.

Rejected419/444-file candidates and all observed red/green/controller/authoring/missing-evidence history are retained. Genuine47c **2PASS/3FAIL** remains unresolved; no cleanup-cause attribution or AL fix follows. Historical signup/strict research, Storage/Realtime failures and missing artifacts remain separate and unpassed. Resource RELEASE and9 diagnostic passes do not erase them.
