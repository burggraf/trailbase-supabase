# Project plan

## Purpose and scope

Build a small TypeScript compatibility client so starter applications can use familiar Supabase calls against TrailBase and later migrate to Supabase with limited application changes.

This plan follows the [source discussion](https://chatgpt.com/share/6ac02347-6a48-83e8-b8b8-8ef8986f9a0f). The discussion is exploratory: its proposed API mappings and effort estimates are hypotheses, not verified contracts. Confirm actual behavior against pinned TrailBase and Supabase SDK versions before implementation.

**Only the minimal Level 1 prototype is in initial scope.** Levels 2 and 3 are documented eventual goals, not work to start now. Do not fork TrailBase, emulate Supabase wire protocols, or build a migration CLI for the first release.

## Current development and restart point

**Phase A is in progress; the compatibility SDK is not implemented.** See [docs/PROGRESS.md](docs/PROGRESS.md) and run `npm run progress` before resuming. [docs/progress.json](docs/progress.json) is the authoritative status/evidence/signoff ledger; update it after every work session. The next boundary is finishing Phase A characterization and maintainer decisions, not expanding the SDK or starting Levels 2/3.

A private MIT-licensed npm harness now provisions disposable real backends/mail, runs upstream/database/browser infrastructure probes, and validates progress/evidence. Required full SDK gates remain explicitly incomplete until implemented. Local green probes do not mean Phase A or an SDK feature is signed off.

## Detailed implementation and mandatory verification

- [Level 1 implementation plan](docs/LEVEL1_PLAN.md): researched contract, architecture, ordered work packages, and completion gates.
- [Project-wide test plan](docs/TEST_PLAN.md): 27 feature signoff rows, unit/type/database/integration/shared-contract/browser E2E/security/fault/package tests, CI requirements, and evidence rules.
- [Upstream research](docs/RESEARCH.md): official sources, pinned reference versions, substantive API differences, and seven open contract/characterization decisions.

A full test plan is required throughout this project, not a final release task. Every behavior change includes tests at all applicable layers and explicit signoff criteria. Mocks alone cannot establish compatibility. All SDK features remain planned and unverified; documentation/source research is not runtime proof.

## Level 1 — Supabase-shaped TrailBase SDK

```text
Application
    ↓
Supabase-shaped TypeScript SDK
    ↓
Native TrailBase APIs
```

### Initial compatibility contract

Use the prototype described in the discussion as the release boundary: `createClient`, table queries and CRUD, basic filters, password auth, and basic realtime. Supporting helpers below make those flows usable; they are not a commitment to the full Supabase client API.

| Area | Minimum target | Boundary |
| --- | --- | --- |
| Client | `createClient(url, key?, options?)` with a documented configuration subset | Supabase-shaped call signature; TrailBase authentication remains native. Do not invent a TrailBase API-key security model. |
| Results | Awaitable queries returning `{ data, error }`; auth results with the supported Supabase-shaped user/session fields | Preserve useful errors and explicitly document fields that cannot be mapped. |
| Reads | `.from(name).select('*')` | `name` identifies an exposed TrailBase record API; arbitrary tables are not automatically exposed. |
| Writes | `.insert(record)`, `.update(values).eq(primaryKey, value)`, `.delete().eq(primaryKey, value)` | Single-record writes first. No bulk writes, filtered multi-row writes, transactions, or implicit write-returning support. |
| Filters | `.eq()`, `.neq()`, `.gt()`, `.gte()`, `.lt()`, `.lte()` combined with AND | Verify value encoding and supported types. No raw PostgREST filter language or `.or()`. |
| Ordering/pagination | `.order()`, `.limit()`, `.range()` | Non-null approved scalar ordering; explicit 1000-row initial cap and inclusive ranges. Reject unsupported null/reference options. |
| Cardinality | `.single()`, `.maybeSingle()` | Distinguish zero, one, and multiple rows; never silently truncate a multiple-row result. |
| Password auth | `.auth.signUp()`, `.signInWithPassword()`, `.signOut()`, `.getUser()`, `.getSession()`, `.refreshSession()`; four core `onAuthStateChange()` notifications | Core email/password session lifecycle only. Signup's null-user exception requires signoff; global/local logout must match the chosen scope. No auth administration, OAuth, SSR cookies, or full GoTrue behavior. |
| Realtime | `.channel().on('postgres_changes', ...).subscribe()`, `.unsubscribe()`, `.removeChannel()` | One exposed record API binding per channel; approved table-event payload subset, honest errors/loss, and real cleanup. No filters/private channels/full old UPDATE records/commit timestamp claim. |

Portable UUID/owner/boolean values require explicit reviewed field mappings. Backend bootstrap configuration may change during migration; no heuristic coercion or fabricated user/event fields. See the detailed plan for supported options and researched exceptions.

Unsupported features, options, and query shapes must fail explicitly with a recognizable unsupported-feature error. Do not silently ignore arguments or return successful-looking empty results. State whether a failure is returned in `{ data, error }` or thrown by a non-query API, and test that contract.

Do not simulate missing server guarantees with unsafe read/modify/write sequences or fetching all rows for client-side filtering. If the minimum target cannot be implemented faithfully, record the gap and resolve the scope before advertising support.

### Milestones

#### 1. Verify the smallest contract

- [x] Pin the TrailBase server/client and `@supabase/supabase-js` reference versions in the harness baseline/lockfile; archive checksums and service-image digests are enforced.
- [x] Record the maintainer's MIT license decision; keep the harness private pending package/distribution decisions.
- [ ] Check the official TrailBase TypeScript client first; reuse it where it covers records, auth, and subscriptions. Add native HTTP only for confirmed gaps.
- [x] Research official documentation and pinned sources; document differences and open decisions in `docs/RESEARCH.md`.
- [ ] Characterize all seven research gates against installed packages and real backends; obtain named contract decisions.
- [ ] Record supported methods, options, return shapes, backend differences, and feature/test IDs in a compatibility matrix.
- [ ] Verify primary-key formats, filter encoding, range semantics, mutation results, signup behavior, refresh/logout, and realtime payload/cleanup behavior.
- [ ] Decide the actual npm package name, supported runtime versions, and license before distribution.

**Done when:** each initial feature has a verified mapping or an explicit blocking gap. No package scaffolding for future levels.

#### 2. Ship the data-query vertical slice

- [ ] Add one small TypeScript package, the minimum build tooling, and documented commands.
- [ ] Implement the client, query execution, result/error normalization, reads, primary-key-scoped writes, basic filters, ordering, pagination, and cardinality helpers.
- [ ] Add a tiny `todos` example against an exposed TrailBase record API.
- [ ] Implement full unit/property/type, fixture/database, real integration, shared Supabase contract, browser E2E, security/fault, and package test layers as specified in `docs/TEST_PLAN.md`; each query feature needs its own signoff evidence.

**Done when:** the documented data subset works against a pinned TrailBase instance and unsafe or unsupported operations fail clearly.

#### 3. Add only core auth and realtime

- [ ] Implement password signup/login/logout and the minimum session persistence/refresh behavior using native TrailBase capabilities where possible.
- [ ] Define browser/server session ownership and storage behavior. Do not share mutable user sessions across server requests.
- [ ] Adapt basic table subscriptions to the supported `postgres_changes` callback shape; implement cleanup and report connection failures honestly.
- [ ] Extend the full test suite with actual email-confirmation E2E, expired/invalid credentials, concurrent refresh/logout races, global/local revocation, multi-browser persistence, two-client events, fragmented streaming, permission/loss handling, and cleanup.
- [ ] Extend the same small example; do not add Storage, OAuth, Broadcast, or Presence.

**Done when:** one user can authenticate, make authorized queries, receive a database change, and sign out without leaking tokens or leaving subscriptions running.

#### 4. Validate the migration claim and document the release

- [ ] Run the same supported example/query checks against TrailBase and a local or disposable Supabase project using the official SDK; isolate backend setup from application calls.
- [ ] Document a minimal manual schema/data migration for the example, including ID, boolean, timestamp, null, and default-value conventions.
- [ ] Show the import and URL/key changes; list every remaining application-level difference rather than hide it.
- [ ] Explain that migrating auth accounts/sessions, files, and access rules is separate work. Do not claim password hashes, tokens, or policies transfer automatically.
- [ ] Rehearse a real manual fixture export/import with explicit identity mapping and data/ownership invariants; two independently seeded demos do not prove migration.
- [ ] Publish the compatibility matrix, known limitations, example, actual install/build/test instructions, and per-feature evidence/signoff ledger.
- [ ] Pass every required test layer, packaged-consumer smoke, and three clean full runs; obtain maintainer approval for all advertised features and exceptions.

**Done when:** the small documented application can run on both backends with changes bounded by the published contract, and every applicable feature/test/signoff gate passes at the release commit. A release is a verified starter subset, not "drop-in Supabase compatibility."

### Deferred additions within Level 1

These remain SDK work, not prerequisites for the first release:

- Column projections; `.like()`, `.ilike()`, `.in()`, and `.is()` with verified null/case semantics.
- `.upsert()`, batch mutations, mutation `.select()`, and one-level relationship selection, only where native guarantees can match the documented contract.
- OAuth and SSR/cookie integration.
- Basic Storage upload/download after defining the mapping from Supabase buckets/objects to TrailBase file fields and permissions.
- A migration CLI for schema/records first; separately evaluate identities, files, access policies, and sequences. No automatic policy or credential conversion promises.
- Schema/type-generation conveniences if a real consuming application requires them.

The discussion's optional TrailBase + SQLite → TrailBase + Postgres → Supabase + Postgres path is worth investigating later. Experimental Postgres support is not a first-release dependency or a proven migration shortcut.

## Level 2 — Supabase HTTP compatibility gateway

**Status: eventual goal; not authorized for initial implementation.**

```text
Application using unmodified @supabase/supabase-js
    ↓
Compatibility gateway: /rest/v1, /auth/v1, /storage/v1
    ↓
Native TrailBase APIs
```

Purpose: let the official Supabase SDK talk to TrailBase for a defined subset, avoiding the custom SDK import entirely.

Future work:

1. Start with the verified Level 1 contract, not all of PostgREST.
2. Translate requests, filters, selected fields, headers, status codes, response bodies, pagination, and error shapes.
3. Add the necessary Auth and Storage endpoint contracts; separately scope realtime transport compatibility if required.
4. Test through an unmodified, pinned official Supabase SDK, including malformed requests, credentials, access control, and unsupported features.
5. Document deployment, configuration, and the supported protocol surface.

**Entry gate:** Level 1 is useful and tested, and a real consumer needs the official SDK or another Supabase HTTP client. Do not extract a shared gateway framework in anticipation.

**Success:** an unmodified official SDK can run the agreed subset against TrailBase. This still does not imply full Supabase compatibility.

## Level 3 — Drop-in Supabase server replacement

**Status: long-term aspiration; very high complexity and potentially infeasible in full.**

```text
Existing Supabase application and tooling
    ↓
Supabase-compatible server surface
    ↓
TrailBase-backed runtime
```

The discussion identifies the broader target as:

- PostgREST query semantics, including nested relationships and richer operators.
- GoTrue/Auth API behavior and session semantics.
- Storage API behavior and permissions.
- Realtime protocols and behavior, including Broadcast/Presence where claimed.
- RPC, Postgres RLS semantics, and broader database-dependent behavior.
- Supabase CLI expectations and tooling integration.

Exact Postgres behavior and arbitrary RLS cannot simply be mapped onto SQLite and TrailBase access rules. This level needs its own feasibility study, compatibility specification, database strategy, conformance tests, and sustained maintenance plan. Changing the backend database may reduce some gaps but does not solve service/protocol compatibility by itself.

**Entry gate:** proven demand beyond Level 2, explicit approval, and evidence that the required semantics can be supported without weakening security or data integrity.

**Success:** only claim drop-in behavior for explicitly tested versions and capabilities. Full compatibility is an eventual ambition, not a release promise.

## Working principles

- Keep one small client package; no server fork, monorepo, plugins, backend abstraction framework, or future gateway scaffolding.
- Prefer verified native capabilities over emulation; never weaken authorization to make an example pass.
- Keep credentials out of code, logs, examples, and commits. A Supabase publishable key is not a replacement for a TrailBase user session.
- Check behavior, not just method names. Version differences and backend limitations belong in the compatibility matrix.
- Finish one fully tested vertical slice before widening the API surface. Promote deferred work only for a demonstrated need and explicit scope change.
- Every change and future level requires a test plan across all applicable layers, explicit signoff criteria, and reproducible evidence. Never substitute a single smoke check for the full suite.
