# Phase A bounded transport/auth proofs

## Authorization and scope

The maintainer selected these investigations in interview `ab54f7fd-4ad9-4a45-8b63-afe09a7ff19d`:

- Buffered Fetch/SSE proof with persistent sequence tracking.
- Preserve native owner-only delivery; document stronger DELETE security as a **proposed** compatibility deviation.
- Isolated auth epoch/single-flight proof using genuine native responses.
- Keep both installed-client upstream reports as drafts; no submission authorized.

This is not final G5/G6/G7 approval, deployment permission, Phase B implementation or SDK signoff. Raw installed-client and reference isolation regressions remain strict and failing. No gateway, fork, production SDK, fake auth response or fabricated Supabase session is introduced.

## Streaming proof

`tests/proofs/native-sse.ts` is a test-only async generator over a native response body. It retains UTF-8/frame/sequence state between chunks, reports gaps and explicit loss, bounds the pending buffer, rejects malformed/truncated/unsafe-scalar inputs, and propagates abort/consumer cancellation. It accepts LF/CRLF and multiline data/comment frames. Bare-CR general SSE, reconnection, duplicate suppression, replay, browser integration, per-stream server resources and all event-schema guarantees are not implemented.

The 64Ki UTF-16 pending-buffer ceiling is a deliberate proof constraint, not a negotiated production limit. Unsafe integer JSON is rejected, not silently rounded or advertised as a full event codec. Deterministically split unit fixtures prove parser behavior; byte-rechunking a genuine live stream proves this decoder can consume those live events. Neither is evidence of actual TCP/proxy/browser fragmentation or a complete network fault corpus.

## Auth coordination proof

`tests/proofs/auth-coordination.ts` owns a test-only cache of genuine native tokens. Epoch checks occur **after** asynchronous response JSON completes. Logout advances the epoch and clears locally before remote I/O; stale login/refresh/status operations cannot commit into the changed epoch. Simultaneous explicit refresh callers share a promise; a completed old promise cannot clear a newer slot. Native refresh retains its original actual refresh credential as characterized.

This is not a transparent patch to the installed native client: raw `initClient` failures remain. It is not a Supabase-shaped auth API, session/user mapping, automatic refresh scheduler, cookie/SSR facility or storage layer. Real response/body gates and controlled transport faults are fixtures, not fake successful sessions or proof of real network outages. Storage/cross-tab, account-switch/JSON-failure/revocation/expiry/error matrices and browser/native resource checks still need completion.

## Security direction

The intended direction is **never** to weaken native read rules to mimic reference DELETE key exposure. Native owner isolation remains required; DELETE payload projection must retain only declared keys. The reference two-owner DELETE failure stays visible as an unapproved compatibility/security limitation. This direction does not certify a channel implementation or release exception.

## Commands and evidence

- `npm run test:unit`: proof parser/property/cancellation guards plus existing harness checks.
- `npm run test:phase-a -- proofs`: genuine native response/stream proof cases, separate from raw regressions.
- `npm run test:phase-a -- auth-lifecycle` and `-- streaming`: retain raw failing baselines.
- `npm run test:phase-a`: complete upstream harness remains red until all blockers are resolved; SDK-wide commands remain deliberately incomplete.

Results, source hashes, missing checks and signoff state live in [PROGRESS.md](PROGRESS.md) and `progress.json`. A green proof subset is not a green full foundation or compatibility release.
