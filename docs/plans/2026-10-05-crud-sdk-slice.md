# CRUD SDK Slice Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Implement first Supabase-shaped TrailBase data slice: typed client/config, explicit field mapping, query reads, and single-record CRUD.

**Architecture:** Keep one TypeScript package. Wrap pinned `trailbase@0.14.3` record APIs for native transport/query execution; add only the mapping, validation, result, and builder logic needed by the approved subset. Use the existing disposable TrailBase/Supabase fixtures for real differential tests; no backend abstraction or server changes.

**Tech Stack:** TypeScript 7, Vitest 5, pinned TrailBase client 0.14.3, Supabase JS 2.117.2 as test oracle, existing Phase A real-backend harness and Playwright 1.63.

---

## Scope and acceptance

Implement L1-01–L1-13 data behavior incrementally. Do not implement password auth, realtime, migration, or deferred operators in this slice. G1/G7 remain unresolved documented auth edge cases and do not block this work. No adapter feature is signed off by unit tests alone.

Before marking this slice verified, add and run applicable layers:

| Feature IDs | Required evidence |
| --- | --- |
| L1-01–04 | Unit tests for config, injected transport, lazy/repeated execution, errors, and builder isolation; emitted declarations and compile-positive/negative consumers. |
| L1-03 | Deterministic UUID/scalar codec boundaries, including at least 1000 UUID round trips and invalid UUID/boolean/unsafe-number rejection. |
| L1-05–13 | Real TrailBase adapter and official Supabase/local-stack shared operations for reads, insert/update/delete, filters, order, ranges, and cardinality. Assert complete row/audit postconditions and no extra mutation requests. |
| L1-05–13, S02/S03/S05 | Owner-isolation and invalid-input checks against actual backend access rules; rejected query/mutation shapes issue zero requests. |
| E04–E06/E11/E13 | Built data example exercised on Chromium, Firefox, and WebKit against disposable backends; no mocked successful data responses. |
| L1-02/L1-26, P02/P26 | Build declarations and install generated tarball in clean Node/browser consumers; package command must use actual built output. |
| L1-27 | Existing fixture setup/cleanup remains exact, private, loopback-only, and pinned. Setup failure is failure; cleanup and lock-clear are asserted. |

All historical strict Phase A failures remain unchanged. Record exact current-source outcomes in `docs/progress.json`; do not call the first successful unit run compatibility proof or maintainer signoff.

## Task 1: Public types, mapping, and client setup

**Files:** `src/index.ts` (create), `src/types.ts` (create only if needed), `tests/unit/sdk-client.test.ts` (create), `tests/types/sdk-public.test.ts` (create), `tsconfig.sdk.json` (create), `package.json` (modify scripts/runtime dependency only when imported by production source).

1. Write a failing L1-01/U01 test for `createClient()` with a valid TrailBase URL, optional unused key, explicit `todos` mapping, and injected Fetch. Assert one configured client and no request at construction.
2. Run `npx vitest run tests/unit/sdk-client.test.ts`; expect missing-export failure.
3. Add minimum public types and client constructor. Reject unsupported URL/options before any transport call; do not treat key as TrailBase authorization.
4. Add compile-positive Database Row/Insert/Update calls and `@ts-expect-error` checks for invalid table/field/method shapes.
5. Run focused Vitest and `npm run check`; expect both pass after evidence freshness is refreshed.

## Task 2: Declared field codecs and validation

**Files:** `src/index.ts` or one small `src/codec.ts`; `tests/unit/sdk-codec.test.ts`.

1. Write failing mapping tests for canonical UUIDv4 ↔ padded URL-safe TrailBase UUID bytes, booleans ↔ 0/1, safe integers, text, nullable values, and omission/default semantics.
2. Run focused tests; confirm expected missing behavior.
3. Implement conversion only for explicitly declared fields. Reject unknown fields, malformed UUIDs, non-boolean booleans, non-safe integers, implicit Date/bytes/objects, and null for non-null columns before wire.
4. Add a deterministic 1000-case UUID round-trip check and invalid/boundary vectors.
5. Run focused codec tests and `npm run check`.

