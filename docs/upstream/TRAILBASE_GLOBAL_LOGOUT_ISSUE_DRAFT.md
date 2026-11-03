# Draft — authenticated machine-readable global-logout acknowledgement

**Published and independently fetched/verified:** [trailbaseio/trailbase#310](https://github.com/trailbaseio/trailbase/issues/310), author `burggraf`. Exact suggested title/body verified; body SHA-256 `49b2f33b90e1edc383419655573b6a0988c8bb3e625b026bf0a48765b5d03b37`. One create attempt, no retry or authentication/access changes. Only the title/body below was posted; no publisher notes or private prototype data. This tracks a request, not an implemented backend fix or signoff.

**Current publication authorization:** Mark explicitly approved the VPS's existing `gh` login after the integration403; this executor is the sole publisher for this one issue and the parent will not submit another create. Existing identity verified as `burggraf`; no new login/token/scopes/access change. Verification continues independently.

Verified destination: **https://github.com/trailbaseio/trailbase** (public upstream repository, not a fork).

**Historical integration attempt:** parent attempted GitHub `create_issue`; the integration returned403 `Resource not accessible by integration` and created no issue. The earlier no-alternate-publisher restriction is superseded only by the explicit authorization above. The authorized single existing-login attempt succeeded after fresh upstream/template/duplicate review; no retry was needed. Publication is separate from packed consumer implementation.

## Suggested issue title

`v0.35.8: provide authenticated nonredirect acknowledgement for global logout`

## Suggested issue body

### Summary / environment

Could TrailBase expose a documented machine-readable global-logout outcome that confirms authenticated owner-wide refresh-session deletion, rather than requiring an application to interpret a browser redirect?

Reproduced against the **official Linux x64 v0.35.8** distribution, commit `05238c02b54aabb483e9f6224b5e014d40e88a5d`, SQLite/password auth, installed `trailbase@0.14.3`, disposable local SMTP-confirmed accounts. No server patch is required. This is an API capability request, not a claim of foreign-user access or a severity/CVE report.

### Reproduction / actual behavior

Use a new disposable local depot with email confirmation and a protected record API. Sign in twice as one confirmed owner and once as an unrelated control owner. Retain only the generated credentials locally; do not paste them in an issue.

1. Issue `GET /api/auth/v1/logout?redirect_uri=<same-origin-health-URL>` with **no cookies**, redirects disabled and **no Authorization header**. Observe **303** to that target; both owner refresh sessions and the control remain unchanged.
2. Repeat with an invalid Bearer JWT. Observe the **same 303 target**, with sessions/account/data unchanged.
3. Repeat with the genuinely valid owner Bearer JWT. Observe the **same 303 target**, but this time all that owner's refresh sessions are deleted. Their refresh requests subsequently return **401**; the unrelated control and account/data remain unchanged.
4. A followed health/root **200** cannot distinguish these outcomes. Already-issued access JWTs can still authorize requests until expiry; that is separate from refresh-session deletion.

Automated reproduction in our project: check out commit `8c15a0ed1e0abcf6854baeb1ade6e9e8eaa83abf`, follow its local-only prerequisites in [README](https://github.com/burggraf/trailbase-supabase/blob/8c15a0ed1e0abcf6854baeb1ade6e9e8eaa83abf/README.md), then run `npm run test:sdk:auth`. The `L1-19/OA03` case in [sdk-auth.test.ts](https://github.com/burggraf/trailbase-supabase/blob/8c15a0ed1e0abcf6854baeb1ade6e9e8eaa83abf/tests/phase-a/sdk-auth.test.ts#L218-L254) checks complete session/account/control-row postconditions and cleanup. The existing `L1-19/I19` case separately preserves the adapter's observable global uncertainty. The immutable [official-only checkpoint evidence](https://github.com/burggraf/trailbase-supabase/blob/8c15a0ed1e0abcf6854baeb1ade6e9e8eaa83abf/docs/evidence/official-only-auth-checkpoint.json) records the verified local version/source results and remaining limits: it is not a claim of full compatibility or a passing overall CI run. No raw logs, credentials, confirmation links or identities are attached.

### Source / requested behavior

The pinned [GET/POST logout handlers](https://github.com/trailbaseio/trailbase/blob/05238c02b54aabb483e9f6224b5e014d40e88a5d/crates/core/src/auth/api/logout.rs) accept `Option<User>` for GET, delete owner sessions only for `Some(user)`, then return the same redirect (or plain `logged out` response without a root/redirect). The POST handler instead deletes the specific refresh-token session; it is not global logout.

Source rechecked at current main snapshot [`f7015b3d57b44bf9e88be0418d7f4c88eca0525e`](https://github.com/trailbaseio/trailbase/blob/f7015b3d57b44bf9e88be0418d7f4c88eca0525e/crates/core/src/auth/api/logout.rs): the logout handler file is unchanged. That is source inspection, not runtime certification of main or newer releases.

Requested contract (API shape up to maintainers):

- A nonredirect programmatic global-logout operation requiring a genuinely authenticated caller; missing/invalid/expired credentials must not look like acknowledged deletion or change another owner's sessions.
- Success only after owner-wide session deletion completes; failures remain observable. Preserve existing browser redirect/local-session behavior if introducing a separate API mode.
- Document that acknowledgement is not immediate stateless-JWT invalidation, prevention of later login, an immediate remote-client event, or proof that cancellation/lost receipt rolled the operation back.

**Impact:** a Supabase-shaped client cannot honestly report successful default-global signout from the current response. We clear local state but expose unconfirmed remote revocation rather than silently claim success or substitute local scope. We are staying on official TrailBase and documenting this limitation; no Supabase wire-protocol emulation is requested.

Related signup/resend context: existing [#298](https://github.com/trailbaseio/trailbase/issues/298), closed, concerns the older 0.34.3 pending-uniqueness/SMTP recovery report. It is **not this request**: 0.35.8 now rejects conflicting pending signup with 409. We document signup's absent user result and pending resend/recovery limitations separately rather than open an omnibus duplicate. SSE lifetime clarification #299 is unrelated and outside scope.

## Publisher checks (outside issue body)

Handoff evidence: [reviewed official-only checkpoint](../evidence/official-only-auth-checkpoint.json), with exact version/source results and preserved initial failures. Current publication/CI status is in the [ledger](../progress.json).

- Immediately before publication, read-only review verified `burggraf`/the public nonfork upstream, the latest30issues/PRs and open/closed searches for `logout`, `signout`, `sign out`, `sign-out`, `revocation`, `acknowledgement` and `global`. #142/password-email verification, #137/SSE and #303/component capabilities were inspected and are not this request; relevant comments and #299 clarification were rechecked. No matching global-acknowledgement issue found in this bounded search, not an exhaustive uniqueness guarantee. Exact-title absence was checked again before the sole create.
- Upstream current recursive tree/community profile contained no CONTRIBUTING file or issue template; the organization-default issue-template lookup returned404. The current README **Contributing** section asks to discuss proposals beyond bug fixes first, and describes a CLA for contributions. This focused API-request discussion proposes no patch or license agreement. Do not reopen#298/#299 or split this focused request unless maintainers ask.
- #298 currently closed/completed; its one comment discusses adding pending uniqueness/cleanup. #299 currently closed/completed after explicit connection-lifetime clarification. Their closure is not evidence that this global acknowledgement exists.
- Attach only the reviewed official-only checkpoint summary/CI link when available. Do not attach prototype source/artifacts, private runtimes, database rows, user identities, credentials, mail, screenshots or raw logs. Do not post a speculative private implementation.
