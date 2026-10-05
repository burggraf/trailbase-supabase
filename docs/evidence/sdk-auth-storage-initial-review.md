## Review

- **Correct:** Writes serialize, stale/failed writes await compensation, and failed restoration latches sanitized errors without exposing usable sessions (`src/auth.ts:110–138,158–170`). Storage faults and expired sessions cannot normally fall back to anonymous dispatch. Auth/data requests omit cookies and refuse redirects (`142,182–189`). Deferred lifecycle methods remain explicitly unsupported.
- **Correct:** Primary integration/browser flows use genuine backends and password authentication, not mocked successes. Browser acquisition occurs inside unconditional cleanup; storage/fixture/route cleanup remain separate from SDK logout claims (`tests/sdk-browser/auth-storage.spec.ts:9–35`). Existing assertions remain strict.
- **Fixed:** None; read-only review.

### Finding: P1 — Failed login after superseded hydration loses persisted identity

**Location:** `src/auth.ts:97–105,160–170,182–189`.

Source-derived reproduction:
1. Start `getSession()` with a held storage read containing valid, expired C credentials.
2. Invoke password login B, advancing the generation.
3. Release the read. Initialization sets `committed=C` but skips `state=C`.
4. Return HTTP 401 for B.
5. Subsequent `getSession()` returns null without error; a record request dispatches without Authorization instead of returning `AuthSessionExpiredError`.

Initialization is cached, and the login failure handler never reconciles committed hydration into current memory. This contradicts retained expired credentials/no-anonymous-fallback behavior; unexpired C is also lost.

**Smallest correction:** Reconcile committed hydration on a current-generation failed login, without allowing the old initializer to install stale state. Add held-hydration/failed-login vectors for expired and unexpired C, asserting retained refresh credentials and zero expired data dispatch. Existing tests cover successful superseding login and ordinary expired hydration separately (`tests/unit/sdk-auth-storage.test.ts:30–35,61–75`), not their failing combination.

### Finding: P2 — Required fields can be inherited from Object.prototype

**Location:** `src/auth.ts:61,74`; `src/common.ts:4–10`.

`plainObject()` permits ordinary Object.prototype-backed objects. With inherited `version=1`, stored JSON containing `{ tokens: validTokens, unexpected: true }` passes the envelope check despite lacking an own version field. Similarly, inherited persistence/refresh booleans allow `auth:{}` to bypass the explicit-settings requirement.

**Smallest correction:** Require own `version`, `persistSession`, and `autoRefreshToken` fields. Add temporary prototype-property regressions with unconditional descriptor restoration. This is conditional hardening against pre-existing prototype pollution, not a demonstrated authorization bypass.

- **Merge verdict:** **OK with notes for a private development checkpoint; P1 needs correction before release. No signoff.**

### Evidence limitations

No commands, edits, staging, dependencies, or fixtures were launched. Read checkpoint/unit/package reports consistently claim source `93345a…25a09a`; cryptographic recomputation was unavailable under the permitted tools. Parent-owned `proc_8a17` outcomes were not inferred. Cross-tab behavior, complete persistent lifecycle, G1/null signup user, and G7 remain outside verified claims.