import type { createAuth } from '../../src/auth.js';

// Internal source consumer only: not a package export or public client/auth option.
type CapturedRecordOperation = {
  readonly signal: AbortSignal;
  assertCurrent(): void;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
};
async function consumeInternal(auth: ReturnType<typeof createAuth>) {
  const preparing: Promise<CapturedRecordOperation> = auth.recordOperation(); // Invoke before awaiting readiness.
  const lease = await preparing;
  const actual = await auth.recordOperation();
  // @ts-expect-error The actual internal declaration must not allow replacing its lifetime signal.
  actual.signal = new AbortController().signal;
  const signal: AbortSignal = lease.signal;
  const response: Response = await lease.fetch('/api/records/v1/todos');
  const parsed: unknown = await response.json();
  lease.assertCurrent();
  const cleanup: Promise<void> = lease.dispose();
  await cleanup;
  void signal; void parsed;
  // @ts-expect-error No acquisition or cleanup-bypass options.
  auth.recordOperation({ skipCleanup: true });
  // @ts-expect-error No parallel opener or token access.
  lease.token;
  // @ts-expect-error No renewal/rebinding method.
  lease.refresh();
  // @ts-expect-error No disposal timeout/capability option.
  lease.dispose({ timeout: 1 });
}
void consumeInternal;
