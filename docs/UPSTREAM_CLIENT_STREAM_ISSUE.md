# Draft: trailbase@0.14.3 SSE parser loses fragmented frames and cross-chunk sequence gaps

**Draft only, not submitted.** No credentials, tokens, private payloads or raw diagnostics are included. Deterministic parser replay is explicitly distinguished from real network behavior.

## Environment and evidence

- `trailbase@0.14.3`, real TrailBase v0.34.3, Node 22.23.2, macOS arm64.
- [Streaming tests](../tests/phase-a/streaming.test.ts), [sanitized report](evidence/phase-a-stream-isolation-node22.json).
- [Installed distribution](https://unpkg.com/trailbase@0.14.3/dist/index.js): `subscribeImpl` decodes each chunk independently, splits it into frames without an inter-chunk buffer, and declares `prevSeq` inside each transform invocation.

## Reproduction A — captured UTF-8 event fragmentation

1. Confirm/log in an owned account and subscribe through the installed client to its real `todos` API.
2. Create a real row whose title contains Unicode, combining marks and reserved characters; capture the delivered native INSERT event. Real update/delete postconditions and reader cleanup are also checked.
3. Replay that captured event at the installed transport boundary as one complete SSE frame: the original event is preserved.
4. Replay the same encoded frame in one-byte chunks: parsing fails or loses the event.

The replay response is a deterministic parser fixture, not proof that a particular live network actually generated those boundaries. Transport chunk boundaries must not be assumed to align with SSE frames or UTF-8 characters.

## Reproduction B — loss state resets across chunks

1. Add explicit synthetic sequence metadata `100` and `102` to two captured real payloads.
2. Deliver the two complete frames in one chunk: one `onLoss` callback occurs.
3. Deliver the same frames in separate whole-frame chunks: both events are delivered but zero `onLoss` callbacks occur.
4. An explicit synthetic loss-status error still produces a callback.

The sequence metadata/error signal is synthetic and tests the installed parser only; it does not demonstrate native server packet loss or validate a replacement transport.

## Expected behavior

Preserve UTF-8 decoding and incomplete-frame state across chunks; track previous sequence across transform invocations and surface loss consistently. Cancellation, malformed frames, backpressure and server/network/browser behavior require their own tests. The project has not implemented or approved a replacement decoder.

## Reproduction repository

See [setup](../README.md); run `npm run test:phase-a -- streaming` in this repository. Parser-defect characterization passes by documenting the observed deficiencies, not certifying stream reliability. The overall streaming scope remains red because a separate strict reference Supabase DELETE-owner-isolation case fails; native owner isolation passed in this fixture. That reference limitation is not the subject of this native-client report.
