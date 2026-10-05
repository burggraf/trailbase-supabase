# CRUD + password-auth MVP

## Approved scope

Maintainer approved narrowing delivery to database CRUD and auth, then selected **self-service signup and full persistent session lifecycle** in the scope interview. This supersedes the pre-created-user POC recommendation. Approval authorizes implementation of this subset, not release signoff or backend changes.

No SDK is implemented yet. Target remains a Supabase-shaped TypeScript client for TrailBase, not PocketBase compatibility. No automatic migration or import-only migration claim.

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
3. **Resolve release blockers:** G1 duplicate pending signup/SMTP recovery and signup return-shape exception; G7 authenticated global revocation acknowledgement. Keep original failures. Do not deploy private G1 patch, repin, alter server, fabricate signup identity or weaken logout scope under this approval. Seek a bounded maintainer decision when backend action/compatibility exception is needed.
4. **Ship tested app/package:** exercise same supported operations with real TrailBase and official Supabase reference; pack/install in clean consumers; document exact limits and obtain maintainer release signoff.

Stop adding unrelated raw characterization. Add characterization only when it answers a concrete CRUD/auth implementation question. Preserve historical evidence and fixtures; do not delete tests to make CI green.

## Tests and measurable release criteria

Stable active feature IDs: **L1-01–L1-20, L1-24, L1-26, L1-27**. L1-21–L1-23 and L1-25 belong to future plan. Existing [TEST_PLAN.md](TEST_PLAN.md) specifies applicable test families; active rows retain their full unit/type/property, database, real integration/shared contract, browser, security/fault, resource and packed-consumer checks. Realtime/migration portions of mixed rows are future-scope requirements, not passing or skipped MVP tests.

- All three browsers run genuine signup/email confirmation, login, owner-isolated CRUD, filters/pages/cardinality, persistence, expiry/refresh, logout and teardown against real fixtures. No mocked success primary flow.
- Test rejected writes with unchanged database postconditions; invalid query inputs cause zero data requests; no automatic mutation replay after unknown outcome.
- Race/expiry/storage/network/SMTP failures cannot create success sessions, revive logout or overwrite a newer user; remote revocation errors remain visible. Auth secrets never enter public artifacts.
- Active security cases S01–S08 and S10 remain required. S09 streaming and E09/E12 realtime/migration are future requirements. Mixed E2E/security/package rows retain all CRUD/auth assertions and auth resource cleanup.
- Existing coverage thresholds, no hidden retries, three clean full candidate runs, exact-source evidence and named maintainer signoff still apply to the advertised subset. Historical upstream failures remain separately labeled; no SDK command may alias upstream probes as adapter verification.

No reliable release date until G1/G7 route is agreed. Earlier estimates are planning ranges, not a commitment. Data slice and usable app progress take priority over broader compatibility research.
