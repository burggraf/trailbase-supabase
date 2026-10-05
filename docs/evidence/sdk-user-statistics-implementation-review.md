## Review

- **Correct:** Implementation matches the narrow advice. Both snapshots validate exact four-field records, reject duplicate `(type,name)` objects, and require canonical statistics definitions even when already present (`tests/phase-a/native-owned-user.mjs:20–35`). Case-insensitive detection only rejects noncanonical reserved names; SQL is not normalized.
- **Correct:** Only canonical statistics records absent before are excluded from the comparison. Every remaining existing/application/internal object must remain identical (`:38–42`). There is no blanket SQLite-internal exemption.
- **Correct:** Raw schema change, prohibited change and fixed bookkeeping names are distinct. Config, unrelated identities and sessions remain mandatory failure conditions (`:44–50, 103–105`). Complete exclusive-mode0600 diagnostics remain intact (`:58–61, 82–102`).
- **Correct:** Real assertions acknowledge permissible bookkeeping without claiming raw schema equality (`tests/phase-a/sdk-auth.test.ts:82–84`). Owner checks, genuine cascade/audit assertions, forged/revoked/deleted-user checks and independent cleanup remain preserved (`:85–102`).
- **Correct:** Negative tests cover application/internal add/drop/change, statistics removal and malformed definitions, duplicates, inherited/extra fields, case variations, and concurrent protected-state changes (`tests/unit/sdk-native-schema.test.ts:11–31`). Diagnostic privacy and failure aggregation remain covered (`tests/unit/sdk-native-owned-user.test.ts:23–33`).
- **Correct:** Documentation labels this a fixture metadata correction—not an auth compatibility exception, physical-database/query-plan equality or signoff (`docs/evidence/sdk-user-statistics-guard-checkpoint-node22.json`).

**No issues found.**

- **Fixed:** The previously overbroad raw-schema invariant is now refined exactly as advised; verified by source inspection, not reviewer execution.
- **Merge verdict:** **OK with notes** for this bounded implementation.

### Evidence limits

No commands, fixtures, edits or staging were performed. The supplied source hash `42c5ce…bb7aa` was not independently recomputed.

Reported Node22 **114/114 SDK, 164/164 mixed** results are supporting artifacts, not reviewer executions. Parent `proc_1284` auth outcomes and subsequent refresh results were not verified. Preserved diagnostic failures remain failures; this review does not establish live-getUser, cascade/audit or refresh runtime success. No maintainer signoff is inferred.