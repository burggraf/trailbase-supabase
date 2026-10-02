# trailbase-supabase

A planned Supabase-shaped TypeScript SDK for TrailBase: start with a lightweight TrailBase backend, then move to Supabase with fewer application changes.

**Status: planning only.** No SDK, npm package, migration command, or compatibility gateway is implemented yet. This is an independent project, not an official TrailBase or Supabase product.

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

See [PLAN.md](PLAN.md) for the exact scope, implementation milestones, validation requirements, and deferred features.

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

- [PLAN.md](PLAN.md): roadmap and acceptance criteria.
- [AGENTS.md](AGENTS.md): instructions for coding agents and contributors.
- [Source discussion](https://chatgpt.com/share/6ac02347-6a48-83e8-b8b8-8ef8986f9a0f): the project's starting point, not a verified API specification.

There are no install, build, or test commands yet. Those will be added with the first working SDK increment.
