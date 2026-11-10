# Declarative Todo feasibility: one intended schema, independently verified outputs

## Decision and scope

**Evaluation/proposed bounded proof only; not an adopted architecture, general SQL compiler, migration CLI, runtime metadata implementation or deployment approval.** Mark's suggestion is useful as a design-time source of intended semantics. It does not itself establish the running database's facts, native access rules, metadata discovery or stale-write safety. Existing demo/data/assets/services/root lock and consumed BM/RR authorizations remain untouched. No fixture is allocated by this document.

The immediate recommendation is a narrowly specified Todo experiment, not a general PostgreSQL-to-SQLite product. Preserve the independent RR controller/cleanup work and all historical failures. Do not append this experiment to RR's twenty-case authorization, repin fixtures, change shared auth, introduce a gateway/fork, or make an application supply mappings/registration.

## Evidence versus inference

**Existing upstream capability:** Supabase declarative files express desired PostgreSQL state and can participate in generating PostgreSQL migrations. The current [official guide](https://supabase.com/docs/guides/local-development/declarative-database-schemas) distinguishes current pg-delta and legacy migra workflows, their different ordering/configuration, untracked objects and the need for manual review. Desired-state comparison is not proof of live state. DML/data backfills and Supabase-managed/auth concerns are not solved by a table definition. This evaluation does not assume that commands in the latest guide work in our pinned CLI.

**Existing project runtime evidence:** [BM observations](../evidence/bootstrap-native-reference-comparison.md) establish the PK ambiguity of public native schemas, independent CREATE/READ/SCHEMA permission, canonical UUID body/path versus padded-base64 BLOB filter behavior, numeric native INTEGER boolean output, the alternative JSON-TEXT boolean's coercion differences, and false annotations/catalog rows accepted without validation. BM used explicit mapping/auth. It did not implement generated authoritative metadata or a standard constructor. Historical nine diagnostic passes do not become nine compatible features.

**Existing design/model, not deployment evidence:** the [backend-contract proposal](2026-11-06-backend-contract-proposal.md) separates authority, disclosure and write-time lifecycle. Its SQLite/state-machine controls are not real handler fencing, cache, rollout or recovery proof.

**New design inference below:** one reviewed SQL input could drive a finite lowering plus verifier, without a second handwritten per-app field map. No such lowering/verifier/resolver is implemented by this evaluation. Documentation/source reading is not backend execution.

Private source capture: current upstream guide HTTP200, SHA256 `9ad882cde62b81c51dc83f7c54dc4578bc7845eeda85b855207c74fd97891c23`. Two attempted historical CLI source URLs returned404; retain those failures, not a claim of pinned CLI source verification. No schema/migration command or backend was run for this research.

## 1. The proposed single input and finite lowering

Use one reviewed Supabase SQL file containing a Todo table and explicitly enumerated grants/RLS statements. It declares the real PK, UUID ownership, text/nullability, boolean, a bounded integer, and literal defaults. An illustrative initial table is:

```sql
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  priority integer not null default 0,
  note text
);
```

This excerpt is **not the complete proof input**: exact GRANT/REVOKE, RLS enablement and separate owner-policy USING/WITH CHECK clauses must be present and frozen before any implementation. No permission is inferred from a column called `user_id` or from an omitted policy. Only exact, reviewed owner-equality policy forms are candidates; reject security-definer helpers, arbitrary expressions, role inheritance/custom claims, permissive-policy combinations or dependency graphs outside that grammar.

The generator also has a **fixed, versioned TrailBase lowering/protocol profile**. PostgreSQL SQL alone does not specify native RecordApi aliases, listing limits, API exposure, physical UUID representation or directional HTTP codecs. The profile is explicit deployment tooling, not an app mapping, hidden comment annotation, env hook or an assertion that these native details came from PostgreSQL.

Proposed generated artifacts, all from that input plus the frozen profile:

1. SQLite DDL/migration with actual PK, NOT NULL/FK constraints, domains and defaults.
2. The minimal native RecordApi configuration: named API, authenticated operations and exact ownership rules; no blanket SCHEMA/world access or subscriptions added for convenience.
3. A private verification binding containing source/profile identity and complete expected SQL/config facts.
4. An operation-specific public structural descriptor only if its runtime transport/disclosure is separately approved. No arbitrary SQL, policies, physical private names, secret defaults or auth-store details in that public projection.

Extract facts from parsed declarations, not names, sample values or a prewritten answer. A finite token/AST grammar is sufficient for this experiment; it must consume the entire input, including quoted strings/comments or explicitly reject unsupported lexical forms. Do not split SQL on semicolons or regex-replace PostgreSQL into SQLite. No dependency installation or general parser/compiler commitment is inferred.

Unsupported constructs fail **before native publication or a data mutation**, with an actionable location/reason. Examples: composite/no/ambiguous PK, unsupported schema, arrays/enums/domains, arbitrary CHECK/default/function/trigger, generated columns, extensions, views, unsupported FK behavior or unrecognized grant/policy. A known-supported `auth.users` reference is a specifically verified mapping to the disposable native auth realm, not migration of Supabase auth identities/passwords/sessions.

## 2. Fidelity that must actually be checked

| Fact | Finite proof requirement |
| --- | --- |
| PK | Derive the declared key; independently inspect applied PostgreSQL constraints and native SQLite PRAGMA/index facts. Include a non-`id`/crossed-key negative control. Never let stale `id` guessing update another allowed row. |
| UUID | A PostgreSQL `uuid` accepts more than UUIDv4. `default gen_random_uuid()` does **not** constrain supplied values to v4. Do not silently emit a v4-only CHECK. The inspected official extension has general `is_uuid`; its native metadata/API suitability still needs actual qualification. Otherwise reject this input or require an explicit source restriction—never pretend equivalent. |
| UUID directions | Independently test body, record path, predicate, returned row and create acknowledgement. Existing canonical-body/path evidence does not prove `.eq('id', uuid)`; BLOB predicates previously required padded base64. Malformed/non-v4 UUID controls must expose unsupported domains rather than narrow them silently. |
| Boolean | Prefer the already characterized INTEGER0/1 representation for the first candidate, with an explicit logical-boolean codec in generated facts. Derive false→0 and true→1; never treat false as omission. Native JSON-TEXT is a different, separately qualified lowering, not a codec toggle. |
| Integer/text/null | PostgreSQL integer is32-bit; SQLite INTEGER is not automatically equivalent. Emit/verify bounds. Preserve omitted versus explicit NULL, NOT NULL, empty text and Unicode; do not claim collation/sort equivalence from both columns being TEXT. |
| Defaults | Omit fields in actual INSERTs and inspect exact persisted values plus client results. Constant false/0/NULL and generated UUID semantics are distinct. Do not fabricate defaults in the SDK to conceal a backend difference. Timestamp/timezone/clock-dependent defaults are out of the first slice. |
| Permission | Verify grants and RLS/RecordApi rules independently. Cover owner A, populated foreign B, anonymous, spoofed ownership and owner-changing updates. USING and WITH CHECK are not interchangeable. Metadata access never grants target data access. |
| Mutation/result | Require exact selected target and complete control/audit postconditions, plus actual SDK data/error/envelope/status behavior. Native403 versus reference zero-row success is a measured mismatch, not a permission-equivalence pass or permission to normalize403. |

Boolean numeric/string coercion, UUID formatting, unique/null behavior and arbitrary query semantics cannot be assumed equivalent. Test them as diagnostic boundaries; if they differ, retain the gap or reject that source/operation. Limited supported coverage must not relabel a known mismatch inside the claimed subset as compatible.

## 3. Applied verification, not self-certification

Validate after applying the generated artifacts to owned disposable backends, before advertising them:

- PostgreSQL: actual PK/column types/nullability/defaults/FKs/checks, table/column grants, RLS enabled/forced state, all applicable policy clauses/roles and exposed-schema configuration.
- Native: actual PK/type/nullability/default/constraint/FK/index/trigger facts, effective loaded RecordApi configuration, exact public/writable columns, UUID/boolean JSON interpretation and protocol profile. A config file on disk alone does not establish what every running handler loaded.
- Compare both to the parsed declaration and independently specified profile. Test omission/default and invalid-value behavior on real engines rather than only matching DDL text.
- Tamper with the actual PK, default, boolean storage, hidden field or access rule while leaving generated metadata unchanged; refuse publication. Also tamper with a descriptor and recompute its hash; the independent verifier must still reject it.

A digest binds bytes; it does not prove those bytes are true. An administrator who can bypass schema/config release rules remains trusted, not magically detected by client metadata. Verification must not leak privileged inspection access to an ordinary browser.

## 4. Runtime loading and untouched application calls

The **same application function** should use only standard calls: `createClient(url, key)`, ordinary password login, `.from('todos').insert(...)`, `.select(...)`, `.eq('id', uuid)`, boolean filtering, ordering/range, `.single()`/`.maybeSingle()`, and explicitly PK-filtered update/delete. Endpoints, genuine per-backend user IDs and generated fixture inputs differ naturally; code and assertions do not branch on backend or discard mismatching result fields.

Compare every backend result against its exact expected owner/row and compare the complete observable contract. Do not JSON-roundtrip away prototypes/descriptors, omit error/status fields or use blanket normalization to manufacture equality. Authentication setup uses genuine signup/mail/confirmation/login; no JWT fabrication, identity transplant or admin preconfirmation.

**Present blocker:** the current candidate still needs explicit TrailBase mappings/auth options. Therefore the standard two-argument constructor is an expected current red, not a successful outcome of SQL generation. The SDK has no adopted transparent metadata loader. Generated TypeScript types also disappear at runtime and cannot supply it.

A genuinely mapping-free positive proof would need a separately informed choice of internal runtime loading/provisioning: e.g. a narrowly disclosed generated same-origin native metadata API, or another approved mechanism. It must be ordinary-user, bounded, non-executable, owner/operation scoped and fail closed. No app wrapper, extra constructor map, registration import, global/env side channel or admin discovery can count as untouched application code.

Test a CREATE-only variant of the bounded declaration separately, without widening the main target grants: its ordinary INSERT must not acquire target READ/SCHEMA/DELETE. If metadata requires additional structural disclosure, state and approve that cost. A mechanism-control run using the existing mapped adapter may diagnose SQL/codecs but **cannot pass the untouched-bootstrap criterion**. No carrier is selected here.

## 5. Drift, schema changes and stale clients

Design-time schema files improve intent/review; they do not fence runtime writes. A fresh descriptor fetch, signature/hash/ETag, TTL or checking immediately before dispatch leaves a lookup→write race. Official0359 has no established atomic expected-contract write precondition; do not invent a header or claim native enforcement.

For a future stock-server proof, reuse the *proposed invariant*, not the consumed BM controller: each published native data route has a never-reused interpretation. Fence all handlers/ingress, join accepted client/handler work, independently settle SQL, stop old handlers, migrate/verify SQL and config, start closed, permanently retire old routes, then open a fresh incarnation. The normal logical `.from('todos')` can stay unchanged only if an internal resolver maps it; stale builders may fail but must not silently retry/replay against a new contract.

Test at least PK change, added/removed field, changed boolean/default, and tightened permission. Unsupported or lossy changes stay rejected/fenced; table rebuilds, backfills, auth data migration and inverse migrations are not automatically provided. A rolled-back application backup must not resurrect a retired route/history (ABA). Mixed handlers and unknown accepted outcomes block publication. Previously disclosed metadata cannot be made secret by cache invalidation.

Offline models can expose wrong-row/race/rollback counterexamples now. A live lifecycle claim needs two real handlers and actual delayed/stale requests in its own separately reviewed finite plan. A single fresh happy-path fixture cannot prove a multi-handler release protocol.

## 6. Proposed bounded test gates—not executed

| ID | Required observation |
| --- | --- |
| DT01 | Parse allowed Todo SQL; derive PK/types/defaults/grants/policies; deterministic artifacts, all input consumed. |
| DT02 | Property/adversarial parser and metadata tests: unsupported/ambiguous syntax, identifiers, duplicate fields, size limits and malicious descriptors reject without native publication/data dispatch. |
| DT03 | Real PostgreSQL and official native application; independently compare actual schema/effective config to intended facts, including tampered self-hashed descriptors. |
| DT04 | Genuine ordinary users/mail/login; same standard constructor/call source. Record current constructor red rather than injecting mappings to obtain a pass. |
| DT05 | Canonical UUID insert/path/filter/output/ack; non-v4/malformed controls; exact included/excluded row IDs and no guessed filter codec. |
| DT06 | Omitted/false/true/default/null/update→filter booleans; numeric/string boundary diagnostics; exact scalar types and complete stored values. |
| DT07 | Owner/foreign/anonymous/spoof/owner-transfer permissions, complete forbidden-write/table/audit invariants and unmodified grants. |
| DT08 | Explicit CREATE-only input variant: no target read/schema/delete dependency, approved minimal metadata disclosure only; privileged cleanup separate. |
| DT09 | Same Todo pagination/mutations/cardinality calls; ordinary own-data-property rows, exact envelopes/errors/statuses, single intended request/no hidden read-back/replay. Known incompatibilities remain reds. |
| DT10 | Applied PK/type/default/config/rule drift rejects publication or keeps serving fenced; rejected changes preserve data/control/audit state. |
| DT11 | Stale builder/changed PK/cache/owner/permission and retirement/rollback controls; distinguish model from real two-handler proof. |
| DT12 | Durable pre-signup/row/session intents, original Fetch/body/decoder/cancel joins, independent SQL settlement, exact rows/accounts/sessions cleanup and separate resource/archive/original-preservation audit. Unknown means retained/unconfirmed, not RELEASE. |

Before implementation, bind exact grammar/SQL/profile/calls/counts and layer criteria. Unit/type/property and negative controls precede emitter/resolver code. Real DB/config, pinned installed candidate/reference, Chromium/Firefox/WebKit (one worker,retries0), security/fault and package layers are required for their respective claims; mark missing layers unexecuted, not N/A for convenience. Use both exact Node pins and the existing pinned official0359/nativeJS/Supabase distribution. Do not broaden supported feature rows or lower coverage/budgets.

A future isolated run needs fresh Storage/Realtime coordination, a distinct once-only claim, exact-source independent dispatch review, unchanged competition/capacity/ownership/original-preservation guards, generated owned fixtures only and a separate independent auditor. Do not borrow RR's fixture/window or re-execute a consumed writer. Any uncertain handler/lock/type/ownership/source/SQL outcome stops and preserves evidence. No live deployment/network/security/credential/fork/outreach change or original-demo navigation/restart/cleanup.

## What a result could legitimately establish

A successful finite derivation/application comparison could establish that **this declared Todo subset** generates truthful verified schema/config facts and that tested codecs/permissions/calls behave as observed on the exact pins. A constructor/resolver red can coexist with a successful backend-generation sub-proof, but blocks the untouched-app result.

It would not establish arbitrary PostgreSQL conversion, all RLS equivalence, general data/auth migration, universal input/error parity, production drift detection, atomic native fencing, rollback safety, mapping-free bootstrap without a loader, release/maintainer signoff or architecture adoption. The informed decision remains whether the proven subset and its explicit provisioning/disclosure/lifecycle costs are acceptable—not merely where to store a descriptor.
