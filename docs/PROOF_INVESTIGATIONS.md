# Phase A bounded transport/auth proofs

## Authorization and scope

The maintainer selected these investigations in interview `ab54f7fd-4ad9-4a45-8b63-afe09a7ff19d`:

- Buffered Fetch/SSE proof with persistent sequence tracking.
- Preserve native owner-only delivery; document stronger DELETE security as a **proposed** compatibility deviation.
- Isolated auth epoch/single-flight proof using genuine native responses.
- Keep both installed-client upstream reports as drafts; no submission authorized.

This is not final G5/G6/G7 approval, deployment permission, Phase B implementation or SDK signoff. Raw installed-client and reference isolation regressions remain strict and failing. No gateway, fork, production SDK, fake auth response or fabricated Supabase session is introduced.

## Streaming proof

`tests/proofs/native-sse.ts` is a test-only async generator over a native response body. It retains UTF-8/frame/sequence state between chunks, reports gaps and explicit loss, bounds the pending buffer, rejects malformed/truncated/unsafe-scalar inputs, and propagates abort/consumer cancellation. It accepts LF/CRLF and multiline data/comment frames. Bare-CR general SSE, reconnection, duplicate suppression, replay, production/browser-SDK lifecycle integration, per-stream server resources and all event-schema guarantees are not implemented.

The 64Ki UTF-16 pending-buffer ceiling is a deliberate proof constraint, not a negotiated production limit. Unsafe integer JSON is rejected, not silently rounded or advertised as a full event codec. Deterministically split unit fixtures prove parser behavior; byte-rechunking a genuine live stream proves this decoder can consume those live events. Neither is evidence of actual TCP/proxy/browser fragmentation or a complete network fault corpus.

Three additional live probes exercise a 64-event producer burst before the consumer starts reading (all actual IDs/order/owner/sequence must survive), a genuine unsafe-integer event that must fail visibly without rounding the stored bigint, and a genuine >64Ki frame that must trip the declared proof ceiling and release the reader while preserving the database row. This is a bounded pressure/codec/resource subset, not a production backpressure policy, arbitrary slow-consumer guarantee or server-internal resource accounting.

## Auth coordination proof

`tests/proofs/auth-coordination.ts` owns a test-only cache of genuine native tokens. Epoch checks occur **after** asynchronous response JSON completes. Logout advances the epoch and clears locally before remote I/O; stale login/refresh/status operations cannot commit into the changed epoch. Simultaneous explicit refresh callers share a promise; a completed old promise cannot clear a newer slot. Native refresh retains its original actual refresh credential as characterized.

This is not a transparent patch to the installed native client: raw `initClient` failures remain. It is not a Supabase-shaped auth API, session/user mapping, automatic refresh scheduler, cookie/SSR facility or storage layer. Real response/body gates and controlled transport faults are fixtures, not fake successful sessions or proof of real network outages. Storage/cross-tab, account-switch/JSON-failure/revocation/expiry/error matrices and browser/native resource checks still need completion.

## Genuine auth failure and JSON transport boundaries

Additional bounded proof cases revoke the proof's actual native refresh credential through the real logout endpoint, then require one shared genuine HTTP 401 to clear local cache and allow recovery only through a fresh genuine login. A held old account's actual 401 must not clear a newer account's cache or its pending flight. An owned loopback HTTP fixture forwards a real successful refresh response, destroys the connection after 32 original JSON bytes, and requires both shared waiters to fail observably, preserving only the prior genuine cache and freeing the slot for real retry. No session, response status or JSON body is fabricated. This does not prove rotating-refresh-provider parity, arbitrary network retry policy, expiry timers or complete storage/resource enforcement.

## Security direction

The intended direction is **never** to weaken native read rules to mimic reference DELETE key exposure. Native owner isolation remains required; DELETE payload projection must retain only declared keys. The reference two-owner DELETE failure stays visible as an unapproved compatibility/security limitation. This direction does not certify a channel implementation or release exception.

## Browser execution and setup diagnostics

The fixture compiles the two type-erased proof modules with the already pinned TypeScript tool and serves them from its owned loopback public directory. The installed pinned reference SDK UMD is copied only to that disposable directory for upstream browser characterization; no new dependency, bundle or production adapter is introduced. Browser cases dynamically import those modules, exercise genuine Unicode SSE/write/delete/abort plus late-refresh/logout guards, and return boolean postconditions—not credentials/session bodies. Chromium/Firefox/WebKit each run the proof case alongside existing real confirmation/login infrastructure tests. This is proof browser execution, not complete SDK/application E2E or a package build.