## Task 3: Read/query builder and cardinality

**Files:** `src/index.ts` or one small `src/query.ts`; `tests/unit/sdk-query.test.ts`.

1. Write failing tests for lazy `.from().select()`, six AND filters, stable encoded values, supported ordering, limit/range bounds, and `.single()`/`.maybeSingle()` zero/one/many results.
2. Run focused tests and inspect the failing request/result assertions.
3. Wrap TrailBase `records().list()` with declared mapping and explicit pagination; reject projections/count/head, null predicates, referenced options, unknown columns, and unsafe values before request.
4. Preserve characterized builder semantics: lazy execution, every await is a fresh request, same builder remains mutable, independently created builders are isolated, and last effective bound wins. Handle limit zero without falling through TrailBase client's truthiness omission; return the approved adapter-origin range error for positive offset plus zero limit.
5. Add tests proving errors preserve native status/message without fabricated SQL codes; cardinality must not truncate multiple rows.
6. Run focused tests, types, and the complete unit suite.

## Task 4: Single-record CRUD

**Files:** same query module; `tests/unit/sdk-mutations.test.ts`.

1. Write failing tests for one-object insert; primary-key-only update/delete; null success data; unknown-field/array/returning/upsert rejection; no request for invalid mutations.
2. Run focused tests and verify expected missing behavior.
3. Delegate supported create/update/delete to the pinned native record API. Convert only mapped fields; discard native create ID; require exactly one explicit primary-key equality for update/delete; reject attempts to change primary key.
4. Add repeated-await tests proving operations execute again rather than being memoized, and transport-lost replies are surfaced without automatic replay.
5. Run focused tests and full unit/type checks.

## Task 5: Real TrailBase and Supabase contract tests

**Files:** `tests/phase-a/sdk-data.test.ts` (create), `scripts/run-phase-a.mjs` only if a dedicated suite name is needed, `package.json` only for an explicit SDK integration command.

1. Write failing tests using generated confirmed fixture users and exact owned row IDs; run only through disposable `npm run test:phase-a sdk-data` setup.
2. Compare identical supported reads and mutations against adapter+TrailBase and installed Supabase SDK+local Supabase. Assert actual rows, defaults, nulls, permissions, status/error differences, no side effects for rejected operations, and cleanup.
3. Use A/B/anonymous clients to prove owner isolation. Never use fixture admin credentials for application requests.
4. Run the focused real suite; verify setup/cleanup, pinned image inventory, source hash, and clear lock. Keep expected historical gate failures separate.
5. Run relevant database/constraints controls and full Phase A only when required by fixture/source changes; do not reinterpret existing probe results as adapter tests.

## Task 6: Build and browser/package consumers

**Files:** `examples/todos/` (minimal accessible data UI), `tests/phase-a-browser/` (real data E2E), package build config/scripts, and clean-consumer test script.

1. Add the smallest build command using installed TypeScript tooling; no bundler dependency unless the browser build proves it necessary.
2. Build a minimal todos interface with labeled controls and visible errors; inject backend bootstrap/mapping without privileged keys.
3. Add real CRUD/filter/page/cardinality scenarios and owner-denial postconditions on Chromium, Firefox, and WebKit.
4. `npm pack` the private package and install it into temporary clean Node/browser consumers; import only package exports/build output.
5. Run package checks, all three browser projects, all unit/type tests, focused real integration, `npm run check`, and `git diff --check`.

## Explicit limitations

- Signup duplicate-pending/SMTP recovery (G1) and logout acknowledgement/late session races (G7) remain documented unresolved auth edge cases; neither is addressed here or a reason to stop this data slice.
- No realtime, migration, relationships, upsert/bulk writes, Storage, OAuth, SSR cookies, or arbitrary JSON/BLOB/Date support.
- Passing implementation tests is not SDK feature signoff, release approval, or evidence that historical strict failures were fixed.
