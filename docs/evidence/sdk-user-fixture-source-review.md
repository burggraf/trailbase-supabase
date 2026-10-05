## Review

**Scope:** Bounded cancellation-fix recheck and new native-owned-user fixture helper at supplied source `3c3d823168e992cf7e36d404cff7ac3664f6a6cff8decbf78f8c291580f37615`.

- **Fixed — prior P1:** Successful status responses now expose their owned cancellation closure before returning. `liveUser` invokes it when discarding/erroring, including the immediate stale-baseline path (`src/auth.ts:151–156, 186, 282–305`). Cancellation is non-awaited; synchronous/rejected cancellation failures are swallowed without replacing the operation error. The regression tests cover open bodies, rejecting/held cancellation, aborted signal, zero JSON reads and unchanged B credentials (`tests/unit/sdk-auth-user.test.ts:53–58`). This closes the previously reported path by source inspection.
- **Correct — scope preservation:** Only status supplies the new callback. Signup/login/refresh behavior and redirect-first/native-refresh401 classification remain unchanged.
- **Correct — helper privilege boundary:** Generated owner/email validation and an exact two-verb allowlist precede execution. Arguments go through `execFile`, not a shell (`tests/phase-a/native-owned-user.mjs:9–13`; `scripts/tools.mjs:4–8`). Run/depot realpaths, project ownership, run identity, auth variant/profile and actual DB owner email are checked (`native-owned-user.mjs:22–30`). No creation, minting, admin promotion, browser credential or SDK privilege path is introduced.
- **Correct — native constraint repair:** The helper checks the existing pinned archive, executable realpath/version and bounds mutation execution to 20 seconds, without download/fallback (`native-owned-user.mjs:33–41`). Harness startup verifies and extracts that archive (`scripts/harness.mjs:237–240`; `scripts/tools.mjs:31–39`). Traced native CLI code initializes `AppState` and performs parameterized owner-ID update/delete (`.runtime/upstream-g1/source/crates/cli/src/bin/trail.rs:198–237`; `crates/core/src/auth/cli.rs:78–95, 147–160`). Its connection setup registers original native extensions and enables foreign keys—not fake UDFs or disabled checks (`crates/core/src/connection.rs:478–483`; `crates/extension/src/lib.rs:34, 72–74`).
- **Correct — invariants and cleanup:** Main SQLite access is now read-only. Schema/config and unrelated complete identity/session digests are compared around native mutation; failures retain private diagnostics rather than exporting CLI output (`native-owned-user.mjs:15–18, 31–46`). Real tests assert the acquired owner, genuine owned todo insertion, identity deletion, cascade absence and exact audit `INSERT/DELETE` sequence (`tests/phase-a/sdk-auth.test.ts:75–96`). Session/user cleanup and handle closes remain independent cleanup steps (`:98–100`).

**No issues found.**

- **Merge verdict:** **OK with notes** for this bounded development change. No maintainer signoff or release/compatibility approval.

### Evidence limits

No commands, fixtures, edits or staging were performed. The source hash was not independently recomputed.

The preserved initial real report records auth **1 passed/1 failed**, with fixture cleanup passed—not live-user verification. Source tracing supports the native-UDF repair, but successful runtime repair remains unproven here. Reported Node22 **108/108 SDK, 158/158 mixed** results were supporting artifacts, not reviewer executions. Parent `proc_c8bd` auth/refresh outcomes were not verified.

Deferred lifecycle/defaults/timers/logout/events, parity/security/coverage/CI/release and G1/G7 remain missing or unsigned; they are not findings against this slice.