Sanitized reports include constant-valued `setupStage`/`setupCheck` checkpoints (config/build/start/loopback/service-count/image-tag/digest/ready), so setup failures are not mistaken for backend assertions. An allowlisted setup inventory exposes only known service labels, public Supabase ECR image references/digests and a `loopbackOnly` boolean; unknown reference formats become fixed placeholders. Container names, credentials, raw host ports, bodies, logs and exceptions remain private. Digest and loopback validators remain strict and unchanged. Standalone browser, explicit expiry and fault-cleanup CI steps run even when default stock regressions fail; the job stays red when any required scope fails.

## Actual browser reference storage characterization

A fresh genuinely confirmed reference account signs in through the installed SDK in the browser. An owned per-test storage key must retain the genuine session across an actual document reload; `getUser()` and owner-protected row reads must validate it remotely. A second same-origin tab hydrates that store and must observe `SIGNED_OUT` after a real first-tab logout, with no remaining local session/storage or anonymous protected rows. A retained genuine refresh token must then be rejected by the real auth service without restoring local state. Only boolean postconditions leave browser evaluation. Automatic refresh is disabled deliberately: this does not certify timer/background-tab/retry or adapter persistence behavior. No fabricated sessions or storage bodies are injected.

## Owned HTTP fault fixture

`npm run test:phase-a -- network` uses an ephemeral Node standard-library server bound only to `127.0.0.1`, with an unguessable per-test route. This is a disposable test fault fixture, not an architecture gateway. It forwards a genuine owned native stream's bytes/status/content type, not auth/cookie response headers or fabricated events. Requests outside its one GET route are denied.

The fragment case spaces real byte writes across event-loop turns; the receiver asserts that it actually observed multiple HTTP chunks while preserving native Unicode INSERT/UPDATE/DELETE. It does not assert one byte per TCP packet or general WAN fragmentation. Consumer abort must cancel the upstream reader, drain active fixture handlers and close the listening socket. A second fixture destroys the connection after 32 genuine bytes; the proof decoder must surface a transport/truncation failure rather than yield a fabricated event. Server-internal subscription accounting and arbitrary proxy/browser/WAN behavior remain incomplete.

## Explicit real-expiry fixture

`npm run test:phase-a -- expiry` alone selects the owned `short-native-auth` profile, injecting a 3-second native JWT TTL into a fresh depot. Owner/context/report metadata retain the profile and `authVariant`; unknown/ambiguous profile inputs fail. Default and mitigation fixture lifetimes stay unchanged. Supabase configuration is not shortened and no reference expiry parity is claimed.

The expiry scope verifies genuine JWT lifetime, confirms initially protected access, waits under an 80-second bound until the real backend denies the original JWT (allowing actual server clock-skew grace), then performs a write with a freshly refreshed writer. The old stream must close or surface an observable forbidden error without delivering the new protected row. No JWT edit, fake clock, session synthesis or mere revocation substitute is used. This is a strict native expiry requirement under investigation, not an assertion that upstream already provides it. It is separate from the default `all` corpus and has its own required CI step.

A second case uses only standard `AbortSignal.timeout` against the genuine JWT's `exp` to close a proof reader locally. It must abort visibly/release the lock at the same-host nominal deadline, subsequently observe actual HTTP denial including server grace, preserve a fresh authenticated writer's row, and emit nothing from the closed reader. The original server-expiry assertion remains strict and failing. This is a client-only safety proof—not server authorization enforcement, clock-skew negotiation, background-browser scheduling, automatic renewal/reconnection, revocation enforcement or a release-approved policy.

## Commands and evidence

- `npm run test:unit`: proof parser/property/cancellation guards plus existing harness checks.
- `npm run test:phase-a -- proofs`: genuine native response/stream proof cases, separate from raw regressions.
- `npm run test:phase-a -- expiry`: explicitly labelled short-lived owned native fixture and genuine wall-clock expiry.
- `npm run test:phase-a -- network`: actual owned HTTP fragment/disconnect/cancellation postconditions.
- `npm run test:phase-a -- auth-lifecycle` and `-- streaming`: retain raw failing baselines.
- `npm run test:phase-a`: complete upstream harness remains red until all blockers are resolved; SDK-wide commands remain deliberately incomplete.

Results, source hashes, missing checks and signoff state live in [PROGRESS.md](PROGRESS.md) and `progress.json`. A green proof subset is not a green full foundation or compatibility release.
