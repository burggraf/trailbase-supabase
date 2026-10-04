# Investigational native auth email reservation

**Maintainer authorized investigation, not deployment or G1 signoff.** Stock TrailBase v0.34.3 remains the baseline. This is an explicit native deployment requirement candidate, not a transparent SDK fix, server fork, or migration CLI.

## Candidate and prerequisites

[Candidate SQL](../tests/fixtures/auth-mitigation/U1790991000__reserve_auth_email.sql) targets the exact v0.34.3 SQLite `_user` schema:

- Preflight refuses case-insensitive addresses held by different identities across `email` and `unverified_email`.
- A unique pending-email index plus INSERT/UPDATE cross-column guards reserve both verified and pending addresses.
- Same-owner confirmation is allowed; null-address anonymous identities are unaffected.
- It never deletes, merges, changes passwords, or chooses an owner to resolve conflicting existing rows.

Do **not** apply it to a live depot based on this investigation. A deployment decision needs schema/version validation, a private verified backup, quiesced auth writes, a transactional migration rehearsal, explicit conflict-resolution ownership, and a rollback/upgrade plan. Existing ambiguous identities cause failure, not silent data repair. SQLite NOCASE is the native ASCII case-folding domain, not a promise of universal Unicode/IDNA normalization.

## Separate proof paths

```sh
# Stock regression remains red until the native requirement is resolved.
npm run test:phase-a -- characterization

# Opt-in candidate is copied ONLY into a newly owned disposable depot.
npm run test:phase-a -- characterization --auth-mitigation
npm run test:phase-a -- smtp --auth-mitigation
npm run test:phase-a -- all --auth-mitigation
```

Reports/context record `authVariant: stock` or `candidate-email-reservation`. Never cite a candidate result as stock-server behavior. Default fixtures do not contain the candidate migration. Both paths use the pinned server and installed SDK, real SMTP and ordinary-user APIs; no admin-confirmation bypass.

SQL unit checks cover pending/verified/cross-column collisions, case folding, unchanged denied writes, confirmation, anonymous nulls, ambiguous preflight and rollback. Real native migrations/auth/permission/browser/cleanup checks remain separately required; SQLite policy unit checks cannot certify native behavior.

### Existing-depot preflight rollback scope

`npm run test:phase-a -- auth-migration` uses an isolated stock/default owned depot and genuine duplicate pending registrations. A confirmed ordinary-user control retains its protected row. The native `trail schema todos --mode select` command exercises native migration initialization against that existing depot: first without the candidate, then with the opt-in candidate staged, then after removing only that never-applied candidate. Required postconditions: the intended preflight CHECK fails, every `_user` row (including credentials), schema entry and migration-history row is unchanged, no candidate index/trigger remains, pending login stays denied, and the control's row remains readable. Raw CLI diagnostics stay private; teardown still verifies owned resource cleanup.

This is a native initializer/preflight rollback rehearsal, not a stopped-server restart, backup restore, concurrent-auth safety, SMTP recovery fix, deployment approval or G1 signoff. Browser/reference compatibility is not claimed by this backend-only probe; their full required layers remain pending.

## Initial investigation result (not signoff)

The opt-in SQL migration applied through the real pinned native migration runner and passed the 10-case characterization subset, including duplicate unconfirmed registration, original-password preservation and real email confirmation. SQL policy checks passed too. These are candidate-only observations; source-linked reports and rerun status are tracked in the ledger.

The real candidate SMTP-outage probe still fails: after restored SMTP, a healthy fresh control confirms and Supabase retry recovers, but the failed native account receives no verification mail. [The resend handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/verify_email.rs) calls [a lookup restricted to verified `email`](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/util.rs), so it cannot find a pending `unverified_email` identity. It returns an opaque success. The SQL uniqueness constraint correctly blocks another account insertion; it does not repair this missing delivery path. **G1 remains blocked; the candidate is not deployment-ready.**

## Authorized private native-source prototype

Following the timeout of interview `6f74221d-1b37-456b-af5d-261ea4372430`, the maintainer instructed continuation using the recommended bounded choices: an isolated upstream source patch and private disposable-backend tests. This authorizes neither deployment nor public submission, baseline repinning, identity repair, a maintained server fork or Phase B. The pinned stock and SQL-candidate paths above remain unchanged and strict.

The isolated checkout starts at the pinned v0.34.3 commit. Its intended seam is transactional address reservation/refusal, opaque duplicate signup preserving the original ID/password, a dedicated unique-pending resend lookup, and confirmation bound to the signed identity and address. Shared verified-email lookup semantics for login/reset/OTP must not widen. Legacy ambiguity must abort unchanged, never choose/delete/merge/reassign an identity. Any native prototype results must be labeled separately from stock and the reservation-only SQL candidate.

The existing public-resend throttle is deliberately unchanged. Pinned-source review identifies a four-hour throttle even after failed resend delivery; a first public resend after signup failure is not evidence of immediate recovery after a failed resend. Changing that TTL is a separate policy decision, not implied by this prototype approval.

