# Run12 — approved private remote todos testing

## Approval and boundaries

User approved foreground Tailscale Serve HTTPS18443 to this run's loopback app and HTTPS18444 to its disposable loopback inbox on aspire. Leave them running for Mac/iPhone testing. Existing443/services, backend/admin/database loopback bindings, native/client/image pins, access rules, ACL/firewall/account settings and credentials remain unchanged. No Funnel/public binds/commit/push. Stop for additional enablement or privileges beyond approved Serve. A pre-existing valid cached certificate was available and reused.

## Small implementation

- `--tailnet` is an explicit fixture-only flag: canonical `server.site_url` accepts exactly `https://aspire.tailb03e.ts.net:18443`. No arbitrary origin/host/port or hosted backend is accepted; default config remains byte-identical before generated token replacement.
- Only packed SDK browser fixtures get a fixed same-origin HTML refresh/link from `/` to `/sdk-data/index.html`; URL auth is not adopted. Browser APIs still use `location.origin`, with no CORS relaxation.
- Native app/mail and every reference/admin/database service remain loopback. Two separately tracked foreground Serve processes terminate HTTPS on tailnet interfaces only. HTTPS supplies the secure context required by browser `crypto.randomUUID()`.

## Feature/test layers and measurable evidence

Existing L1-14–20/L1-24/L1-26/L1-27 and E01/E07/E08/E10/E11: test-first unit guards (bad origin/bind/options/runtime, unchanged default, exact one site replacement, fixed landing); actual pinned22/24 units/static/clean-package; real HTTPS ownership/assets/health/unauthenticated deny; real browser signup, pending-login denial, genuine email via private inbox and origin-checked confirmation redirects, explicit SDK login, persistence/manual refresh, two-owner CRUD and denied foreign update/delete/spoof/transfer with complete unchanged rows, scoped row/session/context cleanup. Chromium/Firefox and mobile/touch-configured WebKit, no retries, no success-response stubs, no injected sessions/admin browser credentials.

All test assertions must pass and all changed-source reports match. Native DB row/session postconditions are tested through ordinary authorized SDK operations, not inferred from HTTP status alone. Exact six original container pins/digests and loopback bindings, approved foreground proxy inventory, no Funnel/persistent Serve and unchanged cached certificate dates are independently checked. No claim of full database/security/property/coverage/reference/release signoff or physical Mac/iPhone proof.

## Execution priority and remaining layers

User explicitly prioritized live basic readiness before broad historical reruns. Focused guards/static passed before startup; nine HTTPS readiness checks passed before sharing URLs. Broader real remote auth/CRUD three-engine tests and pinned unit/package checks followed without interrupting user access. Do not start another fixture suite while this app owns the lock. Default all-local browser/reference/auth/short-TTL/database/constraints/teardown suites were not rerun on this source; prior-source evidence remains historical, not current certification. Complete those in an agreed downtime after user testing, not by killing/bypassing this live run. Full accessibility/fault/SMTP/cross-tab/coverage/actual CI/release gates and G1/G7 remain unresolved; no layer waived/N/A/signoff inferred.

## Live handoff / cleanup

Authoritative IDs, endpoints, source-bound reports and exact stop commands are in `docs/progress.json` lastSession/activeExampleMilestone and `docs/evidence/todos-remote-summary.json`. Stop only the two recorded foreground Serve processes, then send `quit` to the owned launcher (or SIGTERM its verified Node runner) and wait for guarded cleanup. Never `serve reset`, prune Docker or remove a live fixture lock. Disposable accounts and confirmation messages remain until shutdown; test-created rows and refresh sessions are cleaned individually. Keep raw diagnostics private.
