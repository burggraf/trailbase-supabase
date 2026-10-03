# trailbase-supabase

A planned Supabase-shaped TypeScript SDK for TrailBase: start with a lightweight TrailBase backend, then move to Supabase with fewer application changes.

**Status: Phase A development in progress.** A private, MIT-licensed proof harness exists; the public compatibility SDK, migration command, and gateway are not implemented. This is an independent project, not an official TrailBase or Supabase product.

## Resume development and review progress

Start with [docs/PROGRESS.md](docs/PROGRESS.md) and `npm run progress`. The checked-in [progress ledger](docs/progress.json) tracks Phase A deliverables, all 27 feature rows, seven research gates, test evidence, missing checks, maintainer signoff, and next steps. Implemented, verified, and signed off are separate states.

```sh
npm ci
npm run progress
npm run check
npm run test:unit
npx playwright install chromium firefox webkit
npm run test:phase-a
npm run test:cleanup
```

Real-service tests require local Docker; see the restart guide for exact tool versions, Linux browser dependencies, safe recovery, tested environments, and evidence. The smaller Phase A probes are not a substitute for the future SDK's full suite.

## Start small

The initial target is **Level 1 — Supabase-shaped TrailBase SDK**, not a Supabase server clone:

```text
Application → compatibility SDK → native TrailBase APIs
```

The first release will target a deliberately small subset:

- `createClient()` and Supabase-style `{ data, error }` results.
- Table reads and basic insert/update/delete operations.
- Basic filters, sorting, pagination, and single-row results.
- Password signup, login, and logout with the session handling those flows need.
- Basic database change subscriptions, backed by TrailBase subscriptions.

TrailBase SSE authentication is connection-scoped: a valid token establishes a stream, and access lasts for that connection's lifetime even after token expiry. New connections require valid credentials. Logout/teardown must cancel local subscriptions; that is not server-side revalidation or full Supabase authorization parity.

See [PLAN.md](PLAN.md) for scope and future levels, and the [detailed Level 1 plan](docs/LEVEL1_PLAN.md) for the researched contract and implementation sequence.

## Verification is part of every feature

The [full test plan](docs/TEST_PLAN.md) defines unit/type/property, database, real integration, shared Supabase contract, browser E2E, security/fault, and packaged-consumer tests, with **27 feature-specific signoff rows**. Tests land with implementation, not afterward. Chromium, Firefox, and WebKit exercise real disposable TrailBase/Supabase backends and actual email-confirmation flows.

Release requires reproducible CI evidence and maintainer signoff—not mocks alone. [Upstream research](docs/RESEARCH.md) records seven open decisions, including signup return shapes, field conversions, auth lifecycle, and streaming behavior. Upstream/harness checks are being implemented and exercised; SDK feature implementation and signoff remain pending.

## Migration goal

For applications that stay within the documented subset, the goal is to change the SDK import and backend configuration without rewriting application queries:

```diff
- import { createClient } from '@trailbase/supabase'
+ import { createClient } from '@supabase/supabase-js'
```

`@trailbase/supabase` is the discussion's proposed package name, not a published package or a reserved npm scope. Final package naming is still to be decided.

**An import change does not migrate the backend.** Schema, records, users, files, and authorization rules need separate migration work. SQLite and Postgres semantics, TrailBase access rules and Supabase RLS, and auth identities are not interchangeable. The first version will document these limits and demonstrate a small manual migration rather than promise an automatic migration tool.

## Eventual goals

| Level | Goal | Status |
| --- | --- | --- |
| 1 | Supabase-shaped SDK calling native TrailBase APIs | Initial focus; minimal subset first |
| 2 | HTTP compatibility gateway allowing the real Supabase SDK to use TrailBase | Future goal; no implementation now |
| 3 | Drop-in Supabase server replacement, including wider protocol and semantic compatibility | Long-term aspiration; feasibility unproven |

Storage, OAuth, richer queries, and other additions to Level 1 are deferred until a real application needs them. Levels 2 and 3 must not expand the first release.

## Project documents

- [docs/PROGRESS.md](docs/PROGRESS.md): restart guide, commands, evidence, and signoff workflow.
- [docs/progress.json](docs/progress.json): authoritative per-deliverable/feature/gate status and next steps.
- [PLAN.md](PLAN.md): roadmap and acceptance criteria.
- [docs/LEVEL1_PLAN.md](docs/LEVEL1_PLAN.md): detailed work packages and completion gates.
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): mandatory full-suite and per-feature signoff requirements.
- [docs/RESEARCH.md](docs/RESEARCH.md): official sources, researched versions, differences, and open decisions.
- [AGENTS.md](AGENTS.md): instructions for coding agents and contributors.
- [Source discussion](https://chatgpt.com/share/6ac02347-6a48-83e8-b8b8-8ef8986f9a0f): the project's starting point, not a verified API specification.

Phase A commands are documented above and in the restart guide. Full SDK contract/security/application-E2E/package/release commands deliberately fail while unimplemented; they do not silently substitute a smoke test. See [LICENSE](LICENSE) for MIT terms.
