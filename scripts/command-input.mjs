// Fixture-only opaque snapshot; never put payload bytes in launch JSON, receipts or logs.
export const commandInputLimit = 1048576;
export function snapshotCommandInput(input, limit = commandInputLimit) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > commandInputLimit || !(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer || input.byteLength > limit) throw new Error('Invalid original command input/bound');
  return Buffer.from(input);
}
