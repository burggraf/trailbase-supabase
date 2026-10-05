import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmedTrailUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';
import type { createClient } from '../../src/index.js';

declare global { interface Window { sdkData?: { a: ReturnType<typeof createClient>; b: ReturnType<typeof createClient>; anonymous: ReturnType<typeof createClient>; calls: string[]; ui: { refresh(): Promise<void>; dispose(): void } } } }

test('L1-05–13/E04/E05/E06/E11/E13 packed data UI, permissions, zero-request guards and teardown (fixture auth only)', async ({ page }) => {
  const env = await context();
  type User = Awaited<ReturnType<typeof confirmedTrailUser>>;
  let a: User | undefined, b: User | undefined;
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const title = `browser-${randomUUID()}`;
  const firstTitle = `first-${title}-é&+`, secondTitle = `second-${title}`, tiedTitle = `tied-${title}`;
  const snapshot = async () => {
    const rows = [];
    for (const user of [a!, b!]) for (const table of ['todos', 'todo_audit']) rows.push((await user.client.records(table).list({ pagination: { limit: 1000 }, order: [table === 'todos' ? '+id' : '+audit_key'] })).records);
    return rows;
  };
  await withCleanup(async () => {
    a = await confirmedTrailUser(env, 'sdk-browser-a');
    b = await confirmedTrailUser(env, 'sdk-browser-b');
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await a.client.records('todos').create({ id: nativeUuid(ids[0]), user_id: a.user.id, title: `control-${title}`, priority: 0 });
    await b.client.records('todos').create({ id: nativeUuid(ids[1]), user_id: b.user.id, title: `foreign-${title}`, priority: 0 });
    await a.client.records('todos').create({ id: nativeUuid(ids[4]), user_id: a.user.id, title: tiedTitle, priority: 1, completed: 1 });
    await page.goto(`${env.trailUrl}/sdk-data/index.html`);
    const headers = [a, b].map(user => new Headers(user.client.headers()).get('authorization'));
    expect(headers.every(value => typeof value === 'string')).toBe(true);
    expect(await page.evaluate(async ({ base, headers, ownerId, ids }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const app: typeof import('../../examples/todos/app.js') = await import(`${base}/sdk-data/app.js`);
      const calls: string[] = [];
      const fields = { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } };
      const client = (authorization: string | null) => sdk.createClient(base, undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } }, global: { fetch: (input, init) => {
        const requestHeaders = new Headers(init?.headers);
        if (authorization) requestHeaders.set('authorization', authorization);
        if (requestHeaders.has('apikey') || requestHeaders.has('refresh-token') || requestHeaders.has('csrf-token')) throw new Error('Unexpected browser credential kind');
        calls.push(init?.method ?? 'GET');
        return fetch(input, { ...init, headers: requestHeaders, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      } } });
      const a = client(headers[0]), b = client(headers[1]), anonymous = client(null);
      const ui = app.mountTodos(document.querySelector('#todos'), a, { ownerId, makeId: () => ids.shift()!, pageSize: 2 });
      window.sdkData = { a, b, anonymous, calls, ui };
      await ui.refresh();
      return true;
    }, { base: env.trailUrl, headers, ownerId: canonicalUuid(a.user.id), ids: ids.slice(2, 4) })).toBe(true);
    for (const label of ['Filter field', 'Filter operator', 'Order field', 'Cardinality']) await expect(page.getByLabel(label, { exact: true })).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'Todo rows' })).toContainText(`control-${title}`);
    await expect(page.getByRole('list', { name: 'Todo rows' })).not.toContainText(`foreign-${title}`);
    for (const [index, createdTitle] of [firstTitle, secondTitle].entries()) {
      await page.getByLabel('New title', { exact: true }).fill(createdTitle);
      await page.getByLabel('New priority', { exact: true }).fill(String(index + 1));
      await page.getByRole('button', { name: 'Add todo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add todo', exact: true })).toBeEnabled();
      await expect(page.getByLabel('Mutation result')).toHaveText('Mutation data: null');
      const row = await a.client.records('todos').read(nativeUuid(ids[index + 2]));
      expect(row.completed).toBe(0); expect(row.note).toBeNull(); expect(row.title).toBe(createdTitle);
    }
    const tied = [{ id: ids[2], title: firstTitle, priority: 1 }, { id: ids[4], title: tiedTitle, priority: 1 }].sort((left, right) => left.id < right.id ? -1 : 1);
    const ordered = [{ id: ids[0], title: `control-${title}`, priority: 0 }, ...tied, { id: ids[3], title: secondTitle, priority: 2 }];
    const list = page.getByRole('list', { name: 'Todo rows' });
    const expectRows = async (rows: typeof ordered) => {
      await expect(list.getByRole('listitem')).toHaveText(rows.map(row => `${row.title} (priority ${row.priority})`));
    };
    const apply = async (field: string, operator: string, value: string, cardinality = 'many', descending = false) => {
      await page.getByLabel('Filter field', { exact: true }).selectOption(field);
      await page.getByLabel('Filter operator', { exact: true }).selectOption(operator);
      await page.getByLabel('Filter value', { exact: true }).fill(value);
      await page.getByLabel('Cardinality', { exact: true }).selectOption(cardinality);
      await page.getByLabel('Descending', { exact: true }).setChecked(descending);
      await page.getByRole('button', { name: 'Apply query', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Apply query', exact: true })).toBeEnabled();
    };
    const queryBefore = await snapshot();
    await apply('priority', 'eq', ''); await expectRows(ordered.slice(0, 2));
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expectRows(ordered.slice(2));
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expectRows([]);
    await page.getByRole('button', { name: 'Previous page', exact: true }).click(); await expectRows(ordered.slice(2));
    await apply('priority', 'eq', '', 'many', true);
    const descendingRows = [ordered[3], ...tied, ordered[0]];
    await expectRows(descendingRows.slice(0, 2));
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expectRows(descendingRows.slice(2));
    for (const [operator, matches] of [
      ['eq', tied], ['neq', [ordered[0], ordered[3]]], ['gt', [ordered[3]]],
      ['gte', [...tied, ordered[3]]], ['lt', [ordered[0]]], ['lte', [ordered[0], ...tied]],
    ] as const) {
      await apply('priority', operator, '1'); await expectRows(matches.slice(0, 2));
      await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expectRows(matches.slice(2));
      await expect(page.getByRole('alert')).toBeEmpty();
    }
    await apply('title', 'eq', firstTitle); await expectRows([ordered.find(row => row.id === ids[2])!]);
    await apply('completed', 'eq', 'true'); await expectRows([ordered.find(row => row.id === ids[4])!]);
    await apply('completed', 'eq', 'false'); await expectRows(ordered.filter(row => row.id !== ids[4]).slice(0, 2));
    for (const cardinality of ['single', 'maybeSingle']) {
      await apply('priority', 'eq', '1', cardinality); await expect(page.getByRole('alert')).not.toBeEmpty();
      await apply('priority', 'eq', '', cardinality); await expect(page.getByRole('alert')).not.toBeEmpty();
      await apply('priority', 'eq', '2', cardinality); await expectRows([ordered[3]]); await expect(page.getByRole('alert')).toBeEmpty();
    }
    await apply('priority', 'eq', '999', 'single'); await expect(page.getByRole('alert')).not.toBeEmpty();
    await apply('priority', 'eq', '999', 'maybeSingle'); await expectRows([]);
    await expect(page.getByRole('status', { name: 'Query status', exact: true })).toHaveText('Optional row absent');
    for (const [field, value] of [['completed', '1'], ['priority', 'NaN'], ['priority', '9007199254740992'], ['priority', '0.5']]) {
      const count = await page.evaluate(() => window.sdkData!.calls.length);
      await apply(field, 'eq', value); await expect(page.getByRole('alert')).not.toBeEmpty();
      expect(await page.evaluate(() => window.sdkData!.calls.length)).toBe(count);
    }
    expect(await snapshot()).toEqual(queryBefore);
    await apply('priority', 'eq', '');
    // The update target might be across the tied page boundary; isolate it explicitly.
    await apply('title', 'eq', firstTitle);
    const targetBefore = await a.client.records('todos').read(nativeUuid(ids[2]));
    const controlBefore = await a.client.records('todos').read(nativeUuid(ids[3]));
    await page.getByLabel('Update ID', { exact: true }).fill(ids[2]);
    await page.getByLabel('Updated title', { exact: true }).fill(`updated-${title}`);
    await page.getByRole('button', { name: 'Update todo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Update todo', exact: true })).toBeEnabled();
    await apply('title', 'eq', `updated-${title}`);
    await expect(page.getByRole('list')).toContainText(`updated-${title}`);
    expect(await a.client.records('todos').read(nativeUuid(ids[2]))).toEqual({ ...targetBefore, title: `updated-${title}` });
    expect(await a.client.records('todos').read(nativeUuid(ids[3]))).toEqual(controlBefore);
    const beforeDenied = await snapshot();
    expect(await page.evaluate(async id => {
      const { a, b, anonymous, calls } = window.sdkData!;
      if ((await b.from('todos').select().eq('id', id)).data?.length !== 0 || !(await anonymous.from('todos').select()).error) return false;
      for (const query of [b.from('todos').update({ title: 'forbidden' }).eq('id', id), b.from('todos').delete().eq('id', id)]) if ((await query).error?.status !== 403) return false;
      const count = calls.length;
      const table = a.from('todos');
      for (const invoke of [() => Reflect.apply(table.insert, table, [[]]), () => table.update({ id }), () => table.delete().eq('id', id).eq('title', 'extra'), () => Reflect.apply(table.select, table, ['*', { head: true }]), () => table.select().eq('priority', new Date())]) { let rejected = false; try { invoke(); } catch { rejected = true; } if (!rejected) return false; }
      if (!(await table.delete()).error || calls.length !== count) return false;
      const read = table.select().eq('id', id); await read; await read;
      return calls.length === count + 2;
    }, ids[0])).toBe(true);
    expect(await snapshot()).toEqual(beforeDenied);
    await page.getByLabel('Delete ID', { exact: true }).fill(ids[2]);
    await page.getByRole('button', { name: 'Delete todo', exact: true }).click();
    await expect(page.getByRole('list')).not.toContainText(`updated-${title}`);
    expect((await a.client.records('todos').list({ filters: [{ column: 'id', value: nativeUuid(ids[2]) }] })).records).toEqual([]);
    const audit = (await a.client.records('todo_audit').list({ pagination: { limit: 1000 }, order: ['+audit_key'] })).records;
    expect(audit.filter(row => row.todo_id === nativeUuid(ids[2])).map(row => row.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
    const stoppedCount = await page.evaluate(() => { const state = window.sdkData!; state.ui.dispose(); return state.calls.length; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    expect(await page.evaluate(() => window.sdkData!.calls.length)).toBe(stoppedCount);
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(() => { window.sdkData?.ui.dispose(); delete window.sdkData; }); },
    async () => { if (a) await cleanupOwnedRows(a.client.records('todos'), a.user.id, [ids[0], ids[2], ids[3], ids[4]].map(nativeUuid)); },
    async () => { if (a) await a.client.logout(); },
    async () => { if (b) await cleanupOwnedRows(b.client.records('todos'), b.user.id, [nativeUuid(ids[1])]); },
    async () => { if (b) await b.client.logout(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
