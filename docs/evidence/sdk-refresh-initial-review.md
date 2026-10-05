## Review

**Merge verdict: BLOCK — refresh can overwrite or clear a newer committed login.** Read-only review; no edits, commands, dependencies, or fixtures launched. No maintainer signoff inferred.

### Correct

- Native client remains tokenless (`src/index.ts:378–380`). Refresh uses a separate POST with only the captured refresh credential in JSON, omitted cookies, and refused redirects (`src/auth.ts:143–145,205`). Records receive bearer authorization without refresh/CSRF headers (`src/auth.ts:257–264`).
- Exact own refresh-response fields, same-captured-user validation, and retention of the original refresh credential are implemented (`src/auth.ts:208–212`). Installed native client explicitly handles 200/401 and retains that credential (`node_modules/trailbase/dist/index.js:766–780`).
- Terminal clearing nulls both authoritative memory and committed baseline before serialized removal; rejected removal latches a sanitized error (`src/auth.ts:180–197`). Existing tests cover removal overlapping newer successful/failed login and failed removal (`tests/unit/sdk-auth-refresh.test.ts:57–67`).
- Parser privacy, own auth-option selection, hydration reconciliation, and serialized compensation remain present (`src/auth.ts:23–28,72–80,104–137,172–175`).
- Dedicated fixture wiring selects the existing short-native-auth profile without changing the default fixture (`scripts/run-phase-a.mjs:34,113`; `scripts/harness.mjs:87–90,149,253`). Whole-fixture teardown remains unconditional (`scripts/run-phase-a.mjs:145`; `scripts/harness.mjs:176–208`).
- README distinguishes exact-exp request renewal from background refresh, cached identity from validation, and local clearing from global/access-JWT revocation (`README.md:27–33,47–51`). Installed reference source supports the stated request-time renewal observation (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:3061–3081`).

### Findings

#### 1. P1 — Refresh started during pending login can overwrite or delete that login

**Location:** `src/auth.ts:202–217,250`; installation at `124–133`, clearing at `180–184`.

Generation increments when login is **invoked**, not when its credentials commit. Refresh started afterward captures the old session but shares the pending login’s generation. Its identity comparison checks only the captured session.

**Static repro:**
1. Hydrate session C.
2. Invoke password login B; hold its HTTP response.
3. Start refresh; it captures C in B’s generation.
4. Release B and await successful installation.
5. Release C’s refresh:
   - Valid C200 passes the captured-user comparison and installs C over B.
   - C401 satisfies the epoch check and removes B’s memory and stored credentials.

Expired data/getSession can initiate the same race without manual refresh. Existing held-refresh tests start refresh **before** invoking newer login, so they do not cover it (`tests/unit/sdk-auth-refresh.test.ts:35–61`).

**Smallest fix:** Guard refresh success and terminal clearing against the captured authoritative credential/state as well as generation. Check that guard inside the serialized installation operation and after storage awaits, not merely before enqueueing.

**Regression:** Hold login B, start C refresh, commit B, then release C200/C401. Assert B remains authoritative and persisted, no owned-key removal occurs, and stale waiting data does not dispatch.

#### 2. P1 — Delivered refresh401 becomes transient if its body fails

**Location:** `src/auth.ts:146–155,216–217`.

`request()` awaits `response.text()` before constructing the status-bearing `FetchError`. If a native refresh401 body fails or truncates, that await throws a transport/body error. Terminal handling consequently never runs.

**Static repro:** Return a status401 refresh response whose `text()` rejects. With unexpired C, refresh returns a body error, disk remains unchanged, subsequent getSession reports C successfully, and later data can dispatch with C.

This contradicts terminal native401 clearing (`README.md:49`).

**Smallest fix:** Preserve refresh status401 independently of error-body acquisition. Body failure must not erase the delivered terminal status or bypass serialized clearing.

**Regression:** Cover rejecting and delayed error bodies, joined data/getSession, sanitized errors, owned-key removal, and newer-login protection.

#### 3. P1 — Required JWT fields can be inherited rather than present

**Location:** `src/auth.ts:39–42`, newly reached by refresh at `211`.

Only `email` is checked for ownership. Required `alg`, `sub`, `iat`, and `exp` are read through the prototype chain. `plainObject()` permits `Object.prototype`; it does not guarantee that a subsequently accessed property is own.

**Static repro:** Hydrate valid C, temporarily supply non-enumerable `Object.prototype.alg/sub/iat/exp`, then return exact refresh fields containing a JWT with header `{}` and claims `{email:null}`. Matching inherited subject and valid inherited times satisfy every check. Refresh installs the malformed token and reports success.

**Smallest fix:** Require own `alg`, `sub`, `iat`, and `exp` before validating their values. Preserve existing sanitized parser failures.

**Regression:** Omit each required field while its prototype supplies a valid value; assert failure, unchanged memory/disk, and no pending data dispatch.

#### 4. P2 — Refresh accepts non-native successful status codes

**Location:** `src/auth.ts:146,156,205–213`.

Any `response.ok` status proceeds to installation. An exact valid refresh body with status201 or202 therefore succeeds, despite the requested exact-native200 contract and installed native client’s explicit status switch.

**Smallest fix:** Require status200 specifically for refresh without broadening signup/login changes.

**Regression:** Exact valid bodies with201/202 must fail observably, preserve state, and dispatch no waiting data.

#### 5. P2 — Primary genuine-expiry success test always starts manual refresh first

**Location:** `tests/sdk-refresh/refresh.test.ts:23–24`; parallel unit pattern at `tests/unit/sdk-auth-refresh.test.ts:22`.

The real test establishes genuine backend expiry, but invokes manual refresh before cached/data operations. Those operations exercise joining an existing flight, not independently initiating renewal. Removing the expiry-trigger branch while retaining flight joining would leave this primary success scenario green.

**Smallest fix:** Add genuinely expired data/getSession operations with **no manual flight**, asserting one refresh, successful original request exactly once, and renewed persistence. Retain the manual-joining scenario separately.

#### 6. P2 — Partial-acquisition cleanup depends on the expired credential under test

**Location:** `tests/sdk-refresh/refresh.test.ts:31–32`.

If the test fails after genuine backend denial but before successful renewal, cleanup uses the stored original access JWT without renewal/login. That JWT has just been proven unusable. Owned-row cleanup then fails rather than establishing its postcondition. Cleanup also silently returns if the key is absent.

Whole-fixture destruction still removes the disposable depot; this is **not** evidence of leaked persistent external resources.

**Smallest fix:** Track acquired owner/row resources independently of current storage and obtain fresh genuine ordinary-user credentials for exact owned cleanup. Retain cleanup errors and prove row absence even after an injected post-expiry failure.

### Validation and residual risks

- Findings are source-proven execution paths and proposed regression recipes, **not executed reproductions**.
- Reported source hash `acf837e8e820e0d3b7e9d08e048051e59151a46dad76db11d14466509b1283a5` appears in `docs/evidence/sdk-refresh-checkpoint-node22.json`; independently recomputing it was unavailable with the permitted tools.
- Parent’s frozen-source real run was not treated as completed evidence. Any correction requires fresh exact-source checks.
- Background refresh, getUser/logout/events, reference expiry runtime, browser refresh, and release/signoff remain outside this bounded review’s implementation demands.