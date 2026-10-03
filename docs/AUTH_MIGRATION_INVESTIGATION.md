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

## Initial investigation result (not signoff)

The opt-in SQL migration applied through the real pinned native migration runner and passed the 10-case characterization subset, including duplicate unconfirmed registration, original-password preservation and real email confirmation. SQL policy checks passed too. These are candidate-only observations; source-linked reports and rerun status are tracked in the ledger.

The real candidate SMTP-outage probe still fails: after restored SMTP, a healthy fresh control confirms and Supabase retry recovers, but the failed native account receives no verification mail. [The resend handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/verify_email.rs) calls [a lookup restricted to verified `email`](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/util.rs), so it cannot find a pending `unverified_email` identity. It returns an opaque success. The SQL uniqueness constraint correctly blocks another account insertion; it does not repair this missing delivery path. **G1 remains blocked; the candidate is not deployment-ready.**

## SMTP and wider limits

A uniqueness constraint does not roll back an account when SMTP fails, generate a missing verification email, or fix a native resend lookup. Investigation must verify initial failure, no session/protected access, an actual healthy delivery control, resend/retry, confirmation, and login—not just a successful signup response. If the candidate still fails recovery, G1 remains blocked; do not pre-verify an email, synthesize a session, or delete an account from SDK code.

Email-change, OAuth/anonymous promotion, address release/reuse, races, restart persistence, existing-depot upgrades and future native migrations need regression review before recommending this deployment requirement. Existing native security rules and schema invariants remain authoritative. No broader auth compatibility is inferred from the email/password candidate.

Current results, blockers and approval state are in [progress.json](progress.json) and the [restart guide](PROGRESS.md).
