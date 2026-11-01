# Clean-checkout documentation readiness

## Priority update: actual pushed CI package failure

Pushed checkpoint55dfaa2 run41324363569 failed both Node packed-consumer jobs at `clean-install`; SDK/research fixture jobs were consequently skipped, not green. The first archive-only local attempt lacked a Git index and failed source-hash initialization: preserve it as a setup error, not reproduction. After deliberately creating an owned index in the isolated copy, fresh-cache reproduction matched CI clean-install: ENOTCACHED for uuid14.0.3. Pinned trailbase0.14.3 declares uuid^14.0.2, whereas the unchanged lock/cache baseline contains14.0.2. Warm VPS cache hid registry-metadata patch drift. Compiler/devtool-metadata speculation was not the cause.

Use consumer-only exact overrides derived from the existing lock's native runtime graph in both actual offline consumers. Verify installed versions and generated consumer-lock integrities against the unchanged root lock; do not warm newer14.0.3, upgrade root dependencies, copy repository node_modules or relax offline/no-script/clean-install/transport/type assertions. Unit red/green for exact selection and version/integrity mismatch; real same-cold-cache Node22/24 package regression and pure packed-browser-asset preparation (no backend startup). Preserve private raw failures and publish only classified outcomes. Push the fix and inspect the actual new CI, not historical runs.

The already-started small documentation guard below remains in the same bounded reproducibility checkpoint; no additional features/backend matrix.

## Bounded next milestone

After the reviewed CRUD/auth/todos checkpoint is pushed, strengthen existing static CI rather than duplicate its already-added focused SDK/package/app jobs. Remote baseline run37386586310 passed both Node unit jobs and failed the strict monolithic research job; preserve those failures. Read actual pushed CI status separately, never claim a queued run green.

Verified gap: check-docs validated links through workspace filesystem access. Historical PROGRESS screenshot links pointed into ignored artifacts that existed on the VPS but not a clean checkout; changed them to plain local paths before the first commit. A persistent guard should prevent recurrence.

## Contract and regression tests (L1-26/L1-27, documentation/infrastructure)

- Validate relative Markdown targets against the Git index inventory, not workspace existence. Ignored/untracked/generated files are not reproducible link targets.
- Check every indexed Markdown file, including examples and nested plans, not only root docs. Preserve current structure, syntax, traceability, evidence/secret checks and release-gate semantics.
- Reuse the existing link pattern/platform paths; no Markdown dependency/parser expansion, network fetching, SDK/auth/browser behavior or fixture changes.
- Red/green unit regressions: normal parent-relative tracked links and external/fragment links pass; absent/generated/escaping targets fail even if an ignored file really exists; staging a deliberate ordinary target makes it eligible. Use a generated disposable Git index fixture, never another project or live fixture.
- Verify static/docs and full units on both pinned Node runtimes plus clean packed consumers. Check staged inventory and secret boundaries before committing/pushing the bounded readiness checkpoint.
- Browser/backend/database/reference reruns add no runtime proof for this documentation-only guard; existing app evidence remains tied to its earlier source. Full gates, coverage, G1/G7/signoff remain incomplete, not waived/N/A.

## Live safety

No restart, new real-service stack, schema/data/security/network/credential change or package publication. Original app/proxies/owned lock remain live; original source-drift teardown diagnostic remains expected.
