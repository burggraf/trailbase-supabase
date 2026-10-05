type CleanupStep = () => Promise<unknown>;

export async function withCleanup(body: CleanupStep, cleanup: CleanupStep[]): Promise<void> {
  let failed = false, primary: unknown;
  try { await body(); } catch (error) { failed = true; primary = error; }
  const errors: unknown[] = [];
  for (const step of cleanup) {
    try { await step(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(failed ? [primary, ...errors] : errors, 'Browser data test/cleanup failures', { cause: primary });
  if (failed) throw primary;
}

type Records = {
  list(options?: { filters?: { column: string; value: string }[]; pagination?: { limit: number } }): Promise<{ records: Record<string, unknown>[] }>;
  delete(id: string): Promise<unknown>;
};
export async function cleanupOwnedRows(records: Records, owner: string, ids: string[]): Promise<void> {
  const errors: unknown[] = [];
  for (const id of ids) {
    try {
      const rows = (await records.list({ filters: [{ column: 'id', value: id }], pagination: { limit: 1 } })).records;
      if (!rows.length) continue;
      if (rows.length !== 1 || rows[0].id !== id || rows[0].user_id !== owner) throw new Error('Refusing non-owned cleanup target');
      await records.delete(id);
    } catch (error) { errors.push(error); }
  }
  try { if ((await records.list({ pagination: { limit: 1000 } })).records.length) throw new Error('Fixture rows remain after exact owned cleanup'); }
  catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'Owned row cleanup failures');
}
