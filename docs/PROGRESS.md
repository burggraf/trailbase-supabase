# Development progress and restart guide

**Current phase: A — proof harness; G1 contract completion is blocked. No SDK feature is signed off.**

Stock TrailBase v0.34.3 fails real confirmation after duplicate unconfirmed registrations. SMTP retry/recovery exercises the same pending-row problem. See [the pinned-source diagnosis](RESEARCH.md#blocking-g1-regression-duplicate-pending-registrations). The regressions remain strict/red; no auth-schema workaround or maintainer approval has been assumed.

The [earlier stock blocker run](evidence/phase-a-g1-blocker-node22.json) has **17 passing and 2 failing upstream cases**; both failures are native confirmation HTTP 400. **22 unit guards passed**, and cleanup passed with no owned Docker resources remaining. The browser stage did not run because upstream assertions failed. SMTP/reference recovery and the fresh native mail control ran before the failing retry-confirmation assertion. These partial results do not make G1 or the full suite green.

## Auth-migration investigation handoff

The maintainer authorized investigation, not deployment. [Candidate prerequisites and limits](AUTH_MIGRATION_INVESTIGATION.md) explain the opt-in SQL, preflight refusal and unchanged native security boundaries. Auth-investigation macOS/Node 22 evidence (historical after subsequent scalar-probe additions):

- [26 unit guards](evidence/phase-a-unit-node22.json), including SQL collision/confirmation/preflight/rollback checks: passed.
- [Candidate characterization](evidence/phase-a-auth-candidate-characterization.json): 10 passed.
- [Candidate three-browser infrastructure](evidence/phase-a-auth-candidate-browser.json): 6 passed.
- [Stock characterization control](evidence/phase-a-auth-stock-characterization.json): 9 passed, 1 failed (native duplicate confirmation).
- [Candidate SMTP recovery](evidence/phase-a-auth-candidate-smtp.json): failed (no pending-account verification mail despite healthy control and reference recovery).
- Cleanup passed for every run; candidate remote CI has not run. There is no complete green candidate suite or G1 signoff.

The [sanitized upstream report](UPSTREAM_AUTH_ISSUE.md) was submitted with maintainer approval as [trailbaseio/trailbase#298](https://github.com/trailbaseio/trailbase/issues/298). Next: upstream response/test feedback, safe native recovery capability, and other isolated Phase A gates. The candidate remains opt-in and investigational; stock defaults are unchanged.

## G2/G4 scalar-domain follow-up

`npm run test:phase-a -- domains` runs the isolated stock scalar probes. [Four local real cases](evidence/phase-a-scalar-domains-node22.json) passed: all six numeric comparisons with exact golden IDs; reserved/Unicode/combining text as literal values; null inequality plus declared boolean/UUID filters; and numeric ties with explicit keys plus lowercase ASCII words ascending/descending. The latest 26-case unit report also passed; cleanup passed.

This is a bounded installed-client characterization, not an SDK contract or broad text-collation guarantee. The later boundary follow-up below covers unsafe decoding, nullable defaults and builder isolation. Adapter option validation, broad collation guarantees and remote CI remain incomplete. G1 blockers and all maintainer signoff requirements are unchanged.

## G2/G4 boundary follow-up

`npm run test:phase-a -- boundaries` runs the isolated stock boundary probes. [Five real cases](evidence/phase-a-query-boundaries-node22.json) and the latest 26-case unit report passed locally on Node 22; cleanup passed. Exact observations:

- `9007199254740991` round-trips as a safe number. Native installed-client decoding preserves `9007199254740993` as bigint; the reference installed client returns `9007199254740992` even though real PostgREST wire data contains the exact original integer. This does not widen the planned portable safe-integer domain.
- On nullable text, equality with JS `null` selects the literal string `"null"`, not SQL NULL. The future adapter must reject null comparison as planned; `.is()` remains deferred.
- Numeric NaN/infinities/fractions, an unknown column and a malformed UUID fail in both pinned backends; fixture row counts remain unchanged. This is backend rejection evidence, not proof of a future adapter rejecting before requests.
- Native nullable ascending order places NULL first; reference default ascending places it last. Explicit reference `nullsFirst:true` aligns this fixture, but nullable ordering remains outside the initial portable contract. Native mixed-case/Unicode order matches binary UTF-8; the reference fixture produces reversible ascending/descending results. No broad cross-database collation claim is made. Composed/decomposed accents remain distinct literal predicates.
- Reference query construction is lazy; repeated awaits issue separate real requests. Independently constructed builders isolate, but branching the same builder mutates it. Native `listOp` is lazy, repeated `.query()` calls issue requests, independent options isolate, and mutation of shared options affects a previously constructed operation.

G2/G4 remain in progress pending named contract approval, remaining matrices and eventual adapter/browser/security/type checks. Query page-bound arithmetic, unsupported date/BLOB/JSON/relation shapes and nullable/reference option rejection remain incomplete. No SDK implementation/signoff or G1 resolution is implied.

## G5/G6 streaming follow-up — strict isolation blocker

`npm run test:phase-a -- streaming` now includes the expanded parser and two-owner cases. [Stock Node 22 evidence](evidence/phase-a-stream-isolation-node22.json): **3 passed, 1 failed**; latest 26 unit cases passed and owned fixture cleanup passed. It is not a green streaming/security suite.

- Native real UTF-8 INSERT/UPDATE/DELETE and two-owner isolation passed. Foreign INSERT/UPDATE/DELETE followed by own-event barriers did not appear in the owner reader; foreign direct read was denied. Both owners' final tables were empty. Reader cancellation completed; this does not prove every server-side stream resource/expiry condition.
- Whole-frame replay preserved a captured Unicode payload; byte-fragmented replay still failed/lost events. Synthetic sequence metadata over captured real payloads produced one loss callback for a gap inside one transport chunk but **zero** for the same gap split into whole-frame chunks. The installed parser resets sequence tracking per transform invocation. Explicit synthetic loss status produced a callback. These are deterministic installed-parser observations, not actual network fragmentation/loss/expiry proof or a working fallback.
- Reference basic own-row events and channel cleanup passed. In the strict two-owner test, INSERT/UPDATE own-event barriers and direct RLS invisibility passed, but the next DELETE event carried the **foreign owner's primary key**. Both owners' tables were empty and channel cleanup completed. The strict failure remains, including no leaked-row acceptance or event-discard workaround.

G6 is blocked on an explicit payload/security compatibility decision. This is the pinned reference backend's DELETE limitation, **not a demonstrated native TrailBase owner-isolation failure**; never weaken native access rules to mimic it. No broad security/CVE claim is made. G5 still requires a reviewed transport fallback and real network/browser corpus. G6/G7 still require expiration, revocation, renewal, anonymous, browser/storage/timer/race and resource evidence; the later G7 subset below adds local owned-storage and response-race observations. Maintainer signoff remains absent.

## G7 lifecycle follow-up — late-response/logout blockers

`npm run test:phase-a -- auth-lifecycle` adds real-response-gated lifecycle probes. [Stock Node 22 evidence](evidence/phase-a-auth-lifecycle-node22.json): **8 passed, 2 strict failures**. The shared async deadline has a runnable unit check; latest unit total is **27 passed**. [Re-run stream controls](evidence/phase-a-stream-isolation-node22.json) remain 3 passed/1 reference DELETE failure. Cleanup passed for both scopes.

- Native hydration initially exposes cached JWT claims; real revoked-session status validation subsequently clears cached user/tokens. Protected anonymous access is denied with HTTP 403. The [initial run](evidence/phase-a-auth-lifecycle-initial-status-mismatch.json) had two extra harness failures assuming HTTP 401 for that protected endpoint; status assertions were corrected to the observed HTTP 403 without weakening local-state or access-denial requirements.
- Two simultaneous native forced refreshes generate **two** real requests. Reference concurrent refresh is single-flight in this tested fixture, preserving a usable real session.
- **Native late refresh and status-validation responses restore cached user/tokens after logout.** Each test holds a complete genuine successful response, logs out while it is in flight, proves the refresh session was revoked on the actual server, then releases the response. The no-local-session assertion fails. No token/session/response was fabricated. These are installed-client state races, not demonstrated server-side refresh-revocation failures or privilege escalation.
- Reference late refresh after logout is discarded with `AuthRefreshDiscardedError`; no later `TOKEN_REFRESHED` event appears and protected access remains denied.
- Injected client-transport logout faults clear local state on both clients while the undelivered remote revocation leaves refresh usable. Native logout still returns `true`; reference logout exposes an error. These controlled transport faults are not proof of a real backend/network outage.
- Reference owned persistent storage hydrates a genuine session, validates it with real `getUser`, and reflects shared-store logout. An injected storage-write failure is observable, installs no local session, leaves protected access denied, and recovers with real login. No browser/cross-tab/automatic-timer parity or native storage implementation is claimed.

G7 is blocked on the two strict native state-race regressions and a reviewed upstream/future-wrapper mitigation path. No production guard or SDK implementation was added. G1/G6 blockers remain intact.

## Authorized isolated proofs — not production work

The maintainer's completed interview `ab54f7fd-4ad9-4a45-8b63-afe09a7ff19d` selected buffered Fetch/SSE and epoch/single-flight proofs, stronger native owner-only DELETE behavior as a **proposed** deviation, and keeping both client reports as drafts. [Scope/limits](PROOF_INVESTIGATIONS.md) are part of the evidence source hash. No SDK implementation, deployment or gate signoff was approved.

Current-source local Node 22 results:

- [35 unit checks](evidence/phase-a-unit-node22.json), including eight parser/property/malformed/cancellation cases: passed.
- [Eight genuine native proof cases](evidence/phase-a-coordination-proofs-node22.json): passed. The decoder preserved real UTF-8 INSERT/UPDATE/DELETE under deterministic post-HTTP byte rechunking and aborted a pending read. The auth proof single-flighted refresh, discarded late refresh/status responses held at both response and JSON completion, preserved a newer account's flight when an old one settled, and exposed undelivered logout while clearing locally.
- [Six three-browser infrastructure controls](evidence/phase-a-proof-browser-controls-node22.json) and [injected failure cleanup](evidence/phase-a-proof-cleanup-node22.json): passed. Those earlier browser controls did **not** execute the proof modules; the later browser follow-up below does.
- [Full stock suite](evidence/phase-a-proof-full-stock-node22.json): **43 passed, 5 failed**, all required G1/G6/G7 regressions still strict; browser stage not reached in the full run. Cleanup passed for every scope.
- [First proof run](evidence/phase-a-proofs-initial-cleanup-header-mismatch.json): 6 passed/1 failed because fixture cleanup reused a different session's headers. It was corrected to the original proof session's captured genuine headers; assertions were not relaxed. An account-switch case was then added, giving eight final real cases.

The proof is test-only and does not patch `initClient` or create Supabase sessions. Unsafe event integers are rejected under an explicit buffer/framing limit; automatic storage/timers/reconnection and full network/browser/security/schema handling remain incomplete. G1/G6/G7 remain blocked on the raw baseline and required decisions; G5 remains in progress. The following explicit expiry follow-up adds a native baseline blocker. Network/browser/resource checks still require completion.

## Actual native expiry — protected stream delivery persists

`npm run test:phase-a -- expiry` uses a fresh owned **short-native-auth** profile with a 3-second native JWT TTL. The [strict expiry report](evidence/phase-a-native-expiry-node22.json) failed: initial raw protected HTTP worked, genuine wall-clock expiry (including actual server grace) later denied the original JWT, but its previously opened stream delivered a newly written protected row from a freshly refreshed writer. The requirement to close/signal denial rather than deliver data remains strict. This is not simulated expiry, JWT editing, reference expiry parity or a severity/CVE claim.

Default-profile controls under the same source passed: [8 proof cases](evidence/phase-a-expiry-default-proof-controls-node22.json), [6 browser infrastructure cases](evidence/phase-a-expiry-default-browser-controls-node22.json), [injected-failure cleanup](evidence/phase-a-expiry-default-cleanup-node22.json), and latest 36 unit checks. All owned cleanup passed. Reports/context/owner records label the native auth profile; default and candidate lifetimes are unchanged. The expiry corpus is outside the default `all` directory and has its own required CI step, as described in [proof investigation scope](PROOF_INVESTIGATIONS.md).

G6 remains blocked on **both** native established-stream expiry semantics and reference foreign DELETE-key exposure. Owner-only native behavior is the chosen investigation direction, not a claim that native streams already enforce expiry. G5/G7 test-only proofs do not repair upstream behavior. No new upstream issue was submitted; both existing installed-client reports remain drafts. The following browser follow-up executes the proof modules and adds setup diagnostics. Network/resource checks remain incomplete.

## Actual proof execution in all three browsers

[Current-source browser evidence](evidence/phase-a-browser-proof-node22.json): **9 passed**—the six existing real confirmation/login infrastructure cases plus genuine native UTF-8 stream/write/delete/abort and guarded late-refresh/logout proof execution in Chromium, Firefox and WebKit. Only the two test-only proof modules are compiled/served from the owned fixture; no public SDK/package build is introduced. Browser results return boolean postconditions, never tokens or auth bodies.

[36 unit cases](evidence/phase-a-unit-node22.json), [8 native proof controls](evidence/phase-a-browser-default-proof-controls-node22.json) and [injected-failure cleanup](evidence/phase-a-browser-proof-cleanup-node22.json) passed. The [full default stock corpus](evidence/phase-a-browser-proof-full-stock-node22.json) remains **43 passed/5 failed**; its browser stage was not reached, and the standalone browser scope above does not make the full suite green. All owned cleanup passed. The explicit real-expiry regression remains separately required and failing.

The [first browser proof build](evidence/phase-a-browser-proof-initial-compile-failure.json) failed before tests because pinned TypeScript 7 requires `--ignoreConfig` when explicit file paths are compiled. The compiler invocation was corrected, with private compiler diagnostics retained; no runtime assertions were relaxed. Reports now expose only a constant-valued setup checkpoint. All successful latest scopes reached `ready`; this helps distinguish setup failures from backend test failures without publishing raw diagnostics.

Historical [Linux run 37092902157](https://github.com/burggraf/trailbase-supabase/actions/runs/37092902157) at `69ce78c` passed 35 unit cases on each supported Node runtime and [reproduced the 43/5 full stock result](evidence/phase-a-ci-linux-proof-stock.json), with cleanup passed. It predates the explicit expiry/profile/browser expansion and is not current-source signoff. Both installed-client issue drafts remain unsubmitted as requested; #298 is the only submitted report.

## Historical Linux CI confirmation

[Run 37089983540](https://github.com/burggraf/trailbase-supabase/actions/runs/37089983540) at `de7cc54` predates G7: [Node 22 unit](evidence/phase-a-ci-linux-unit22-stream-blockers.json) and [Node 24 unit](evidence/phase-a-ci-linux-unit24-stream-blockers.json) each passed 26 cases. The [real backend report](evidence/phase-a-ci-linux-stream-blockers.json) has 27 passed/3 failed (both stock G1 regressions and reference G6 DELETE isolation), with cleanup passed; browser stage was not reached. It does not certify the expanded current source. Upstream [#298](https://github.com/trailbaseio/trailbase/issues/298) remains open with no maintainer response as of this handoff. A later [5ae1632 Linux run](https://github.com/burggraf/trailbase-supabase/actions/runs/37091459295) passed both 27-case unit jobs but [failed backend setup before any real tests](evidence/phase-a-ci-linux-auth-races.json); cleanup passed. Do not count this setup failure as auth verification or attribute it to a demonstrated auth assertion.

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
