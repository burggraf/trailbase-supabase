# Future work — outside CRUD/auth MVP

Requires separate scope approval before implementation. No schedule or compatibility promise.

## After MVP proves useful

- Realtime channels, event mapping, buffered SSE, connection/loss/reconnect and subscription cleanup: L1-21–L1-23; research gates G5/G6. Retain existing upstream evidence and strict failures; no active MVP release dependency solely for streaming behavior.
- Portable-app/manual schema/data migration rehearsal: L1-25. Identities, passwords, sessions, files and authorization remain separate migration problems. Do not claim import changes migrate data.
- Richer queries, projections/count/head, JSON/BLOB/date operators, nullable ordering, relationships, upsert/bulk writes and mutation-returning.
- Storage, OAuth, password recovery/MFA, SSR cookies, auth administration and type-generation conveniences.
- Migration CLI and optional alternate database paths.

## Longer term

- Supabase HTTP gateway (Level 2).
- Wider Supabase server/protocol compatibility (Level 3).
- PocketBase compatibility only if separately requested and specified; not current project target.

## Preserved requirements

[LEVEL1_PLAN.md](LEVEL1_PLAN.md) and [TEST_PLAN.md](TEST_PLAN.md) retain broader feature descriptions and stable IDs as future specifications. Their realtime/migration portions are deferred, not implemented, signed off, waived or erased. Reapply all relevant test/security/release requirements before promoting a future capability. Do not delete historical tests/evidence or repin fixtures solely to accelerate MVP.
