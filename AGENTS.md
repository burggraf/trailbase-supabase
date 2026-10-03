# Agent and contributor instructions

## Read first

Start with [docs/PROGRESS.md](docs/PROGRESS.md) and run `npm run progress`; [docs/progress.json](docs/progress.json) is the authoritative restart/status/signoff ledger. Then read [README.md](README.md), [PLAN.md](PLAN.md), [docs/LEVEL1_PLAN.md](docs/LEVEL1_PLAN.md), [docs/TEST_PLAN.md](docs/TEST_PLAN.md), and [docs/RESEARCH.md](docs/RESEARCH.md). Phase A has a private MIT-licensed npm proof harness; no public compatibility SDK is implemented.

The linked discussion explains the motivation, not a verified specification. Research records documentation/source observations, not runtime proof. Resolve the seven research gates through real characterization before advertising an API mapping.

## Scope guardrails

- Implement only the minimal **Level 1 — Supabase-shaped TrailBase SDK** contract in `PLAN.md` unless the maintainer explicitly approves more.
- Levels 2 and 3 are documentation-only eventual goals. Do not add HTTP gateways, Supabase server endpoints, protocol emulators, or a TrailBase fork.
- Deferred Level 1 features are also out of initial scope: richer queries, upsert/bulk writes, relationships, Storage, OAuth, SSR cookies, and the migration CLI.
- Do not present planned features as implemented. Update the compatibility matrix and README whenever the supported contract changes.

## Implementation approach

- Prefer one small TypeScript package. Do not introduce a monorepo, plugin system, dependency-injection layer, or speculative backend abstraction.
- Trace the actual request/session/subscription flow and inspect existing code and callers before editing.
- Reuse the official TrailBase TypeScript client where it meets the contract; prefer native platform APIs for gaps. Add dependencies only for a concrete requirement that existing tools cannot reasonably cover.
- Keep the public surface Supabase-shaped, but claim compatibility only for tested methods, arguments, and result shapes.
- Reject unsupported methods/options/query syntax explicitly. Never silently ignore filters, truncate cardinality errors, or fabricate fields and successful results.
- Use verified native server guarantees. Do not emulate atomic upsert or bulk authorization with unsafe client-side loops, or implement pagination/filtering by downloading entire tables.

## Security and correctness

- Keep TrailBase access rules and authentication effective; SDK compatibility is not an authorization layer.
- Never commit credentials, tokens, private keys, personal data, or live backend configuration. Examples must use placeholders or disposable local resources.
- Validate inputs at trust boundaries, safely encode query values, and preserve actionable backend failures.
- Require an explicit primary-key filter for initial update/delete support; never turn an unsupported mutation into an unbounded write.
- Do not expose privileged credentials to browsers or invent API-key authentication for TrailBase.
- Keep user sessions isolated across server requests. Define persistence and refresh behavior, clear session state on logout, and clean up subscriptions.
- Treat schema/data, auth identities, files, and access rules as separate migration concerns. Never claim that import changes migrate data or that arbitrary RLS/password credentials transfer automatically.

## Mandatory full test plan and signoff

- A full test plan at every applicable layer is required for every feature, bug fix, dependency/fixture change, and eventual future level. Follow `docs/TEST_PLAN.md`; a single runnable check or happy-path demo is not enough.
- Define feature IDs, unit/type/property, database, real integration, shared contract, browser E2E, security/fault, package checks, and measurable signoff criteria before implementation. Add tests with the code, not in a final testing phase.
- New/deferred features need new matrix rows and explicit scope approval. Mark a layer N/A only with a concrete reviewer-approved reason, never simply because the backend/browser setup is inconvenient.
- Use the pinned real TrailBase server and installed client distribution; compare claimed compatibility with the official Supabase SDK and real local Supabase stack. Mocks cannot sign off behavior or compatibility.
- Browser E2E must run on Chromium, Firefox, and WebKit and cover real confirmation email, CRUD/query behavior, persistence/refresh/logout, two-client realtime, permissions, failures, and teardown. Do not stub successful auth/data responses for the primary E2E flow.
- Prove database/session/event/resource postconditions, including forbidden writes and no data/secret leaks. Test race/expiry/partial-frame failures and cleanup, not only response codes.
- Follow coverage/CI/release gates in the test plan. Setup failure is failure, not a skip. Do not hide flakes behind retries or relax assertions to erase unapproved incompatibility/security gaps.
- Update `docs/progress.json` after each work session: deliverable/feature/gate statuses, exact tests/evidence, missing checks/blockers, and ordered restart steps. Use `docs/PROGRESS.md` for the workflow. Planned, implemented, verified, and signed off are distinct states; stale evidence does not certify a changed contract.
- Only the maintainer can approve signoff or compatibility exceptions. Do not fill in `reviewer`/`reviewedAt` from an agent's inference. MIT licensing was explicitly approved; G1–G7 approval has not been inferred from that instruction.
- Run `npm run check`, `npm run test:unit`, and the applicable real Phase A scopes for harness/fixture changes. Full SDK commands intentionally fail while unimplemented; never alias them to the smaller upstream probes or claim they passed.
- Use only generated owned fixtures. Recover hard-killed runs through `npm run fixtures:cleanup -- <run-id>`; never bypass a live lock, reset a linked project, or prune unrelated Docker resources.
- Tests and CI use disposable local resources, never live data or browser admin credentials. Sanitize traces/logs/reports before uploading; do not assume disposable tokens are safe to publish.
- Add real install/build/test commands alongside the first implementation; command names in the plan are proposals until executable scripts exist. Do not publish an unverified package name.
- Keep docs/examples/types within the supported subset and expose approved limitations (signup user, field mapping, auth scope, realtime payloads) to consumers. Never fabricate fields or quietly weaken permissions for parity.
- Report exact checks actually run, evidence, missing layers, open gates, and remaining limitations. Never say a planned or skipped test passed.
