# Auth slice 1: development-only password login and memory

Approved L1-14/15 and in-memory L1-16 only, after parent data checkpoint f065cc08. Read full auth advisory and installed native register/login/constructor/fetch flows before code. Keep native client tokenless; separate auth HTTP and adapter-owned generation/session at the record transport boundary. No persistence, hydration, refresh, timers, notifications, live getUser, logout, auth app or G1/G7 fix/signoff.

## Contract before implementation

- Email/password own-field credentials only. signUp posts native password_repeat; returns genuine null user/session, not an approved compatibility exception. No automatic login/verification or retry.
- signInWithPassword validates native credentials, JWT structure/UUID/email/time claims before installing cloned memory state. Cached claims are not server authorization. Failed replacement preserves existing state; later login generation invalidates older response, including delayed JSON decode.
- Argument-free getSession returns a defensive cached memory snapshot, not live validation. Record dispatch uses current bearer only through existing tokenless native client; omit cookies/refuse redirects. No refresh/CSRF record headers or native session machinery.
- Memory auth must explicitly select persistSession:false and autoRefreshToken:false. Explicit unsupported/default-true settings fail before wire. Omitted auth keeps data-only factory usable, but auth operations fail unsupported rather than silently changing approved defaults.
- Genuine narrow public User/Session/response/options signatures; deferred lifecycle methods explicitly unsupported. Unsupported metadata, phone, JWT overloads/options rejected with zero requests.

## Tests and checkpoint criteria

Test first unit/type: exact registration wire/null state; valid login/map/issuance lifetime/bearer; malformed JWT/credentials/claims/MFA; actionable HTTP/fault/redirect failures; failed replacement; delayed decode/login races; defensive state copies; client isolation; unsupported inputs/settings/deferred methods zero requests. Preserve existing data units/build/types/package/browser graph guards after source split; ship all actual emitted modules without extra dependencies.

Author dedicated owned sdk-auth integration suite: fresh adapter signup/real confirmation/login and reference direction, owner CRUD/A/B/anonymous isolation, failed replacement and exact owned cleanup. Do not launch unless bounded setup-through-teardown is safe; parent owns final full real controls. Full browser persistent/auth app, shared-reference race/security/fault/property/coverage/package Node22/24 and CI/release layers remain mandatory and incomplete, not N/A. G1 duplicate/SMTP and G7 strict failures retained.

Checkpoint acceptance is code + focused units/types/build evidence only, not auth compatibility or release signoff. Update README/matrix/ledger with exact partial domain and missing layers. No commits/publishing/backend changes.
