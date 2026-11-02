# Bounded auth diagnostics and redirect regression milestone

## Contract before implementation

Approved scope: existing L1-14/L1-19/L1-24/L1-27 and S01/S04/S07/S08/S10 tests/reporting, not a new SDK API or backend repair. Sole executor; no commit/push, dependency/server changes, live fixture setup/cleanup or deployment.

- Permanent actual-SDK tests use two owned ephemeral loopback HTTP servers and synthetic unsigned credentials only. Register/login/status/refresh/local logout/global logout/data read/data write must make zero foreign receiver requests. Failed login/validation/refresh must not install a redirected session; logout must clear only owned state and honestly report local failure/global unconfirmed acknowledgement. Raw Fetch follow behavior is a separately labeled platform control, not an SDK/user-session leak.
- An explicit small static registry maps assertion/step IDs to fixed diagnostic categories. Test wrappers tag metadata/annotations only when an operation/assertion throws and rethrow the identical error. Private runner JSON/logs retain original errors. The public projection reads only registered literal IDs through own data properties; unknown/accessor/inherited/malicious values become a fixed unclassified category. Never parse error messages/stacks or export expected/actual, headers, accounts, task text, URLs or query values. Runner console failures use literal messages, not error-message prefixes.
- Preserve test names, strict status, retries/attempt counts, source/run/CI binding and unconditional owned cleanup. Playwright multiple attempts remain failed, even if the last passes. Historical research failures are not rewritten or waived.

## Exact intended files

`tests/unit/sdk-redirect-boundary.test.ts`; `scripts/phase-a-diagnostics.mjs`; `tests/unit/phase-a-diagnostics.test.ts`; `scripts/run-phase-a.mjs`; selected existing G1/G7 assertions in `tests/phase-a/characterization.test.ts`, `tests/phase-a/smtp.test.ts`, `tests/phase-a/auth-lifecycle.test.ts`, and browser hydration in `tests/phase-a-browser/auth-storage.spec.ts`. README/test plan get narrow diagnostic documentation; ledger/evidence preserve existing recovery/CI triage work.

## Validation and measurable evidence

- Unit/security/property: adversarial planted passwords, JWT/Bearer/refresh/CSRF material, email/task/private-key/query data; throwing getters/proxies/coercion; unknown IDs; identical rethrow; successful steps untagged; original failed assertion remains failed. Actual HTTP sockets close in finally and receiver counts stay zero for eight paths. Run full units/static on both pinned Nodes.
- Regression strength: remove auth/data/local/global redirect guards only in an owned isolated source copy; designated actual-HTTP tests must fail for foreign receipt and session/error postconditions. Restore the copy and rerun green. Never alter served assets or live source files for mutation experiments.
- Reporter integration: execute installed Vitest/Playwright JSON reporters against tiny deliberately failing generated cases; pass their real output through the same production projection. Safe code appears, status stays failed, raw diagnostics stay private. This is reporting proof, not mocked backend compatibility.
- Real G1/G7: run applicable focused characterization, SMTP stock/candidate, and lifecycle scopes only in a private isolated checkout with copied baseline tools/install, its own Git index/lock/depot/generated loopback ports. Preserve strict reds and their newly useful IDs. No tailnet forwards, shared runtime files, linked data or global resource pruning. Verify exact owned resources absent after cleanup and original fixture metadata unchanged.
- Package/type/docs: unchanged public API still compiles; run applicable packed-consumer checks, `npm run check`, `npm run test:unit`, and diff/privacy checks. Broader browser/coverage/release/reference signoff remains open, not replaced by synthetic transport or reporter tests.
- Rank the next signup recovery/global logout repair using actual stable failure locations. No public behavior change merely to make upstream assertions pass; G1/G7 remain unresolved without separately authorized, verified repair.

## Initial operational observation

At this milestone's read-only check all recorded guardian588146/native588372/proxies588390,588405 were absent; both HTTPS URLs refused connections. Existing status says `stopped`/`requested-stop`; its exact file modification time is `2026-11-01T19:26:55.821Z`. That is the stop-record write timestamp, not a recorded signal-arrival time or proof of a human request/actor. Current lock/run owner records still name this run and those successor PIDs. Preserve lock/depot/containers/credentials/previous evidence; no restart or death-cause investigation in this milestone.
