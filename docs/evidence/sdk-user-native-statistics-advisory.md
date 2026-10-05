## Review

**Verdict:** The proposed refinement is a genuine fixture-guard correction within the approved native-CLI scope—not a Supabase compatibility exception or authorization relaxation. It must explicitly acknowledge the bookkeeping addition rather than claim raw schema equality.

### Evidence and reasoning

- The first invocation’s schema snapshots contain **30 existing objects unchanged**, plus exactly two new canonical tables:
  - `sqlite_stat1`: `CREATE TABLE sqlite_stat1(tbl,idx,stat)`
  - `sqlite_stat4`: `CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)`

  Evidence: `.runtime/runs/1791236990141-35f386ded6c2/native-owned-user-14cb9178-29db-407a-bab8-bf1a81479f71-{before,after}-private.json`, schema sections at lines 4–185 and 3–196; additions at after lines 118–129.

- Source provides the relevant main-connection explanation: `trailbase_extension::connect_sqlite` executes `PRAGMA optimize=0x10002` (`.runtime/upstream-g1/source/crates/extension/src/lib.rs:76–77`). The separate native connection helper also does so (`crates/core/src/connection.rs:651–652`). This supports native optimizer bookkeeping, not application DDL.
- The current guard intentionally compares the entire schema snapshot and therefore rejects these additions (`tests/phase-a/native-owned-user.mjs:20–21, 47, 74–75`). Exclusive private snapshots remain preserved (`:29–33`).
- Config/unrelated identity/session equality and the second invocation’s unchanged invariants are parent-reported results; I did not read secret-bearing snapshot sections to independently compare them.

### Exact recommended guard

1. Preserve the complete before/after snapshots.
2. Validate schema records and reject duplicate object keys; do not use a set that silently collapses duplicates.
3. Permit an added record **only when absent before** and exactly equal to one of:
   - `{type:"table", name:"sqlite_stat1", tbl_name:"sqlite_stat1", sql:"CREATE TABLE sqlite_stat1(tbl,idx,stat)"}`
   - `{type:"table", name:"sqlite_stat4", tbl_name:"sqlite_stat4", sql:"CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)"}`
4. Validate those reserved-name records as canonical in either snapshot, including pre-existing records.
5. Remove **only those validated newly added records** from the comparison. Require every remaining record—including pre-existing statistics tables and all other SQLite internal objects—to remain exactly identical.
6. Do not normalize SQL whitespace/case, allow `sqlite_%` generally, permit removals/modifications, or ignore simultaneous application changes.
7. Keep config, unrelated identities/sessions, owner postconditions, constraints, access rules, executable pins and ownership checks unchanged.
8. Report fixed-name bookkeeping creation separately. Distinguish **raw schema changed** from **prohibited schema change**; never overwrite the preserved failed attempt with “schema unchanged.”

This protects the selected schema-definition metadata, not physical database bytes, statistics contents or unchanged query plans.

### Required tests

- Accept unchanged schemas, first canonical creation of either/both tables, and unchanged pre-existing canonical tables.
- Reject additions, removals or modifications of application tables/indexes/triggers/views and non-allowlisted internal objects.
- Reject either statistics table’s removal, altered SQL/type/table-name/name, noncanonical spelling/whitespace, extra attributes and duplicate records.
- Reject canonical statistics creation combined with any forbidden schema/config/identity/session change.
- Verify bookkeeping reporting and private snapshot retention without leaking rows, configuration or CLI output.
- Run genuine native auth/cascade/audit postconditions and refresh separately afterward. Comparator tests cannot establish those runtime results.

**No issues found.** This assessment is conditional on the narrow guard above; its implementation has not been reviewed.

**Merge verdict:** **OK with notes** for the proposed technical refinement. No maintainer signoff or release authorization.

### Evidence limits

No commands, edits or fixtures were run; the supplied hash was not recomputed. The diagnostic report remains **auth 1 passed/1 failed, cleanup passed** (`docs/evidence/sdk-user-diagnostic-real-node22.json`). New live-getUser and SDK-refresh behavior remain unproven. Deferred lifecycle/security/parity/release requirements and G1/G7 remain pending.