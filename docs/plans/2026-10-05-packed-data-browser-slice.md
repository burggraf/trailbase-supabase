# Bounded packed data browser slice

## Approved scope and implementation

Extend Task 6 only with a minimal accessible data-only todos UI and a dedicated three-engine packed-SDK browser suite. Keep full `test:e2e` / `test:package` incomplete. No auth UI, bundler, dependency, schema or server changes. Preserve existing native/reference proof routes byte-for-byte and do not edit the package checker or its consumer.

- The UI accepts an explicit client and owner bootstrap; labels, visible errors and disposal are required. Support existing single-record CRUD, six-filter/order/page/read cardinality controls only.
- The dedicated fixture scope builds/packs, validates the archive, clean-installs offline into the owned run directory and serves only installed SDK/native ESM files plus the public example. Inspect native imports first; use a complete minimal import map if no transitive static imports exist.
- Playwright Chromium/Firefox/WebKit use generated confirmed ordinary A/B fixture users. Bearer-only fixture bootstrap stays private; never expose admin keys or claim signup/auth application coverage. Real successful data responses are not mocked.

## Tests and acceptance

- Test-first unit guards for installed module copying/import readiness and accessible UI behavior where useful; constructor/query failures must produce visible errors without unsafe writes.
- Browser UI create/read/update/delete, scalar filters, explicit tie-breaker ordering/pages and single/maybeSingle. Verify default null mutations through packed client calls, fresh execution and validation zero requests.
- A/B isolation, foreign update/delete errors and unchanged complete target/control rows/audits; explicit owned row cleanup and UI listener disposal even after failure.
- Sanitized source/pin/result evidence only; no token/network-body diagnostics in stdout/artifacts. Full real Supabase browser differential coverage, auth flows, packed release/coverage layers remain explicit missing work if not executed here.
- Run focused units/build/types. Start the authored browser suite only when setup/run/teardown fits the remaining bounded session; otherwise hand off the ready command without launching resources. No signoff inferred.
