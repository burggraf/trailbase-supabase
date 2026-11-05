# Daylist: sample-only unfinished SDK preparation

## Scope and ownership

Bounded, single-writer example/test/docs change after Core result checkpoint `d6a4a32`. No SDK implementation, public wiring/export, dependency, schema, provisioning, deployment, restart, exposure, live data or fixture change. Existing running demo assets are independent startup copies; retain their exact bytes. No backend/browser-against-backend run is assigned. Real qualification requires a fresh explicit handoff. Auth/CRUD/manual refresh remain the supported application path; deferred Storage/Realtime are not promoted into the MVP compatibility matrix.

## Agreed/provisional consumer contract

Storage READ-ONLY confirmation: lane HEAD `34725111c4f3cddac93b8a14522d2ad9dbb136d1`. Neither feature is exported by the current SDK.

```js
client.storage.from('attachments').upload(path, blob)
client.storage.from('attachments').download(path)
client.channel(name)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, callback)
  .subscribe(statusCallback)
await channel.unsubscribe() // 'ok' or 'error'
```

- Proposed awaited upload result: `{data:{id,path,fullPath},error:null}`; `id` is opaque genuine backing-record ID, path exact logical key, fullPath `attachments/` + path, never a URL. Download: `{data:Blob,error:null}`. Operational failure `{data:null,error}`; invalid/unsupported inputs reject. Error normalization remains undecided; UI renders no raw errors and fabricates no statuses/codes.
- Sample convention only: `daylist/<lowercase canonical UUIDv4>.bin` (48 ASCII bytes), never File.name. Input is not trimmed/normalized/decoded. This is not a general SDK path validator or uniqueness guarantee. Future backend requires dedicated globally UNIQUE(path) create/read-only rows with server-autofilled owner and native owner rules; do not provision or alter todos.
- No options, list/remove/overwrite/public/signed URLs. Lost/unverified outcomes may have effects and reserve the path: no automatic retry, replay, delete or overwrite. Suppress repeat attempts for that path within the current view, without claiming cross-session uniqueness.
- Acknowledgement is visibly unverified. Only a fresh SDK download, actual Blob, exact size and complete byte comparison with immutable input can show **Read-back bytes match selected file**. No generic verified-upload/durability/owner-continuity/cleanup badge. Two public calls and Blob cannot bind record/generation or prove the same Core owner; private A is not public adoption. Real0359 upload200/download500 remains failed.
- Sample size restriction bounds UI comparison only, not an asserted SDK/native limit. Blob MIME is observed, not promised; no content execution/preview. Download is an SDK Blob and user-initiated local save link, never raw record/file HTTP or invented URL APIs. Revoke owned object URLs.
- Realtime is opt-in only after method detection, not automatic connection/reconnection. Treat payloads only as invalidation, coalescing one dirty flag, one timer and one in-flight refresh with a fixed delay; defer while editing/modal/busy, preserve filter/page/focus and never steal newly moved focus. Manual Refresh remains available after terminal/error/unavailable states. No event-row synthesis, replay, old-row semantics, Broadcast or Presence.
- Retire UI callbacks on disposal/auth-view replacement, including same-user SIGNED_IN notifications without reading/caching tokens. Awaited UI teardown is not Storage/Core cleanup proof; inspect unsubscribe 'ok'/'error' and preserve pending/unconfirmed outcomes. Do not add auth listeners, token stores or owner-currentness claims.
- Realtime READ-ONLY confirmation at `09b1b9716adb7d15d92d0cdc491c395dea8e9fe8` (thread position2199): on/subscribe synchronously return the same single-use channel, one binding before subscribe; unsubscribe is a stable sticky Promise<'ok'|'error'>. Status callback `(status,error?)`: SUBSCRIBED/CLOSED/CHANNEL_ERROR/TIMED_OUT. SUBSCRIBED is accepted stream startup, not a snapshot/barrier: invalidate once there as well as on notifications. Callback return values are ignored/not awaited, so sample owns started refetches separately. SDK candidate startup10s/cleanup1s are not sample options. 'error' can include earlier subscription failure and does not prove open resources. Public client.channel remains a provisional, absent wiring assumption; no lane implementation is merged.

## Test contract before implementation

| IDs | Layer and measurable checks |
|---|---|
| DL-ST01 | Unit + actual mocked DOM: absent/partial Storage shows UNAVAILABLE, creates no raw/native calls, remains disabled through task refresh. |
| DL-ST02 | Unit + mocked DOM: immutable Blob exact-size/full-byte comparison including empty, mismatch and non-Blob; exact two-argument upload/download shape and logical path; acknowledgement remains unverified until held read-back completes. |
| DL-ST03 | Mocked DOM: upload error/lost reply/download failure/mismatch/invalid acknowledgement stay unverified, sanitized, no retry/remove/overwrite; same-path replay suppressed; invalid/sample-oversize input dispatches nothing. |
| DL-ST04 | Unit modeled Blob-read failure drains both accepted reads; mocked DOM disposal/auth replacement suppresses stale publication and follow-up download, pending UI work remains pending; object URLs revoked; no inline content. |
| DL-RT01 | Mocked DOM: absent/partial API unavailable; opt-in exact fluent calls; status errors/unsubscribe error or rejection visible/returned as unconfirmed, no auto-reconnect. |
| DL-RT02 | Mocked DOM: bursts during held refresh cause at most one coalesced follow-up; filter/page/checkbox focus preserved, moved focus not stolen; editing/modal defers refresh without losing drafts. |
| DL-RT03 | Mocked DOM: dispose/auth replacement seals callbacks/timers synchronously, joins started refresh and unsubscribe; repeated stop stable, 'error' not treated as 'ok'. |
| DL-REG01 | Existing unit app/launcher flows + mocked DOM signup/login, add/edit/complete/filter/page/delete confirmation/manual refresh/logout; automatic invalidation must preserve unconfirmed-write diagnostics until explicit manual reconciliation. No backend compatibility claim. |
| DL-PKG01 | Both pinned Nodes22.23.2/24.21.0: full check/unit, unchanged SDK module/global coverage and package checks; mock browser config Chromium/Firefox/WebKit1worker/retries0/60s per case/600s command. Source/config/report hashes retained. |

Mock UI pages import actual example code into isolated blank browser pages with HTTP(S) network requests aborted; local Blob URLs remain browser-owned so their bytes/revocation are actually checked. Injected in-memory clients and every positive feature state are explicitly **MOCK**, not genuine verification. No backend, native server, Docker, mail, deployment or existing-demo navigation. Existing real SDK/browser/app/security/database/contract gates are **not run/not replaced**; applicable real follow-up remains blocked on fresh handoff and future public wiring. No layer is waived or signed off.

New tests and this plan must precede implementation. Preserve failing reports and later corrections separately. Review checkpoint must report exact executed counts and missing layers, not call mocks or old source passes current real qualification.
