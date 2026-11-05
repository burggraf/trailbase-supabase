# Independent result-data correction: ordinary decoded row objects

## Proposed finite change, not implementation

Candidate under **L1-04**, with L1-03/05/12/13/24/26 regressions: successful mapped read rows should be ordinary current-realm objects whose mapped columns are own enumerable/writable/configurable data properties. This fixes one observable result-data difference without metadata architecture, constructor/default changes or any claim of mapping-free CRUD/full-envelope parity.

At reviewed base3852be8, `src/index.ts:117–130` creates rows with `Object.create(null)`; `:235–246` returns those rows through list/single/maybeSingle. Installed `@supabase/postgrest-js@2.117.2/src/PostgrestBuilder.ts:389–404` uses ordinary JSON decoding and retains the decoded row for cardinality handling. Equal serialized values can still differ under strict structural equality, prototype inspection and ordinary inherited methods.

`tests/package/sdk-data-consumer.mjs:31` currently JSON-round-trips the result before comparison, removing exactly this distinction. Existing value-oriented client/cardinality assertions do not establish prototype parity. Do not change their expected scalar values or normalize away the new regression.

The parallel assessment was read-only, with an in-memory transformed-source/synthetic-transport control on available **Node24.22.1**, not either pinned verification runtime. It observed3mode mismatches with zero escaped global requests. Its first import-relocation driver failed before query entry; those authoring outputs remain separate. Neither those observations nor the parent’s later bounded offline reproduction are native/backend/browser/package qualification or a permanent Vitest regression.

Parent reproduction now uses the **actual freshly built unchanged `dist/index.js`** and installed reference, not transformed source: on each exactNode22.23.2/24.21.0, list/single/maybeSingle all returned no error and equal serialized data, while candidate rows had null prototype, reference rows had `Object.prototype`, and direct strict data equality differed. Each client made3injected transport calls; escaped global Fetch calls0. Builds and392/392root units passed each pin. These are **observed before-change mismatches**, intentionally still present; no runtime correction has been made. Source/build/report hashes are in the [proposal evidence](../evidence/backend-contract-proposal.json).

## Implementation boundary if later authorized

Only the **public output object construction inside `mapRow()`** needs to change. Use safe own-property construction, e.g. `Object.fromEntries` over validated decoded pairs. Do not merely change the initial object to `{}` while retaining `output[column]=value`: a legitimate own `__proto__` field would invoke inherited setter behavior instead of preserving an own data property.

Keep unchanged:

- Complete native-row required/unmapped-field validation and all scalar/null codecs. A bad later row cannot expose a partial successful list.
- Synchronous constructor/builder validation versus asynchronous operational error envelopes.
- Explicit mapping requirement and auth opt-in/default behavior; unchanged native/error/cardinality/range semantics.
- Internal null-prototype mutation dictionaries, UUID filter encoding, write guards and no read-after-write/replay.
- `src/auth.ts`, `src/common.ts`, dependency/fixture/pin/schema/bootstrap/source-of-truth choices.

No new overload/export or public type is necessary. Ordinary fields can shadow `constructor`, `toString`, `hasOwnProperty`, etc., just as JSON can. Use `Object.hasOwn()` in checks; do not promise inherited methods are callable when a row shadows them.

## Test-first acceptance contract

**Observed mismatch is not an implemented correction.** Before a runtime edit, add permanent failing-before-change tests:

1. Successful list, single and one-row maybeSingle: `Object.getPrototypeOf(row)===Object.prototype`, direct strict data equality with ordinary decoded expected rows and exact own property descriptors. Zero-row maybeSingle stays null.
2. Strengthen packed-consumer direct assertions rather than JSON-normalize; exercise all three modes through actual shipped code.
3. Adversarial own `__proto__`, `constructor`, `toString`, `hasOwnProperty` fields retain exact scalar values/descriptors and ordinary prototype; inherited setters never run.
4. Missing/unmapped columns, invalid codecs, inherited/accessor/symbol/non-enumerable/class/array rows and a valid row followed by an invalid row remain sanitized errors/null data, no partial result. Test at the proper boundary: JSON wire decoding cannot itself carry accessors/prototypes.
5. Lazy/no-early-dispatch, fresh repeated awaits, independent result mutation, bounds/cardinality/views/permission-checked zero limit and unchanged backend403/transport/range errors. No invented status/count/SQL/PostgREST fields.
6. Compile existing Row/Insert/Update, Views, cardinality/nullability and unsupported-argument negatives against source and shipped declarations; preserve narrow auth/private-operation exclusions.

Connected callers to inspect: `examples/todos/app.js::loadTaskPage`, `tests/phase-a/sdk-data.test.ts`, both package consumers, `tests/sdk-browser/data.spec.ts`, shared browser flows and `tests/types/sdk-{data,query,auth}.ts`.

Required verification after an authorized implementation: both exact Nodes22.23.2/24.21.0 `check`, `build:sdk`, `test:unit`, `test:sdk:unit`, `test:sdk:coverage` (unchanged95/90 global/per-module), `test:sdk:package`; fresh owned real data/DB/constraints/reference/installed Node on both pins, packed Chromium/Firefox/WebKit and applicable auth/security/fault/refresh/strict research/expiry/upgrade/legacy/example/cleanup scopes. Browser prototype assertions must run **inside the browser realm before page-result serialization**, which otherwise destroys the distinction. Real fixtures require separate coordination. Full release/maintainer gates stay incomplete; historical passes do not certify a source change.

## Why not bundle standard constructor/auth defaults

Current `ClientOptions.trailbase` is required in supplied options, even though the factory’s `options?` means a two-argument call compiles and then fails at runtime. Omitted auth is disabled in `src/auth.ts:69–91`; record paths bypass auth readiness in that mode. Enabling defaults would change existing data-only callers’ hydration/storage failures, bearer selection and refresh behavior. Installed reference also defaults URL-session detection on, whereas this SDK only permits it explicitly false. The typed `db:{}` default mismatch is another independently bounded issue, not part of this correction.

An auth-only standard constructor with data calls explicitly unsupported could be a later proposal, but must specify those default/type/side-effect contracts first. Ordinary row output avoids those consequential choices while addressing a real corresponding-reference observation.

**No SDK implementation occurred in this proposal task.** Required mapping/auth opt-in, incomplete outer envelopes/cardinality errors, signup fields/coercions, native no-op/error differences, BM08 missing/foreign mutation omission and all metadata/lifecycle questions remain open. Read the [backend proposal](2026-11-06-backend-contract-proposal.md) separately; neither track adopts the other.
