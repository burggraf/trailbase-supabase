# Development progress and restart guide

**Current phase: A — proof harness; G1 contract completion is blocked. No SDK feature is signed off.**

Stock TrailBase v0.34.3 fails real confirmation after duplicate unconfirmed registrations. SMTP retry/recovery exercises the same pending-row problem. See [the pinned-source diagnosis](RESEARCH.md#blocking-g1-regression-duplicate-pending-registrations). The regressions remain strict/red; no auth-schema workaround or maintainer approval has been assumed.

The [current blocker run](evidence/phase-a-g1-blocker-node22.json) has **17 passing and 2 failing upstream cases**; both failures are native confirmation HTTP 400. **22 unit guards passed**, and cleanup passed with no owned Docker resources remaining. The browser stage did not run because upstream assertions failed. SMTP/reference recovery and the fresh native mail control ran before the failing retry-confirmation assertion. These partial results do not make G1 or the full suite green.

[progress.json](progress.json) is the authoritative status/signoff ledger. Run `npm run progress` to see Phase A deliverables, missing checks, open gates, and ordered next steps. Read this file first after a restart, then the [implementation plan](LEVEL1_PLAN.md) and [test matrix](TEST_PLAN.md).

## Status and completion rules

| Status | Meaning |
| --- | --- |
| planned | Contract/test requirements exist; implementation has not started |
| in-progress | Work or characterization started; see `missing` and evidence |
| implemented | Code exists; required verification is still incomplete |
| verified | Required checks for the recorded scope/environment passed; not maintainer approval |
| signed-off | Required tests/decisions complete; named maintainer reviewed current evidence |
| blocked | A concrete failing prerequisite/decision prevents progress |

**Completed means signed-off, not merely implemented or locally passing.** A harness result does not verify an SDK feature. The license is MIT by the maintainer's explicit instruction; this is not approval of the seven compatibility exceptions. The npm project remains private, with a provisional unscoped name; no package has been published.

### Stable tracking IDs

- `A01`: restartable ledger, validation, evidence and handoff process.
- `A02`: exact tools/dependencies/service images/runtime targets, MIT license and package naming.
- `A03`: disposable TrailBase/Supabase/SMTP, checked-in schema/config and lifecycle.
- `A04`: fixture/database/permission and cleanup-failure checks.
- `A05`: upstream characterization for G1–G7 and three-browser infrastructure checks.
- `A06`: CI execution and required gates, with unimplemented SDK layers explicitly incomplete.
- `L1-01`–`L1-27`: [feature matrix](TEST_PLAN.md); statuses tracked individually in JSON.
- `G1`–`G7`: [research decisions](RESEARCH.md); observations are not approval.

## Recorded local verification

The earlier foundation on macOS arm64 / Node **22.23.2** passed the results below. These reports are historical for the now-expanded source, not evidence that the new G1 regressions pass:

| Evidence | Result |
| --- | --- |
| [Unit guards](evidence/phase-a-unit-node22.json) | 22 cases, including 1000 seeded UUID vectors |
| [Real upstream/browser infrastructure](evidence/phase-a-all-node22.json) | 16 database/auth/query/stream cases and 6 browser scenarios (Chromium/Firefox/WebKit); includes 10 pgTAP assertions |
| [Injected setup failure](evidence/phase-a-lifecycle-node22.json) | Cleanup passed after both servers had started |
| `npm run check` | TypeScript, JavaScript syntax, docs/traceability, evidence freshness and secret scan passed |

Confirmed duplicate-signup probes now verify no new session, preserved original passwords, matching wrong/unknown-login error contracts, and disabled phone signup. The reference fixture explicitly disables both email and SMS auto-confirmation; phone signup stays disabled. The initial failed probe is retained in [historical failure evidence](evidence/phase-a-g1-initial-failure.json), not counted green.

No owned fixture containers/volumes/networks remained. **[Earlier-foundation Linux x64 CI passed](https://github.com/burggraf/trailbase-supabase/actions/runs/37083854601)**: static/unit checks on Node 22.23.2 and 24.21.0, plus real backends/all three browsers/injected-failure cleanup on Node 22. Sanitized earlier-foundation CI reports are preserved in `docs/evidence/phase-a-ci-*.json`. The earlier foundation CI is historical and remains traceable through the ledger/Git history. Node 24 real-backend/browser execution is not claimed. Remaining characterization, full SDK layers and maintainer signoff are still pending. These are **foundation results, not completion of Phase A or SDK compatibility**.

## What exists now

- Private, MIT-licensed npm harness with exact dependency lockfile and TrailBase release archive checksums.
- Exact Supabase CLI and first-boot service image/digest lock; image drift fails setup rather than adopting `latest`.
- Owner-protected UUID/integer/nonstandard-key fixtures, defaults/constraints, read-only views, confirmation-required auth and local Mailpit SMTP.
- Real upstream tests for signup/confirmation, UUID/boolean/default representations, unknown filters, 50/1000/1001 pagination, range/cardinality/builder behavior, forbidden/missing writes and two-session logout.
- Real native/Supabase change-event probes and deterministic installed-SDK parser characterization using a captured real native event. This is not a working SSE fallback or full stream-security proof.
- Chromium/Firefox/WebKit **infrastructure** scenarios using real browser HTTP/CORS, email-link navigation, explicit login and protected writes/reads. These deliberately do not pretend to be the future SDK/example application's complete E01–E15 suite.
- Guard/unit tests and a progress validator that refuse unsupported targets, ownership/checksum/image drift, missing evidence or incomplete signoff metadata.
- CI for Node 22.23.2/24.21.0 harness checks and primary-Node real backends/browsers/cleanup. CI status is not assumed from the workflow file; actual run URLs/results belong in the ledger.

See the ledger's `evidence` and `missing` fields for what actually ran versus what only exists in code. Coverage/release thresholds for the future SDK remain mandatory; the harness is not used to inflate SDK coverage.

## Restart and reproduce

Prerequisites: Node 22.23.2 or 24.21.0, npm, a running **local Unix-socket Docker daemon**, `curl` and `unzip`. macOS/Linux arm64/x64 TrailBase fixtures are supported by the download manifest; only recorded environments are verified. Allow several minutes and disk space for the first database/browser downloads.

```sh
npm ci
npm run progress
npm run check
npm run test:unit
npx playwright install chromium firefox webkit
# Linux: npx playwright install --with-deps chromium firefox webkit
npm run test:phase-a
npm run test:cleanup
```

| Command | Current scope / result expectations |
| --- | --- |
| `npm run check` | Harness TypeScript/script syntax, markdown links/IDs, ledger structure, evidence freshness and secret scan |
| `npm run test:unit` | Harness/ledger/fixture guard checks plus 1000 seeded fixture UUID vectors; not SDK unit coverage |
| `npm run test:phase-a` | Provision real backends, run database/characterization/stream tests and all three browser infrastructure scenarios, then always clean up |
| `npm run test:db` | Isolated real fixture/database tests only (includes 10 pgTAP assertions) |
| `npm run test:integration` | Isolated upstream characterization only; not the unimplemented adapter integration suite |
| `npm run test:phase-a:browser` | Isolated three-browser infrastructure subset |
| `npm run test:cleanup` | Deliberately fail setup after both servers start; pass only if owned native/Docker resources are torn down |
| `npm run tools:install` | Download/check/extract the exact native TrailBase archive |
| `npm run test:contract`, `test:security`, `test:e2e`, `test:package`, `test:all` | **Fail intentionally:** full SDK gates do not exist yet. They are not aliases for the smaller Phase A probes |

The runner allocates fresh ports/project IDs/users and ignores hosted Supabase/TrailBase environment variables for provisioning. It uses an owned loopback-binding Docker network and rejects non-loopback published ports; the native HTTP origin also serves a per-run ownership marker. It never resets a linked/live project. One local run at a time is intentional; never bypass its lock to run overlapping resets.

### Interruptions and failures

- Normal failure/SIGINT/SIGTERM goes through owned-resource cleanup. Startup and test waits are bounded.
- After a hard kill, consult the private `.runtime/phase-a.lock/owner.json` and `.runtime/runs/<run-id>/owner.json`. If the recorded runner is still live, stop that runner and let cleanup finish; do not start a second reset.
- For a dead runner, use `npm run fixtures:cleanup -- <run-id>`. Recovery verifies directory/project/PID ownership and refuses unrelated processes, projects or a remote Docker daemon. It checks for remaining owned containers/volumes/networks before clearing a matching stale lock.
- Never use global Docker prune, delete someone else's depot, or blindly remove a lock. If ownership/PID checks fail, record the blocker and inspect instead of overriding safety.
- Private raw logs/reports/mail/tokens are under `.runtime` and are **not** safe to publish. Owned depots/current context credentials are deleted after cleanup; private diagnostics may still contain credentials. Retain only as long as needed, then remove the stopped run's directory.
- Sanitized allowlisted summaries are under `artifacts/phase-a/` and `artifacts/unit/`; CI uploads only these. Reports retain scope, versions/digests, source hash, test names/status and cleanup results, never response bodies/mail links/headers.
- This Mac's Node HTTPS browser downloader timed out; exact official browser revision archives were fetched through `curl` into the normal Playwright cache for local verification. That workaround is not a product dependency or a claim that standard installation worked locally.

## Evidence, approval, and the end-of-session handoff

1. Run every applicable command and preserve its **sanitized** report. The source hash covers Git-visible scripts/tests/config/lockfile/workflow, contract docs, and future SDK/example code; Git-ignored caches/private files are excluded. Changed sources make old evidence stale. CI reports also identify the tested Git commit/run URL.
2. Copy current-source safe reports into `docs/evidence/<descriptive-run-id>.json`; also link the exact public repository CI run when relevant. A URL alone is not machine-checked proof. Do not check in `.runtime` files or raw Playwright traces.
3. Update the corresponding ledger row: status, executed test families/evidence, exact `missing` checks, findings/blockers, and the next ordered steps. Historical evidence remains identified as historical; it must not certify changed code.
4. The maintainer reviews required tests and contract decisions, then records `status: "signed-off"`, `reviewer: "burggraf"`, `reviewedAt`, `reviewedSourceSha256` from the reviewed current report, and no missing criteria. Gate approval must also update user-facing limitations. An automated agent must not invent this approval.
5. Run `npm run check` and `npm run progress`, commit the code/tests/ledger together, and report actual checks, open gaps and the next action. No "done" badge or supported API claim without the feature's own full matrix evidence.

Feature signoff also requires all seven research decisions to have maintainer approval. A fresh replacement report cannot carry an old review onto changed sources: the approval's source hash must still match, otherwise the maintainer must review again. The validator checks structure, references and freshness. It does **not** authenticate a reviewer or decide whether a scope exception is acceptable; attributable maintainer review is still required. CI branch protection must be configured/verified separately rather than assumed.

## Next development boundary

Finish missing Phase A characterization (especially stream authorization/expiry/loss and native auth hydration/refresh/logout races), review G1–G7 with the maintainer, and obtain Phase A signoff. Then begin Phase B's smallest tested client/types/mapping/results slice. No Level 2/3 implementation is authorized.
