import { expect, it } from 'vitest';

it('L1-27/E13 cleanup attempts every later owner/logout/route step and preserves primary plus cleanup failures', async () => {
  const { withCleanup } = await import('../sdk-browser/cleanup.js');
  const primary = new Error('Original test failure'), disposal = new Error('Disposal failed'), rows = new Error('A cleanup failed');
  const calls: string[] = [];
  let failure: unknown;
  try {
    await withCleanup(async () => { calls.push('acquire A'); throw primary; }, [
      async () => { calls.push('dispose'); throw disposal; },
      async () => { calls.push('A rows'); throw rows; },
      async () => { calls.push('A logout'); },
      async () => { calls.push('B rows'); },
      async () => { calls.push('B logout'); },
      async () => { calls.push('routes'); },
    ]);
  } catch (error) { failure = error; }
  expect(calls).toEqual(['acquire A', 'dispose', 'A rows', 'A logout', 'B rows', 'B logout', 'routes']);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([primary, disposal, rows]);
  expect((failure as AggregateError).cause).toBe(primary);
});
it('L1-27/E13 cleanup retains a primary failure unchanged when cleanup succeeds', async () => {
  const { withCleanup } = await import('../sdk-browser/cleanup.js');
  const failure = new Error('Original');
  await expect(withCleanup(async () => { throw failure; }, [async () => {}])).rejects.toBe(failure);
});
it('L1-27/S10 exact owned-row cleanup never deletes an unrelated row and continues later keys', async () => {
  const { cleanupOwnedRows } = await import('../sdk-browser/cleanup.js');
  const deleted: string[] = [];
  const records = {
    list: async (options?: { filters?: { value: string }[] }) => ({ records: options?.filters ? [{ id: options.filters[0].value, user_id: options.filters[0].value === 'first' ? 'other-owner' : 'owned' }] : [] }),
    delete: async (id: string) => { deleted.push(id); },
  };
  await expect(cleanupOwnedRows(records, 'owned', ['first', 'second'])).rejects.toBeInstanceOf(AggregateError);
  expect(deleted).toEqual(['second']);
});
it('L1-27/E13 an early exact-key delete failure does not prevent later key cleanup', async () => {
  const { cleanupOwnedRows } = await import('../sdk-browser/cleanup.js');
  const deleted: string[] = [];
  const records = {
    list: async (options?: { filters?: { value: string }[] }) => ({ records: options?.filters ? [{ id: options.filters[0].value, user_id: 'owned' }] : [] }),
    delete: async (id: string) => { deleted.push(id); if (id === 'first') throw new Error('First delete failed'); },
  };
  await expect(cleanupOwnedRows(records, 'owned', ['first', 'second'])).rejects.toBeInstanceOf(AggregateError);
  expect(deleted).toEqual(['first', 'second']);
});