The three-file private draft passed **23 native test executions / 22 distinct tests** under upstream-pinned Rust 1.98.1: three new pending-recovery regressions, 17 original auth controls, and two original migration controls. The migration rollback regression ran under two filters; an independent parent rerun reproduced all 23 passes. See [sanitized native-test evidence](evidence/phase-a-private-g1-native-tests.json).

A no-default-feature dev CLI binary was built from that exact patch and then used only in the owned disposable loopback fixture; [build evidence](evidence/phase-a-private-g1-build.json) preserves the failed offline-cache attempt and successful locked online build. `node scripts/run-phase-a.mjs private-g1-prototype` passed **2 real HTTP cases** with strict six-image digest and loopback setup checks and owned cleanup. The outage case stopped the actual SMTP/mail container, observed registration HTTP 424/no session and explicit protected-read 401/403 authorization denial, preserved the pending ID/hash through a different-password duplicate signup, invoked public pending-resend after mail returned, consumed genuine confirmation mail, confirmed the same row and verified original-password login/replacement-password denial. A second case concurrently submitted case-insensitive registrations through two ordinary clients and verified exactly one pending identity/no sessions. This is a single-server race, not multi-server concurrency proof. See [sanitized private HTTP/SMTP evidence](evidence/phase-a-private-g1-http-smtp.json); raw diagnostic logs and identities stay private.

A separate [existing-depot upgrade rehearsal](evidence/phase-a-private-g1-upgrade.json) seeded one pending identity under stock v0.34.3 with SMTP stopped, cleanly stopped the stock server, then started the exact private binary on the same depot. Migration startup succeeded; the pending ID/hash survived, real public resend and confirmation succeeded, and the original password logged in. The same depot then survived a second private-binary restart with the confirmed row and original-password login unchanged. Finally the pinned stock CLI backed up the original depot, the private server was stopped, the stock CLI restored that backup, and stock TrailBase restarted with the original pending identity and pre-migration schema artifacts restored. This is one local SQLite backup/restore and repeat-restart cycle only—not off-host disaster-recovery proof.

A second [ambiguous legacy-depot refusal rehearsal](evidence/phase-a-private-g1-ambiguous-refusal.json) created two case-insensitive pending identities using stock public signup with SMTP stopped, then attempted the exact private binary on that same depot. The binary failed closed at the migration CHECK; row contents/IDs/password hashes, application schema, migration history and temp schema remained unchanged. The only schema catalog additions were SQLite-owned `sqlite_stat1`/`sqlite_stat4` optimizer metadata from `PRAGMA optimize`; these are explicitly recorded and not attributed to the auth migration. Several initial overly broad snapshot attempts are preserved in the evidence chronology. This is one macOS SQLite case.

These are bounded prototype results, not stock behavior, SQL-candidate success, release-ready binary/deployment, or G1 signoff. Off-host disaster recovery, further restart cycles, broader HTTP/browser and SMTP-throttle matrices, concurrent multi-server writes, OAuth/anonymous/email-change lifecycle and security review remain pending. Preserve the four-hour resend throttle; a failed public resend is not immediately retryable.

## SMTP and wider limits

A uniqueness constraint does not roll back an account when SMTP fails, generate a missing verification email, or fix a native resend lookup. Investigation must verify initial failure, no session/protected access, an actual healthy delivery control, resend/retry, confirmation, and login—not just a successful signup response. If the candidate still fails recovery, G1 remains blocked; do not pre-verify an email, synthesize a session, or delete an account from SDK code.

The strict candidate SMTP probe now snapshots the genuine stranded identity's ID/password hash after the first HTTP 424. Retries with a different password and public resend must preserve exactly one unchanged pending identity. Real delivery, confirmation of that same identity and login with the original password remain required; preserved rows or opaque resend success cannot make the recovery case green. CI executes candidate characterization and the strict candidate SMTP regression separately from stock checks; a candidate failure keeps the job red.

Read-only stock-source review found no identity-preserving recovery through the inspected public APIs: the missing capability was a dedicated pending-identity redelivery path without widening shared verified-email lookups used by login/reset/OTP. Reservation SQL alone cannot invoke Rust mail sending. The private prototype's native regressions cover signed-ID confirmation and stale-link/address-reuse refusal; one real outage/resend/confirmation flow now passes. Rate-limiter failure/restart semantics, wider anti-enumeration timing and other lifecycle cases remain unverified; these source risks are not exploit/severity claims.

Email-change, OAuth/anonymous promotion, address release/reuse, races, restart persistence, existing-depot upgrades and future native migrations need regression review before recommending this deployment requirement. Existing native security rules and schema invariants remain authoritative. No broader auth compatibility is inferred from the email/password candidate.

Current results, blockers and approval state are in [progress.json](progress.json) and the [restart guide](PROGRESS.md).
