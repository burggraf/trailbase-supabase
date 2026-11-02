# Native TrailBase upgrade: 0.34.3 to official stable 0.35.8

Mark explicitly authorizes the native server pin/binary upgrade and necessary compatibility work, superseding the repin hold. No JS/package upgrades, private G1 patch deployment, publication, commit/push or unrelated feature work. Preserve the reviewed cd302721 SDK/diagnostic tree in the private pre-upgrade source archive and retain all historical evidence with its original version binding.

## Release/source findings

Official latest-release API identifies stable/non-draft v0.35.8 (2026-10-30), tag commit05238c02b54aabb483e9f6224b5e014d40e88a5d. Linux x86-64 archive digest/size verified against official asset metadata; ELF64 little-endian machine62 and actual --version verified on VPS. The missing optional `file` utility caused the first provenance command to exit127 after checksum verification; ELF header inspection and direct execution subsequently establish compatibility, not a binary/runtime failure.

Download complete official old/new source directories rather than treating the compare API's300-file cap as exhaustive. Inspect auth/migrations/create-record changes. G1 remains unresolved: verified-email resend lookup, address-only confirmation, four-hour throttle; new upstream pending uniqueness and conflict responses change failure stages, not an approved compatibility exception. U1791097712 deletes pending identities older24h before creating a unique index. Test deletion/conflict behavior explicitly; never repair timestamps/rows or mark migrations applied manually. INSERT ignore-policy changes require actual supported single-record create/postcondition coverage.

## Implementation contract (L1-14/L1-19/L1-24/L1-26/L1-27)

- Pin native0.35.8/commit and four official platform assets only. Preserve0.34.3 pin as an explicit legacy fixture for upgrade/restore; do not rewrite historical evidence or old private prototype hashes.
- Versioned native executable cache paths keep old/new tools separate; never remove/overwrite original `.runtime/tools/linux-x64/trail`. Regression tests reject unsafe pin paths and prove cache isolation. Existing owned-user CLI callers must use the same versioned path.
- Keep original six service images, JS0.14.3/reference clients, Node versions, credentials/access rules/ports unchanged. Preserve SDK error/security/strict research behavior; investigate regressions without weakening assertions.

## Required verification

1. TDD cache/pin checks, full pinned Node22.23.2/24.21.0 units/type/static/clean package checks. Real fresh native setup, auth3/refresh4/data6/DB9/constraints6; affected G1 stock/candidate SMTP and characterization/lifecycle strictly reported, not converted to expected success.
2. Owned isolated checkout/index/cache/lock/generated loopback ports, correct local CLI entrypoints (no parent-resolving copied bin symlinks). No original fixture setup/cleanup. Test genuine0.34.3 generated accounts/tasks/sessions through0.35.8 migration, repeat startup, complete stopped-depot/config/keys/WAL backup/restore and0.34.3 rollback. Add negative generated fixtures for old-pending deletion and duplicate-index conflicts; preserve exact failures/postconditions.
3. Real three-engine packed todos/CRUD/auth acceptance, plus owned private HTTPS readiness/browser acceptance where prerequisites permit; no broadened exposure or fake auth/data. Failed/setup/blocked layers remain explicit. Observe every job and verify owned process/container/network/volume/depot/context/lock cleanup.
4. Original demo only after compatibility proof: verify exact original ownership/process absence/no open depot descriptors, copy complete stopped depot/metadata/assets to protected private backup and separate preflight copy. Aggregate-only queries for pending-deletion counts, duplicate index blockers and ownership impacts; no identifier/credential/task output. Verify backup manifest and repeatable copy restore. If any user/account/data deletion, ambiguous identity conflict or uncertain migration effect remains, HOLD original upgrade with concrete counts and proposal. No automatic repair or destructive cleanup.
5. Only if all original preconditions and safe rollback verify, perform backed-up same-depot upgrade with exact existing ports/access scope, serialized original HTTPS forwards and independently verified guardian ownership. Otherwise retain original stopped state. No private signup patch or scope/network changes.

## Deliverable

Version/source-bound sanitized evidence, exact results/failures/blockers and terminal original-demo state. Retain raw private logs/manifests, old binary and pre-upgrade uncommitted source. No broad release/G1/G7 signoff inferred.
