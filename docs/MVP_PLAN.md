# CRUD + password-auth MVP

## Approved scope

Maintainer approved narrowing delivery to database CRUD and auth, then selected **self-service signup and full persistent session lifecycle** in the scope interview. This supersedes the pre-created-user POC recommendation. Approval authorizes implementation of this subset, not release signoff or backend changes.

CRUD/password-auth implementation, packed Node consumers on both pinned runtimes and three-engine packed browser flows exist with bounded source-bound evidence; no feature has complete release verification or signoff. [Release qualification](RELEASE_QUALIFICATION.md) maps current checks to the precise remaining requirements. Target remains a Supabase-shaped TypeScript client for TrailBase, not PocketBase compatibility. No automatic migration or import-only migration claim.

### Official-only decision — historical0358 boundary

Mark's 2026-11-02 22:08 UTC decision is to stay on official **TrailBase0.35.8 / commit05238c02b54aabb483e9f6224b5e014d40e88a5d**, with **JS0.14.3**, document auth limitations and move on. No private native fork or private SDK capability adoption/deployment/publication; prototypes are historical private evidence, not MVP dependencies. No further fork parity work by default. A focused global-logout acknowledgement request was published and fetched/verified as [issue310](https://github.com/trailbaseio/trailbase/issues/310) by the executor under Mark's later explicit one-issue existing-gh authorization. No further publication is authorized. Existing signup#298 is related context, not a duplicate report or current recovery proof.

The accepted MVP boundary is narrower than full Supabase auth compatibility: signup returns null user/session, native registration409 remains an error, no supported SDK signup-resend/identity-repair flow is offered, and default-global logout reports uncertainty rather than authenticated success. Normal confirmed-password login, persistence/live validation/refresh, explicit local logout and owner-isolated CRUD remain the implementation path. Preserve strict incompatibility results and backend errors. This is approval to proceed with documented limitations, not a technical fix, security waiver, package-publication approval or feature/release signoff.

### Current supported minimum — official0359+

The later explicit decision assumes **official TrailBase0.35.9or newer**, pins the reproducible fixture to0.35.9/commita106ce6338f9831140c92ac16e051901ed92d576 and authorizes the narrow genuine global receipt path without version autodetection/setting, private capability or auth-scope expansion. This supersedes only the older minimum/pending binding/always-unconfirmed-global boundary above. All actual handlers/replicas and rollbacks must preserve the supported contract and auth realm/session store; older/mixed/rolled-back deployments are unsupported and may return misleading matching200/no DELETE. The SDK does not verify versions. Later releases need qualification, not assumed proof.

Default/global remains global: captured JWT, exact JSON request Content-Type, omitted cookies/manual redirects, complete nonredirect plaintext200 receipt; failed/lost/malformed replies/native errors/storage failures remain errors with no replay/local fallback. An empty-client no-op is not a receipt. Captured expired JWTs are not automatically renewed for logout; native401/no DELETE stays observable. Refresh-session deletion does not immediately invalidate issued JWTs, prevent later login or prove outstanding server work stopped. Signup null-user/409/424/no-resend and broader G7/security/release gates remain. See [the precise contract](OFFICIAL_AUTH_CONTRACT.md) and OGL01–OGL06. AN registration/MFA draft was safely checkpointed with zero real execution, not passed. Original0358demo/data/assets/six containers remain unchanged; no deployment/network/security/fork/outreach change or release signoff.

### Included

- One TypeScript package, explicit schema/field mappings and useful `{ data, error }` results.
- Reads, single-record insert, primary-key-scoped update/delete; six basic AND filters, ordering, bounded pagination, single/maybeSingle.
- Email/password signup with real email confirmation; password login; persisted sessions; validated getUser; refresh/automatic refresh; auth notifications; explicit local/global logout.
- One accessible todos app demonstrating signup, confirmation, login, CRUD, reload, refresh and logout.
- Types, input validation, permission isolation, fault handling, cleanup, package/install documentation and tested Supabase-shaped behavior for advertised methods only.

### Excluded

Realtime/subscriptions and every capability in [FUTURE_PLAN.md](FUTURE_PLAN.md). No channel adapter, SSE reader or migration implementation in MVP. Unsupported methods/options must fail explicitly; never silently ignore them.

## Delivery order

1. **Build data slice now:** client/types/mappings/results and CRUD against existing pinned fixtures. Existing auth blockers do not prevent implementing and testing this slice using fixture users; that does not substitute for final signup tests.
2. **Build core auth:** guarded native HTTP where installed client behavior is insufficient; awaited hydration, single-flight refresh, session generation guards, owned storage/timer cleanup and observable errors. Reuse existing proof helpers as evidence/patterns, not production code without review.
3. **Carry G1/G7 as documented open auth edge cases:** preserve original strict failures and evidence; record signup/SMTP ambiguity and logout/late-response limitations in public-facing docs and tests. These are not prerequisites for implementing the main CRUD/auth MVP. Do not claim they are fixed, invent a workaround, or infer a compatibility exception or release signoff. No private G1 patch deployment, repin, or server change is authorized.
4. **Ship tested app/package:** exercise supported operations with real TrailBase and official Supabase reference; pack/install in clean consumers; document exact limits. Obtain maintainer release signoff separately.

Stop adding unrelated raw characterization. Add characterization only when it answers a concrete CRUD/auth implementation question. Preserve historical evidence and fixtures; do not delete tests to make CI green.

## Tests and measurable release criteria

Stable active feature IDs: **L1-01–L1-20, L1-24, L1-26, L1-27**. L1-21–L1-23 and L1-25 belong to future plan. Existing [TEST_PLAN.md](TEST_PLAN.md) specifies applicable test families; active rows retain their full unit/type/property, database, real integration/shared contract, browser, security/fault, resource and packed-consumer checks. Realtime/migration portions of mixed rows are future-scope requirements, not passing or skipped MVP tests.

- All three browsers run genuine signup/email confirmation, login, owner-isolated CRUD, filters/pages/cardinality, persistence, expiry/refresh, logout and teardown against real fixtures. No mocked success primary flow.
- Test rejected writes with unchanged database postconditions; invalid query inputs cause zero data requests; no automatic mutation replay after unknown outcome.
- Race/expiry/storage/network/SMTP failures cannot create success sessions, revive logout or overwrite a newer user; remote revocation errors remain visible. Auth secrets never enter public artifacts.
- Active security cases S01–S08 and S10 remain required. S09 streaming and E09/E12 realtime/migration are future requirements. Mixed E2E/security/package rows retain all CRUD/auth assertions and auth resource cleanup.
- Existing coverage thresholds, no hidden retries, three clean full candidate runs, exact-source evidence and named maintainer signoff still apply to the advertised subset. Historical upstream failures remain separately labeled; no SDK command may alias upstream probes as adapter verification.

The official-only G1/G7 route is now agreed: document limitations and proceed without fork adoption. Release date/signoff still depends on the remaining full applicable official-supported checks, not private parity work. Earlier estimates are planning ranges, not a commitment. Data slice and usable app progress take priority over broader compatibility research.
