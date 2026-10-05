## Review

**All six original findings are resolved in the inspected source/tests. One new fix-induced issue remains.**

### Fixed by the implementation

| Original finding | Resolution and evidence |
|---|---|
| Pending-login refresh could overwrite/remove B | Captured authoritative-state guards cover pre-install, queued installation, post-write, and terminal clearing; committed revision protects compensation/removal (`src/auth.ts:124–141,199–207,235`). Same-user/different-session, queued-write, and terminal-during-write regressions cover these paths (`tests/unit/sdk-auth-refresh-review.test.ts:15–38`). |
| Failed/held401 body bypassed clearing | Delivered refresh401 never reads text; owned cancellation is handled without awaiting the body (`src/auth.ts:154–158`). Regression checks settlement, aborted signal, cancellation rejection, and zero text reads (`tests/unit/sdk-auth-refresh-review.test.ts:40–46`). |
| Inherited required JWT fields accepted | Own `alg/sub/iat/exp` checks now precede validation (`src/auth.ts:39–40`). Prototype vectors cover login/hydration/refresh with descriptor restoration in `finally` (`tests/unit/sdk-auth-refresh-review.test.ts:48–55`). |
| Non200 refresh success accepted | Successful statuses other than200 become explicit errors (`src/auth.ts:160–162`);201/202 vectors preserve C and prevent waiting data dispatch (`tests/unit/sdk-auth-refresh-review.test.ts:58–59`). |
| Genuine expiry test only joined manual refresh | Real test now initiates renewal through expired data/getSession, counts one refresh and one original record request, then tests manual joining separately (`tests/sdk-refresh/refresh.test.ts:57–64`). Unit regression and preserved expiry-trigger mutation failure establish sensitivity. |
| Partial cleanup depended on expired/stored credentials | Independent owner/attempt tracking and fresh genuine same-owner password login perform exact row cleanup and absence checks (`tests/sdk-refresh/refresh.test.ts:12,20,26–35`). Absent/rejected-storage post-expiry vectors require unchanged primary error and successful cleanup (`73–84`). |

Parser privacy, own-option selection, hydration reconciliation, fail-closed latches, and bearer-only record transport remain intact. No deferred lifecycle expansion found.

### Finding: P1 — Redirected401 is misclassified as native terminal rejection

**Location:** `src/auth.ts:154–164`, terminal handling at `238–240`.

The new refresh401 branch executes **before** the existing `response.redirected` rejection. A configured fetch returning a followed-redirect final401 therefore clears current credentials rather than returning `AuthRedirectError`.

**Static repro:**
1. Hydrate valid, unexpired C.
2. Return a refresh response with `status:401` and `redirected:true`.
3. The branch at154 throws terminal `FetchError(401)` before line164 is reached.
4. Terminal handling removes C’s authoritative memory and owned storage.

Previously, redirect rejection preceded status handling. This violates the preserved refusal of redirects and “only native refresh-endpoint401 is terminal” contract (`README.md:47–49`). No credential-leak or global-revocation inference is made.

**Smallest fix:** Reject redirected/opaque-redirect responses before classifying native refresh statuses, retaining nonawaited resource cleanup and the no-body-read401 behavior.

**Regression:** Redirected401 must return `AuthRedirectError`, preserve C’s memory/disk, perform zero owned removals, and prevent joined data dispatch. Retain ordinary native401 cancellation tests.

### Merge verdict: BLOCK

The original six are resolved; fix the redirect-status ordering regression before closing this review.

### Validation limitations

- Read-only inspection only; no commands, edits, staging, dependencies, or fixtures.
- Inspected preserved RED, exact-source GREEN, checkpoint, and mutation artifacts. Their reported Node22 outcomes were not rerun by this reviewer.
- Source hash `f03191feb286b3456358ca96639876e1bc2dd978603be7337327d1ec83d401a4` matches inspected evidence metadata but could not be independently recomputed with available tools.
- Parent real three-case run and Node24/package outcomes were not inferred. No compatibility or maintainer signoff.