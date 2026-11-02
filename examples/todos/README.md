# Run the local todos app

A client-only application using this repository's compatibility SDK for every browser auth/data operation. It boots itself, not a test mount. It runs against a **new isolated, pinned TrailBase server**, with disposable local mail and unchanged owner access rules. This is development evidence, not a production deployment or full Supabase-compatibility claim.

## Prerequisites and launch

Run from the repository root on Linux/macOS with a local Unix-socket Docker daemon, `git`, `curl`, `tar`, `unzip`, npm and pinned Node **22.23.2 or 24.21.0**. The existing harness provisions six pinned local Supabase services for its mail/reference infrastructure; **the app uses TrailBase only**, and receives no Supabase/admin key. Initial downloads need network access. No hosted project, SMTP account or external credentials are required.

```sh
npm ci
npm run tools:install
# Prime exact existing runtime metadata for the clean offline packed consumer.
for spec in trailbase@0.14.3 @types/geojson@7946.0.16 @ungap/raw-json@0.4.4 geojson@0.5.0 jwt-decode@4.0.0 uuid@14.0.2; do
  npm cache add "$spec"
done
npm run example:todos
```

If your shell uses another Node version, invoke the commands under a pinned runtime, for example `npm exec --yes --package=node@22.23.2 -- npm run example:todos` (and similarly for install/build commands). The launcher rejects unsupported runtime versions and all target/host/port options instead of accepting a live backend. The separately approved `--tailnet` mode below changes only this disposable fixture's canonical email origin, never its listener bindings.

The terminal prints:

- **Owned run**: the generated recovery ID (not a credential).
- **App**: a dynamic `http://127.0.0.1:<port>/sdk-data/index.html` URL; open it in your normal browser on the same machine.
- **Local test inbox**: a separate loopback web inbox for real confirmation mail. It is local operator/test tooling, not part of the app or an authenticated public mail service. Anyone with access to this local inbox can read its disposable messages.

All app/admin/mail/reference listeners stay on loopback. Do not expose them except for the explicitly approved private app/inbox Serve setup below; never publish admin/database/reference ports or use Funnel. Ports are intentionally generated; the app cannot be pointed at an existing database. The launcher holds the existing fixture lock: don't run other real-service suites concurrently. It copies/builds a clean installed SDK tarball and application assets once at startup, with no hot reload; stop and restart after code changes.

## Approved private tailnet testing on aspire

Mark approved only app HTTPS **18443** and disposable inbox HTTPS **18444** through existing Tailscale access rules; no public bind, Funnel, ACL/firewall/account changes or modification of existing 443/services. Anyone permitted to access the inbox can read its test messages: use disposable addresses/passwords/data only. Mac/iPhone must already be connected and allowed by existing tailnet policy.

```sh
npm run example:todos -- --tailnet
# In separately tracked foreground processes, substitute this run's printed loopback ports:
tailscale serve --https=18443 http://127.0.0.1:<APP_PORT>
tailscale serve --https=18444 http://127.0.0.1:<MAIL_PORT>
```

Stop if Serve requires additional HTTPS enablement, certificate/account settings, new credentials or expanded privileges beyond the approved Serve operation. Do not reset existing Serve configurations or enable Funnel. `--tailnet` does not activate networking: it permits only `https://aspire.tailb03e.ts.net:18443` as this generated fixture's `site_url`, so actual confirmation links work from remote devices. Default launch behavior/config remains loopback-only.

- App: **https://aspire.tailb03e.ts.net:18443/** (HTML refresh to `/sdk-data/index.html`; direct path also works).
- Inbox: **https://aspire.tailb03e.ts.net:18444/**.
- Browser SDK uses `location.origin` for both app and API, with no CORS relaxation or hard-coded loopback API. Valid HTTPS supplies the secure context needed by `crypto.randomUUID()`; plain tailnet HTTP is not sufficient.
- Stop the two owned foreground Serve processes first (Ctrl-C in their terminals), then `quit`/Ctrl-C the owned launcher. No `serve reset`, shared service shutdown or Docker prune. Stopping this disposable server removes all its accounts/data.
- Focused real remote verification: set `PHASE_A_CONTEXT` to this owned run's private `context.json` and run `node node_modules/@playwright/test/cli.js test --config=playwright.todos-remote.config.ts`. It accepts only the approved origin/owned fixture, reads real disposable email through the private inbox, obtains both browser sessions via SDK signup/login and checks exact owner rows/denied writes. Reports/traces remain private; publish only sanitized outcomes. WebKit mobile viewport is not proof on physical iPhone hardware.

## Use it

