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

Required private rehearsal includes genuine SMTP failure/control/redelivery, unchanged pending ID/password through alternate-password retries, actual mail confirmation of that same identity, alternate-password denial/original-password login, transactional migration refusal and row/schema/history preservation, concurrency and owned cleanup. Native unit tests alone do not establish those HTTP/mail/upgrade guarantees. A three-file private draft exists, but its native tests stopped before compilation because the pinned checkout's vendor submodules were uninitialized. The complete partial diff is retained privately; exact gitlink restoration precedes any same-protocol retry. Buildability, real HTTP/mail tests, full lifecycle/upgrade matrices and named G1 signoff remain pending.

## SMTP and wider limits

A uniqueness constraint does not roll back an account when SMTP fails, generate a missing verification email, or fix a native resend lookup. Investigation must verify initial failure, no session/protected access, an actual healthy delivery control, resend/retry, confirmation, and login—not just a successful signup response. If the candidate still fails recovery, G1 remains blocked; do not pre-verify an email, synthesize a session, or delete an account from SDK code.

The strict candidate SMTP probe now snapshots the genuine stranded identity's ID/password hash after the first HTTP 424. Retries with a different password and public resend must preserve exactly one unchanged pending identity. Real delivery, confirmation of that same identity and login with the original password remain required; preserved rows or opaque resend success cannot make the recovery case green. CI executes candidate characterization and the strict candidate SMTP regression separately from stock checks; a candidate failure keeps the job red.

Read-only source review found no identity-preserving recovery through the inspected stock public APIs: the needed native capability is a dedicated pending-identity confirmation-redelivery path, without widening shared verified-email lookups used by login/reset/OTP. Reservation SQL alone cannot invoke Rust mail sending. Confirmation's signed-identity binding, resend-failure throttling and stale-link/address-reuse safety need real regression evidence; these source risks are not exploit/severity claims.

Email-change, OAuth/anonymous promotion, address release/reuse, races, restart persistence, existing-depot upgrades and future native migrations need regression review before recommending this deployment requirement. Existing native security rules and schema invariants remain authoritative. No broader auth compatibility is inferred from the email/password candidate.

Current results, blockers and approval state are in [progress.json](progress.json) and the [restart guide](PROGRESS.md).
