# Draft upstream issue: v0.34.3 pending-email registration and resend

**Draft only; not submitted.** No real addresses, passwords, tokens, confirmation links, logs or admin credentials are included. Reproduce on disposable local resources only.

## Suggested title

v0.34.3: duplicate pending email registrations block confirmation; resend cannot find unverified accounts after SMTP failure

## Environment

- TrailBase v0.34.3, commit `eab5039392a624736ab0c6a9f07f6793423dc979`.
- Installed `trailbase@0.14.3` client; native SQLite backend.
- macOS arm64, Node 22.23.2; confirmation-required email/password auth and local Mailpit SMTP.
- Stock upstream auth migrations, no additional auth uniqueness constraints for the baseline reproduction.
- Sanitized, source-hashed local evidence: [stock regression](evidence/phase-a-auth-stock-characterization.json). The broader previous failing run is [also preserved](evidence/phase-a-g1-blocker-node22.json).

## Reproduction A: duplicate unconfirmed registration

1. Start a fresh local depot with real working SMTP and email confirmation enabled.
2. POST `/api/auth/v1/register` twice for the same new email before verification, with matching `password`/`password_repeat` in each request. The second request can use a different password.
3. Both requests return registration success without an authenticated session.
4. Follow a real delivered verification link.
5. Observed: confirmation returns HTTP 400; the intended original account cannot complete its normal confirmation/login flow. A fresh address registered once confirms normally.

Expected safety: duplicate signup must not create ambiguous pending identities, replace the original password or break confirmation. Registration can remain opaque to preserve enumeration resistance.

Pinned source:

- [New auth migration](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/migrations/main/U1785764695__unverified_email.sql): only verified `email` is uniquely indexed; `unverified_email` is not.
- [Register handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/register.rs): inserts pending records and sends mail afterward.
- [Confirm handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/verify_email.rs): updates every row matching the pending email, conflicting with verified-email uniqueness when multiple rows exist.

This is a demonstrated availability/correctness defect; we have not demonstrated privilege escalation and are not asserting a severity rating or CVE.

## Reproduction B: SMTP failure and pending-account resend

1. On a fresh depot, stop only the owned local SMTP sink.
2. Register a fresh email. Observed: HTTP 424, no authenticated session or protected access.
3. Restore SMTP and verify a separate fresh control address through real mail and explicit login.
4. Retry registration for the failed address; stock v0.34.3 can accumulate pending rows and reach the confirmation conflict above.
5. For an isolated resend reproduction, reserve pending addresses with the explicit investigational SQL described below, so duplicate insertion is not the cause.
6. Request `GET /api/auth/v1/verify_email/trigger?email=<pending-address>` for the existing failed pending identity. Observed: success response, but no verification message, while the healthy control delivers and confirms.

Pinned source: [resend handler](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/api/verify_email.rs) calls [user_by_email](https://github.com/trailbaseio/trailbase/blob/v0.34.3/crates/core/src/auth/util.rs), whose lookup filters verified `email`, not `unverified_email`.

Expected safety: report delivery failures honestly and provide a real confirmation recovery path for existing pending identities without pre-verifying them, fabricating a session, exposing account existence or overwriting passwords.

## Isolated workaround investigation (not a stock result)

A [candidate SQL migration](../tests/fixtures/auth-mitigation/U1790991000__reserve_auth_email.sql) adds pending uniqueness and cross-column INSERT/UPDATE guards. It refuses ambiguous existing identities, preserves null-address identities and permits same-owner confirmation. It is not proposed as a complete upstream fix and has not been approved for deployment.

The candidate passed 10 real characterization cases and 6 browser infrastructure cases, but does not repair pending-account resend/SMTP recovery. Stock and candidate contexts/reports carry separate `authVariant` markers. See [investigation and deployment prerequisites](AUTH_MIGRATION_INVESTIGATION.md).

## Repository reproduction commands

```sh
# After the documented local-only fixture prerequisites, npm ci and browser install:
npm run test:unit
npm run test:phase-a -- characterization
npm run test:phase-a -- characterization --auth-mitigation
npm run test:phase-a -- smtp --auth-mitigation
```

The stock characterization and candidate SMTP-recovery regressions intentionally remain failing until the required native behavior is resolved. Raw diagnostics stay private; sanitized summaries include test names/status, versions, source hashes, fixture variants and cleanup results. No client-side deduplication or automatic account deletion is presented as a backend fix.

## Questions for upstream maintainers

- What pending-email uniqueness/reservation guarantee is intended, including conflicts with verified addresses and concurrent confirmation?
- Should confirmation target a single identity consistently with token claims?
- How should pending registrations recover delivery after SMTP failure, and should resend query pending rather than verified identities?
- What migration/repair policy is safe for existing ambiguous pending identities without automatic reassignment?

We can provide additional disposable reproductions and test feedback. We are not requesting Supabase protocol emulation or publishing private diagnostics.