1. Choose a fresh disposable address such as `alice@example.test` and a unique disposable password of at least 12 characters. Choose **Create an account**, then submit **Create account** once. The UI prompts for confirmation; no identity/session is fabricated from signup.
2. Open the printed local inbox, find your message and follow the actual verification link. A separate verification page is expected. Return to the App tab and explicitly **Sign in**. Unconfirmed/wrong credentials produce an error, not a session; no callback token/session is adopted from the URL.
3. The signed-in view has a prominent **Add task** form (Enter works), completion checkboxes, inline **Edit** / **Save** / **Cancel**, and **Delete** with a separate confirmation dialog. Deletion is permanent; no unreliable undo/recreated record is offered.
4. **All / Active / Completed** filter on the server. Tasks use bounded pages of 20 and supported `select('*')` reads, ordering and ranges. Counts are omitted because the narrow SDK does not support count/projection queries. No entire-table download/filter loop or SDK/query extension. Reload restores the owned persisted session. **Account settings → Check sign-in / Refresh session** use the existing auth methods; default background renewal stays enabled. Use **Refresh tasks** after connectivity returns. Unconfirmed writes are not replayed: refresh/reconcile before retrying.
5. Header **Sign out** clears this app's stored session and requests revocation of that exact refresh session; a failed acknowledgement remains an error. **Account settings → Sign out everywhere** attempts native global revocation but shows explicit uncertainty (G7); never local-success fiction.
6. For a second user, open a separate browser profile/private context and repeat signup/confirmation/login with a different address. Each user sees only their own rows. Regular same-origin tabs share localStorage, but live cross-tab session synchronization is **not supported**; do not use them as independent-user contexts.

**Login troubleshooting:** HTTP401 alone cannot distinguish an unknown account, an unconfirmed account or a password mismatch; the UI gives the same guidance for all three and does not display raw backend errors/URLs. Check the test inbox and confirm the matching signup email, then explicitly sign in to this instance. Do not repeatedly register a pending address or share passwords/tokens. If access is already working, no reset or new account is needed. Global logout still reports explicit uncertainty, not success.

Browser code contains only the same-origin URL and public table mapping. Native sessions are persisted by the SDK under its owned `trailbase-todos-example-v1` key; no service/admin credential, fixture context or prefilled user session is shipped. The local inbox and setup database privileges stay in explicit fixture tooling. Protect your local browser/profile like any token-bearing development client.

## Stop and recover

Press **Ctrl-C**, or type **quit** and Enter in the launcher terminal. Cleanup stops only this generated run, removes its containers/network/volumes/native depot and stale session data on the server, and releases its owned lock. **All app accounts and todos in this disposable server are deleted.** Private diagnostics stay under `.runtime/runs/<owned-run-id>/`; never upload raw mail, browser traces or auth logs.

After a hard kill, first confirm the recorded runner is dead, then use the guarded existing command with the exact ID printed by your launcher:

```sh
npm run fixtures:cleanup -- <owned-run-id>
```

Do not remove the lock manually, target a linked project, or prune Docker. A running runner, wrong ownership or non-local Docker target must be inspected rather than bypassed. Cleanup failure is failure, not permission to start overlapping fixtures.

## Automated checks

```sh
npm run test:example:todos   # same real launcher, --check readiness and owned shutdown
npx playwright install --with-deps chromium firefox webkit
npm run test:sdk:browser    # real packed app, both SDK factories, all three engines
```

The browser scope includes the self-booting entrypoint with **two users who both sign up and log in through the SDK**, not injected fixture sessions. The primary UI is a responsive task app; the old query/auth characterization controls remain available only through explicit `diagnostics: true` in the existing private test mount, never in the default user flow. It checks complete owner-row postconditions after denied cross-owner update/delete/spoof/reassignment, safe generic missing/unconfirmed/wrong-password401 messages, real confirmation, reload/refresh, offline error/recovery, add/edit/complete/server-filter/pagination/delete-confirmation and logout. Desktop and mobile-configured WebKit screenshots use only disposable test accounts/tasks. Server/test code reads real confirmation mail; it does not admin-confirm identities. Existing manual-mount tests use a private mount shell, so they cannot accidentally boot an extra client/listeners. Sanitized source-bound reports go to `artifacts/todos/` and `artifacts/phase-a/`; exact results/missing checks are in [the progress ledger](../../docs/progress.json).

## Selected official-only limitations — no parity or release signoff

Mark selected official TrailBase0.35.8/JS0.14.3 and continued MVP work with these documented limitations. Private native/SDK prototypes are historical private evidence, not this app's backend, capability or recovery path. See the [official auth contract](../../docs/OFFICIAL_AUTH_CONTRACT.md). No change to the original already-running demo/assets/data/six containers/tailnet is authorized by these repository edits.

- **G1 technical differences remain:** signup returns null user/session, not Supabase's user object. Official0.35.8 pending uniqueness rejects repeat pending registration with409; the app displays a rejection, not successful delivery or an account-existence verdict. SMTP424 can leave a pending identity, so retries can return409 even after SMTP recovers. Keep any earlier genuine confirmation mail; do not repeatedly register. There is no supported confirmation-resend, account repair, password recovery, OAuth or admin UI. A native trigger200 is not a delivery guarantee. The old0.34.3 duplicate-row defect and closed upstream#298 are not proof of current recovery.
- **G7 remains open:** authenticated global-revocation acknowledgement is unavailable. A global attempt clears local state and reports uncertainty even if the server already revoked sessions. Existing issued JWTs may retain their residual lifetime; local cleanup is not instant server-wide access-token invalidation.
- Loopback HTTP, the all-local test inbox, disposable resources and this fixture schema are **not production security/deployment guidance**. No public hosting, ongoing credentials, migration, Storage or Realtime is added.
- Focused app/launcher checks do not establish full fault/resource/accessibility/coverage/CI/release gates or maintainer signoff. Check current evidence; authored tests and historical passes are not current-source certification.
