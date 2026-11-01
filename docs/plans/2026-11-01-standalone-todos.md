# Standalone local auth todos milestone

Approved: reuse the existing client-only todos UI with the compatibility SDK and an isolated, pinned loopback TrailBase server. No deployment, new ongoing credentials, dependency/policy changes, backend patch or G1/G7 exception.

## Contract and affected flow

- `npm run example:todos` owns one generated fixture, installs/packs the SDK with existing tooling, prints the browser entrypoint and local SMTP inbox, waits for Ctrl-C/quit, then deletes only its owned ephemeral resources. Existing Docker-backed harness/mail infrastructure is reused; no new server/gateway implementation. All published sockets remain loopback. `--check` exercises the same launcher and exits after real readiness/asset checks.
- `/sdk-data/index.html` boots the existing auth todos itself using the same-origin SDK client, explicit public todo mapping and owned persistent storage key. No tokens/admin configuration/server context in HTML or bootstrap. Historical manual-mount tests use a clearly separate private mount shell, not a duplicate application.
- Browser signup, login, validated user, persistence/reload, manual/default refresh, local/global logout and CRUD use the compatibility SDK. Confirmation is a real mail-recipient link, handled outside the app's SDK session; no automatic URL-session adoption or fake confirmation. UI explains G1 and global-ack uncertainty, exposes loading/errors and row edit/delete controls.
- Two fresh users sign up and log in through the real entrypoint in isolated browser contexts. No fixture-obtained sessions injected into storage. Server/test mail helpers may follow genuine confirmation links, never admin-confirm identities.

## Required checks before claiming this bounded milestone verified

| Layer / feature IDs | Checks |
| --- | --- |
| Unit / L1-01, L1-26, L1-27 / S07,S10 | Launcher rejects host/target/unknown options and unpinned Node; entrypoint/import graph/no privileged bootstrap; existing validation/session/property/type corpus |
| Real launcher / L1-27 / E01,E13,S10 | Execute documented launcher `--check`; real native/mail readiness, same entry assets, exact image pins and loopback; owned shutdown/lock/resource checks; startup failure cleanup retained |
| Packed shared contract / L1-05–20 / E02–08,E13 | Retain existing same-app TrailBase/official Supabase flows and negative assertions in all three engines; new bootstrap must not introduce a second client into historical manual mounts |
| Real two-user app / L1-05–20,L1-24 / E01–04,E07,E08,E10,E11,E13,E14 / S03,S04,S06–08 | Both users SDK signup/mail/login; unverified/wrong login denial; exact own rows and foreign non-disclosure; foreign update/delete, spoof/reassignment rejected with unchanged complete A/B rows; reload/manual refresh; offline read error/recovery; loading barrier over a real request; row selection edit/delete; local logout does not disturb B; global uncertainty remains honest; clean ordinary sessions/rows/contexts |
| Backend integration / L1-03–20,L1-27 | Fresh focused auth, short-TTL refresh, data/reference, database, constraints and injected cleanup scopes on immutable source after shared asset/harness changes |
| Build/package/docs / L1-02,L1-26 | Pinned Node22/24 static/build/unit/clean consumer checks, source-bound whitelisted reports, documented executable commands, no raw mail/token/trace uploads |

No layer is waived. Full release coverage thresholds, broad hostile-network/storage/SMTP/cross-tab/resource/accessibility corpus, three clean candidate runs, actual new-source CI and maintainer signoff remain distinct requirements; focused app proof cannot satisfy them by renaming commands. Realtime/migration remain deferred. Preserve all prior failed/interrupted reports and identify checks not run. Keep G1 duplicate-pending/SMTP/null-user and G7 authenticated global acknowledgement limitations visible.
