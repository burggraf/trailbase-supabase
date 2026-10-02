# Agent and contributor instructions

## Read first

Read [README.md](README.md) and [PLAN.md](PLAN.md) before changing the project. The repository is currently planning-only; no SDK, package manifest, build system, or test commands exist yet.

The linked discussion explains the motivation, not a verified specification. Check official documentation and the pinned upstream versions before relying on an API mapping.

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

## Verification and documentation

- Leave at least one small runnable check for non-trivial logic. Prefer installed or native test tooling; add a framework only if it earns its cost.
- Verify against pinned upstream versions. Include failure paths, unsupported calls, filter/range/cardinality edge cases, and the auth/realtime lifecycle as those features land.
- Add real install/build/test commands alongside the first implementation; do not document imaginary commands or publish an unverified package name.
- Use a real TrailBase instance for integration checks and the official Supabase SDK for the migration/compatibility rehearsal. Mocks alone do not establish compatibility.
- Keep docs and examples within the supported subset. Mark any unverified mapping as an open question rather than a guarantee.
- Report what changed, which checks actually ran, and any remaining limitations. Never say a check passed if it was not run.
