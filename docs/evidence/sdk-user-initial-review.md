## Review

- **Correct:** Live validation uses both genuine credentials, not bearer-only status (`src/auth.ts:152–164, 285–287`). Source tracing confirms bearer-only re-signs cached claims; refresh-present status queries live session/user records and signs fresh DB claims (`.runtime/upstream-g1/source/crates/core/src/auth/api/status.rs:50–88`; `tokens.rs:213–274`). Optional extraction explains anonymous/invalid/expired status returning triple-null.
- **Correct:** Exact-200, own three-field acknowledgement, retained captured refresh, non-null CSRF, required JWT fields and canonical identity checks precede installation (`src/auth.ts:36–42, 293–299`). Anonymous/error responses cannot return cached success or terminal-clear status credentials.
- **Correct:** Epoch **and captured state/committed baseline** guard queued persistence, compensation and returned identity (`src/auth.ts:124–143, 280–301`). This covers B invoked before C status at the same generation, intervening refresh, held writes and authoritative terminal invalidation. Existing storage/refresh tests preserve hydration reconciliation, restoration latches and rejection behavior.
- **Correct:** Authenticated status sends only authorization/refresh headers, omits cookies and rejects redirects before terminal classification (`src/auth.ts:150–175`). README explicitly discloses native token-rotation side effects (`README.md:31`).
- **Correct:** Authored real tests use genuine signup/mail/login and exact owned SQL mutation/postconditions for changed email, forged credentials, revoked session and deleted user (`tests/phase-a/sdk-auth.test.ts:73–87`). Acquisitions occur inside cleanup protection; database closes are independent cleanup steps (`:74, 89–90`; `tests/sdk-browser/cleanup.ts:3–11`). Refresh coverage independently checks actual expired status and acquires fresh cleanup credentials (`tests/sdk-refresh/refresh.test.ts:28–35, 58–65`).

### Finding: P1 — Superseded successful status response is discarded without cancellation

**Location:** `src/auth.ts:287–288, 302–304`.

After `request('status')` returns HTTP 200, the immediate baseline check can throw because login or refresh completed while fetch was pending. This exits before reading the response body. Neither that path nor its catch cancels the body or aborts the owned controller; cancellation exists only inside request’s redirect/non-200 branches (`:154–174`).

**Deterministic regression vector:** Hydrate C; hold status fetch; commit B; release status with a 200 response containing an open `ReadableStream` and cancellation spy. `getUser()` returns `AuthStaleOperationError`, but the stream receives no cancellation and the request signal remains unaborted. Thus a discarded response retains outstanding transport resources despite the operation settling.

Existing race coverage uses buffered `Response.json(live())` and checks identity/storage only (`tests/unit/sdk-auth-user.test.ts:26–29`), so it cannot detect this leak.

**Smallest fix:** Preserve access to the response’s owned abort/cancel cleanup and invoke it when status is discarded before body consumption. Cancellation failure must not replace the stale error or block settlement. Add the open-stream regression above, including unchanged B credentials.

- **Fixed:** None; read-only review.
- **Merge verdict:** **OK with notes** for the development checkpoint; fix the P1 before release. No compatibility or maintainer signoff.

### Evidence limits

No commands, edits, fixtures or servers were run. Hash recomputation requires unavailable execution capability; `371579…ba3b7` is the supplied/ledger-reported hash, not independently recomputed. The inspected source checkout’s reconstructed private patch does not target status/tokens; its provenance was not cryptographically revalidated.

Reported mixed-unit results are supporting artifacts, not independent runtime proof. Parent process `proc_577f` outcomes were not available here. Real auth/refresh execution and remaining deferred/unsigned layers remain unverified by this review.