## Review

- **Fixed:** Required password credentials now require own `email` and `password` before reading their values (`src/auth.ts:18`). Both methods validate before dispatch; invalid login input also fails before incrementing generation (`:312–313`).
- **Fixed:** Native session parsing now requires own `auth_token` and `refresh_token`, alongside the existing own-CSRF requirement (`src/auth.ts:35`). Malformed login responses fail before installation, preserving committed state (`:200–207`). This closes the conditional prototype gap; it does not establish a server-authorization bypass.
- **Correct:** Ordinary own-field credentials and genuine JSON responses retain their existing validation and behavior. Null-prototype records remain supported through `plainObject` (`src/common.ts:4–11`). Refresh’s explicitly constructed credential object also satisfies the tightened requirement (`src/auth.ts:245`).
- **Correct:** Four regression cases test each prototype field independently. They verify signup/login zero-wire rejection, failed response replacement preserving good memory, no replay, and descriptor restoration in `finally` (`tests/unit/sdk-auth-own-credentials.test.ts:16–52`). Existing normal signup/login tests remain applicable (`tests/unit/sdk-auth.test.ts:14–29`).

**No issues found.**

- **Merge verdict:** **OK with notes** for this narrow boundary fix. No maintainer signoff inferred.

### Evidence limits

Read-only source/test inspection only: no commands, edits, fixtures or staging. The supplied `29a684…e2d` hash was not independently recomputed.

Reported mixed **168/168** results on Node22/24 were not reviewer executions. Earlier source42 real results are historical after this change; current `proc_8ffa` and clean-package outcomes were not verified here.