import { expect, it } from 'vitest';
import * as app from '../../examples/todos/app.js';

it('E08 mutation failures distinguish auth/rejection from uncertain outcomes without backend details', () => {
  const message = Reflect.get(app, 'taskMutationErrorMessage');
  const unsafe = { message: 'private-canary', code: 'private-canary', details: 'other-owner-title', hint: 'private-canary' };
  for (const [status, code] of [[401, 'TASK_AUTH_REQUIRED'], [403, 'TASK_FORBIDDEN'], [400, 'TASK_REJECTED'], [409, 'TASK_REJECTED'], [422, 'TASK_REJECTED'], [429, 'TASK_RATE_LIMITED'], [408, 'TASK_OUTCOME_UNKNOWN'], [503, 'TASK_OUTCOME_UNKNOWN']] as const) {
    const text = message({ ...unsafe, status });
    expect(text).toContain(`HTTP ${status}; ${code}`);
    expect(text).not.toMatch(/private-canary|other-owner-title|already exists|duplicate/i);
    if ([400, 401, 403, 409, 422, 429].includes(status)) expect(text).not.toContain('may already have been saved');
    else expect(text).toContain('may already have been saved');
  }
  expect(message(new Error('private-canary'))).toContain('TASK_OUTCOME_UNKNOWN');
  expect(message({ status: 401 }, true)).toContain('TASK_SAVED_REFRESH_FAILED');
  expect(message({ status: 401 }, true)).toContain('Your change was saved');
  for (const status of ['401', 401.5, -1, 600, NaN, Infinity]) expect(message({ ...unsafe, status })).not.toContain('HTTP');
});

it('L1-05–13/E04 UI uses only supported select(*), bounded server pagination and completion filters', async () => {
  const calls: Record<string, unknown>[] = [];
  const client = { from(table: string) {
    const call: Record<string, unknown> = { table, orders: [] }; calls.push(call);
    const query = {
      select(fields: string) { call.fields = fields; return query; },
      eq(field: string, value: boolean) { call.filter = [field, value]; return query; },
      order(field: string, options?: unknown) { (call.orders as unknown[]).push([field, options]); return query; },
      range(start: number, end: number) { call.range = [start, end]; return query; },
      limit(limit: number) { call.limit = limit; return query; },
      then(resolve: (value: unknown) => unknown) {
        if (call.fields !== '*') throw new Error('Only select(*) is supported by the frozen SDK');
        const length = 21;
        return Promise.resolve({ data: Array.from({ length }, (_, id) => ({ id: String(id) })), error: null }).then(resolve);
      },
    }; return query;
  } };
  const result = await Reflect.get(app, 'loadTaskPage')(client, { table: 'todos', filter: 'completed', page: 1, pageSize: 20 });
  expect(result.rows).toHaveLength(20); expect(result.hasMore).toBe(true);
  expect(result).not.toHaveProperty('counts');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ table: 'todos', fields: '*', filter: ['completed', true], orders: [['created_at', { ascending: false }], ['id', undefined]], range: [20, 40] });
});

it('L1-05–13/E08 UI invalid bounds/filters and failed reads cannot produce fabricated success', async () => {
  const load = Reflect.get(app, 'loadTaskPage'); let requests = 0;
  const client = { from() { requests++; throw new Error('Must not query'); } };
  for (const options of [{ filter: 'unknown' }, { page: -1 }, { page: 1.5 }, { page: Number.MAX_SAFE_INTEGER }, { pageSize: 0 }, { pageSize: 51 }]) {
    await expect(load(client, { table: 'todos', filter: 'all', page: 0, pageSize: 20, ...options })).rejects.toThrow();
  }
  expect(requests).toBe(0);
  const error = new Error('Read failed');
  const failed: any = { select: () => failed, eq: () => failed, order: () => failed, range: () => failed, limit: () => failed, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error }).then(resolve) };
  await expect(load({ from: () => failed }, { table: 'todos', filter: 'all', page: 0, pageSize: 20 })).rejects.toBe(error);
});
