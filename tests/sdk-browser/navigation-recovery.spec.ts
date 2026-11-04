import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmedTrailUser, confirmedSupabaseUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { nativeState, deleteNativeOwner, deleteReferenceOwner, referenceAuditSnapshot, assertReferenceAuditPreserved } from '../auth-negative/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';
import type { createClient } from '../../src/index.js';

declare global { interface Window { navigationRecovery?: { client: ReturnType<typeof createClient>; ui: { refresh(): Promise<void>; dispose(): void }; calls: string[] } } }

for (const backend of ['trailbase', 'supabase'] as const) test(`L1-05/09–11/26/E04/E05/E10/E13/NR01 failed navigation preserves the visible task page [${backend}]`, async ({ page }) => {
  const env = await context(), nativeBefore = nativeState(env), ids = Array.from({ length: 7 }, () => randomUUID());
  const owners: { email: string; password: string; id: string }[] = [], records: any[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', () => pageErrors.push('unhandled-browser-error'));
  const snapshot = async () => {
    const result = [];
    for (const client of records) for (const table of ['todos', 'todo_audit']) {
      if (backend === 'trailbase') result.push((await client.records(table).list({ pagination: { limit: 1000 }, order: [table === 'todos' ? '+id' : '+audit_key'] })).records);
      else { const read = await client.from(table).select('*').order(table === 'todos' ? 'id' : 'audit_key'); expect(read.error).toBeNull(); result.push(read.data); }
    }
    return result;
  };
  await withCleanup(async () => {
    for (const label of ['nr-a', 'nr-b']) {
      const user = backend === 'trailbase' ? await confirmedTrailUser(env, label) : await confirmedSupabaseUser(env, label);
      owners.push({ email: user.email, password: user.password, id: backend === 'trailbase' ? canonicalUuid(user.user.id) : user.user.id }); records.push(user.client);
    }
    for (const [index, id] of ids.entries()) {
      const owner = index === 6 ? 1 : 0;
      const row = { id, user_id: owners[owner].id, title: `NR-${id}`, completed: index % 2 === 1, priority: index, note: null, created_at: 1700000100 - index };
      if (backend === 'trailbase') await records[owner].records('todos').create({ ...row, id: nativeUuid(id), user_id: nativeUuid(row.user_id), completed: Number(row.completed) });
      else expect((await records[owner].from('todos').insert(row)).error).toBeNull();
    }
    const baseline = await snapshot(), nativeCommitted = nativeState(env);
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    if (backend === 'supabase') await page.addScriptTag({ url: `${env.trailUrl}/fixtures/supabase.js` });
    expect(await page.evaluate(async ({ base, url, key, backend, owner }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const app: typeof import('../../examples/todos/app.js') = await import(`${base}/sdk-data/app.js`);
      const calls: string[] = [];
      const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false as const }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        if (new URL(String(input)).pathname.endsWith('/todos')) calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).search}`);
        return fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
      } } };
      const fields = { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } };
      const client = backend === 'trailbase' ? sdk.createClient(url, undefined, { ...options, trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } } }) : window.supabase.createClient(url, key, { ...options, db: { retry: false } });
      if ((await client.auth.signInWithPassword({ email: owner.email, password: owner.password })).error) throw new Error('NR ordinary browser login failed');
      const ui = app.mountTodos(document.querySelector('#todos'), client, { ownerId: owner.id, pageSize: 2 });
      window.navigationRecovery = { client: client as ReturnType<typeof sdk.createClient>, ui, calls };
      await ui.refresh(); return true;
    }, { base: env.trailUrl, url: backend === 'trailbase' ? env.trailUrl : env.supabaseUrl, key: backend === 'supabase' ? env.anonKey : '', backend, owner: owners[0] })).toBe(true);
    const list = page.getByRole('list', { name: 'Tasks', exact: true }), next = page.getByRole('button', { name: 'Next tasks', exact: true }), previous = page.getByRole('button', { name: 'Previous tasks', exact: true }), refresh = page.getByRole('button', { name: 'Refresh tasks', exact: true }), error = page.getByRole('alert', { name: 'Task error', exact: true });
    const calls = () => page.evaluate(() => [...window.navigationRecovery!.calls]);
    const view = async (indices: number[], number: number, filter = 'All') => {
      await expect(list.locator('[data-task-title]')).toHaveText(indices.map(index => `NR-${ids[index]}`));
      await expect(page.getByRole('navigation', { name: 'Task pages' }).locator('span')).toHaveText(`Page ${number}`);
      await expect(page.getByRole('tab', { name: filter, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(refresh).toBeEnabled();
    };
    const read = async (action: () => Promise<unknown>, offset: number, filter?: boolean, abort = false) => {
      const before = (await calls()).length;
      if (abort) await page.route(url => url.pathname === (backend === 'trailbase' ? '/api/records/v1/todos' : '/rest/v1/todos'), route => route.abort('internetdisconnected'), { times: 1 });
      await action();
      if (abort) await expect(error).toHaveText('We couldn’t load your tasks. Check your connection and choose Refresh.');
      else await expect(error).toBeEmpty();
      await expect(refresh).toBeEnabled();
      const sent = (await calls()).slice(before); expect(sent).toHaveLength(1); expect(sent[0].startsWith('GET ')).toBe(true);
      const query = new URLSearchParams(sent[0].slice(4));
      expect(query.get('offset') ?? '0').toBe(String(offset)); expect(query.get('limit')).toBe('3');
      expect(query.get(backend === 'trailbase' ? 'filter[completed][$eq]' : 'completed')).toBe(filter === undefined ? null : backend === 'trailbase' ? String(Number(filter)) : `eq.${filter}`);
      expect(query.get('order')).toBe(backend === 'trailbase' ? '-created_at,+id' : 'created_at.desc,id.asc');
    };
    await view([0, 1], 1); await expect(previous).toBeDisabled(); await expect(next).toBeEnabled();
    await read(() => next.click(), 2, undefined, true); await view([0, 1], 1); await expect(previous).toBeDisabled();
    await read(() => refresh.click(), 0); await view([0, 1], 1); // Fails before the fix: Refresh silently advances to page2.
    await read(() => next.click(), 2); await view([2, 3], 2);
    await read(() => previous.click(), 0, undefined, true); await view([2, 3], 2);
    await read(() => refresh.click(), 2); await view([2, 3], 2);
    await read(() => next.click(), 4); await view([4, 5], 3); await expect(next).toBeDisabled();
    await read(() => page.getByRole('tab', { name: 'Completed', exact: true }).click(), 0, true, true); await view([4, 5], 3); await expect(next).toBeDisabled();
    await read(() => refresh.click(), 4); await view([4, 5], 3);
    await read(() => page.getByRole('tab', { name: 'Completed', exact: true }).click(), 0, true); await view([1, 3], 1, 'Completed'); await expect(previous).toBeDisabled();
    await read(() => next.click(), 2, true); await view([5], 2, 'Completed'); await expect(next).toBeDisabled();
    await read(() => page.getByRole('tab', { name: 'All', exact: true }).click(), 0); await view([0, 1], 1);
    expect(await snapshot()).toEqual(baseline);
    const afterReads = nativeState(env); expect(afterReads.todos).toEqual(nativeCommitted.todos); expect(afterReads.audit).toEqual(nativeCommitted.audit);
    // A successful empty destination triggers the existing one-page fallback; losing only its reply must not commit that fallback.
    await read(() => next.click(), 2); await read(() => next.click(), 4); await view([4, 5], 3);
    for (const index of [4, 5]) {
      if (backend === 'trailbase') await records[0].records('todos').delete(nativeUuid(ids[index]));
      else expect((await records[0].from('todos').delete().eq('id', ids[index])).error).toBeNull();
    }
    const afterDeletion = await snapshot(), firstCount = (await calls()).length;
    await page.route(url => url.pathname === (backend === 'trailbase' ? '/api/records/v1/todos' : '/rest/v1/todos') && url.searchParams.get('offset') === '2', route => route.abort('internetdisconnected'), { times: 1 });
    await refresh.click(); await expect(error).not.toBeEmpty(); await view([4, 5], 3); await expect(next).toBeDisabled();
    const failedFallback = (await calls()).slice(firstCount); expect(failedFallback).toHaveLength(2); expect(failedFallback.map(call => new URLSearchParams(call.slice(4)).get('offset'))).toEqual(['4', '2']);
    const recoveredCount = (await calls()).length; await refresh.click(); await view([2, 3], 2); await expect(error).toBeEmpty();
    expect((await calls()).slice(recoveredCount).map(call => new URLSearchParams(call.slice(4)).get('offset'))).toEqual(['4', '2']);
    expect(await snapshot()).toEqual(afterDeletion); expect(pageErrors).toEqual([]);
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(async () => { if (window.navigationRecovery) { window.navigationRecovery.ui.dispose(); const result = await window.navigationRecovery.client.auth.signOut({ scope: 'local' }); if (result.error) throw new Error('NR browser local cleanup failed'); delete window.navigationRecovery; } }); },
    async () => { await page.unrouteAll({ behavior: 'wait' }); await page.context().unrouteAll({ behavior: 'wait' }); },
    ...[0, 1].map(index => async () => {
      if (!owners[index]) return;
      const owner = owners[index], rowIds = index ? [ids[6]] : ids.slice(0, 6);
      await withCleanup(async () => {
        if (backend === 'trailbase') await cleanupOwnedRows(records[index].records('todos'), nativeUuid(owner.id), rowIds.map(nativeUuid));
        else for (const id of rowIds) { const result = await records[index].from('todos').delete().eq('id', id); expect(result.error).toBeNull(); }
      }, [async () => {
        if (backend === 'trailbase') await deleteNativeOwner(env, { ...owner, label: `nr-${index}` });
        else { const target = { ...owner, label: `nr-${index}` }; const audit = await referenceAuditSnapshot(env, target); await deleteReferenceOwner(env, target); assertReferenceAuditPreserved(audit, await referenceAuditSnapshot(env, target)); }
      }]);
    }),
    async () => { const after = nativeState(env); expect(after.users).toEqual(nativeBefore.users); expect(after.sessions).toEqual(nativeBefore.sessions); expect(after.todos).toEqual(nativeBefore.todos); expect(after.audit.slice(0, nativeBefore.audit.length)).toEqual(nativeBefore.audit); if (backend === 'trailbase') { const added = after.audit.slice(nativeBefore.audit.length); expect(added).toHaveLength(14); expect(added.every(row => ids.some(id => Buffer.from(nativeUuid(id), 'base64url').equals(row.todo_id as Uint8Array)))).toBe(true); } else expect(after.audit).toEqual(nativeBefore.audit); },
  ]);
});
