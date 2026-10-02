# Project plan

## Purpose and scope

Build a small TypeScript compatibility client so starter applications can use familiar Supabase calls against TrailBase and later migrate to Supabase with limited application changes.

This plan follows the [source discussion](https://chatgpt.com/share/6ac02347-6a48-83e8-b8b8-8ef8986f9a0f). The discussion is exploratory: its proposed API mappings and effort estimates are hypotheses, not verified contracts. Confirm actual behavior against pinned TrailBase and Supabase SDK versions before implementation.

**Only the minimal Level 1 prototype is in initial scope.** Levels 2 and 3 are documented eventual goals, not work to start now. Do not fork TrailBase, emulate Supabase wire protocols, or build a migration CLI for the first release.

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
| Ordering/pagination | `.order()`, `.limit()`, `.range()` | Match supported ordering and inclusive range behavior; document offset/cursor differences. |
| Cardinality | `.single()`, `.maybeSingle()` | Distinguish zero, one, and multiple rows; never silently truncate a multiple-row result. |
| Password auth | `.auth.signUp()`, `.signInWithPassword()`, `.signOut()`, `.getUser()`, `.getSession()`, `.refreshSession()` | Only the session lifecycle needed for password auth; no auth administration, OAuth, SSR cookies, or full GoTrue behavior. |
| Realtime | `.channel().on('postgres_changes', ...).subscribe()` and subscription cleanup | One exposed record API per channel; table change events only. The event name does not imply a Postgres backend. Verify event payloads and available old/new row data. |

Unsupported features, options, and query shapes must fail explicitly with a recognizable unsupported-feature error. Do not silently ignore arguments or return successful-looking empty results. State whether a failure is returned in `{ data, error }` or thrown by a non-query API, and test that contract.

Do not simulate missing server guarantees with unsafe read/modify/write sequences or fetching all rows for client-side filtering. If the minimum target cannot be implemented faithfully, record the gap and resolve the scope before advertising support.

### Milestones

#### 1. Verify the smallest contract

- [ ] Pin the TrailBase server/client and `@supabase/supabase-js` reference versions.
- [ ] Check the official TrailBase TypeScript client first; reuse it where it covers records, auth, and subscriptions. Add native HTTP only for confirmed gaps.
- [ ] Record supported methods, options, return shapes, and backend differences in a compatibility matrix.
- [ ] Verify primary-key formats, filter encoding, range semantics, mutation results, signup behavior, refresh/logout, and realtime payload/cleanup behavior.
- [ ] Decide the actual npm package name, supported runtime versions, and license before distribution.

**Done when:** each initial feature has a verified mapping or an explicit blocking gap. No package scaffolding for future levels.

#### 2. Ship the data-query vertical slice

- [ ] Add one small TypeScript package, the minimum build tooling, and documented commands.
- [ ] Implement the client, query execution, result/error normalization, reads, primary-key-scoped writes, basic filters, ordering, pagination, and cardinality helpers.
- [ ] Add a tiny `todos` example against an exposed TrailBase record API.
- [ ] Leave a runnable check covering successful reads/writes, filter encoding, inclusive ranges, cardinality, backend failures, and unsupported calls. Use existing or native test tooling rather than a new framework by default.

**Done when:** the documented data subset works against a pinned TrailBase instance and unsafe or unsupported operations fail clearly.

#### 3. Add only core auth and realtime

- [ ] Implement password signup/login/logout and the minimum session persistence/refresh behavior using native TrailBase capabilities where possible.
- [ ] Define browser/server session ownership and storage behavior. Do not share mutable user sessions across server requests.
- [ ] Adapt basic table subscriptions to the supported `postgres_changes` callback shape; implement cleanup and report connection failures honestly.
- [ ] Extend runnable checks for expired/invalid credentials, refresh failure, logout cleanup, event mapping, and unsubscribe behavior.
- [ ] Extend the same small example; do not add Storage, OAuth, Broadcast, or Presence.

**Done when:** one user can authenticate, make authorized queries, receive a database change, and sign out without leaking tokens or leaving subscriptions running.

#### 4. Validate the migration claim and document the release

- [ ] Run the same supported example/query checks against TrailBase and a local or disposable Supabase project using the official SDK; isolate backend setup from application calls.
- [ ] Document a minimal manual schema/data migration for the example, including ID, boolean, timestamp, null, and default-value conventions.
- [ ] Show the import and URL/key changes; list every remaining application-level difference rather than hide it.
- [ ] Explain that migrating auth accounts/sessions, files, and access rules is separate work. Do not claim password hashes, tokens, or policies transfer automatically.
- [ ] Publish the compatibility matrix, known limitations, example, and actual install/build/test instructions. Choose packaging/release automation only when needed.

**Done when:** the small documented application can run on both backends with changes bounded by the published contract. A release is a verified starter subset, not "drop-in Supabase compatibility."

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
- Finish one runnable vertical slice before widening the API surface. Promote deferred work only for a demonstrated need and explicit scope change.
