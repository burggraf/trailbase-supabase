import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmedTrailUser, confirmedSupabaseUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { nativeState, deleteNativeOwner, deleteReferenceOwner, referenceAuditSnapshot, assertReferenceAuditPreserved } from '../auth-negative/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';
import type { createClient } from '../../src/index.js';

declare global { interface Window { keyboardCompletion?: { client: ReturnType<typeof createClient>; ui: { refresh(): Promise<void>; dispose(): void }; calls: { method: string; path: string }[]; hold: boolean; held: boolean; release(): void } } }

for (const backend of ['trailbase', 'supabase'] as const) test(`L1-09/24/26/E04/E10/E13/E14/KF01 keyboard completion retains usable focus [${backend}]`, async ({ page }) => {
  const env = await context(), nativeBefore = nativeState(env), ids = Array.from({ length: 3 }, () => randomUUID());
  const owners: { email: string; password: string; id: string }[] = [], records: any[] = [], pageErrors: string[] = [];
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
    for (const label of ['kf-a', 'kf-b']) {
      const user = backend === 'trailbase' ? await confirmedTrailUser(env, label) : await confirmedSupabaseUser(env, label);
      owners.push({ email: user.email, password: user.password, id: backend === 'trailbase' ? canonicalUuid(user.user.id) : user.user.id }); records.push(user.client);
    }
    for (const [index, id] of ids.entries()) {
      const row = { id, user_id: owners[index === 2 ? 1 : 0].id, title: `KF-${id}`, completed: false, priority: index, note: null, created_at: 1700000100 - index };
      if (backend === 'trailbase') await records[index === 2 ? 1 : 0].records('todos').create({ ...row, id: nativeUuid(id), user_id: nativeUuid(row.user_id), completed: 0 });
      else expect((await records[index === 2 ? 1 : 0].from('todos').insert(row)).error).toBeNull();
    }
    const baseline = await snapshot(), changes: number[] = [], completed = [false, false];
    const database = async () => {
      const actual = await snapshot();
      expect(actual[0]).toEqual(baseline[0].map((row: any) => {
        const index = ids.findIndex(id => (backend === 'trailbase' ? nativeUuid(id) : id) === row.id);
        return { ...row, completed: backend === 'trailbase' ? Number(completed[index]) : completed[index] };
      }));
      expect(actual[1].slice(0, baseline[1].length)).toEqual(baseline[1]);
      expect(actual[1].slice(baseline[1].length).map((row: any) => ({ todo_id: row.todo_id, user_id: row.user_id, operation: row.operation }))).toEqual(changes.map(index => ({ todo_id: backend === 'trailbase' ? nativeUuid(ids[index]) : ids[index], user_id: backend === 'trailbase' ? nativeUuid(owners[0].id) : owners[0].id, operation: 'UPDATE' })));
      expect(actual.slice(2)).toEqual(baseline.slice(2));
    };
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    if (backend === 'supabase') await page.addScriptTag({ url: `${env.trailUrl}/fixtures/supabase.js` });
    expect(await page.evaluate(async ({ base, url, key, backend, owner }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const app: typeof import('../../examples/todos/app.js') = await import(`${base}/sdk-data/app.js`);
      let release = () => {}, state: NonNullable<Window['keyboardCompletion']>;
      const calls: { method: string; path: string }[] = [];
      const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false as const }, global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname, method = init?.method ?? 'GET';
        if (path.includes('/todos')) calls.push({ method, path });
        const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
        if (state?.hold && method === 'PATCH') { state.hold = false; await new Promise<void>((yes, no) => { const timer = setTimeout(() => no(new Error('KF genuine response gate deadline')), 10000); release = () => { clearTimeout(timer); yes(); }; state.held = true; }); }
        return response;
      } } };
      const fields = { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } };
      const client = backend === 'trailbase' ? sdk.createClient(url, undefined, { ...options, trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } } }) : window.supabase.createClient(url, key, { ...options, db: { retry: false } });
      if ((await client.auth.signInWithPassword({ email: owner.email, password: owner.password })).error) throw new Error('KF ordinary browser login failed');
      const outside = document.createElement('button'); outside.textContent = 'Outside task list'; document.body.append(outside);
      const ui = app.mountTodos(document.querySelector('#todos'), client, { ownerId: owner.id });
      state = { client: client as ReturnType<typeof sdk.createClient>, ui, calls, hold: false, held: false, release: () => release() }; window.keyboardCompletion = state;
      await ui.refresh(); return true;
    }, { base: env.trailUrl, url: backend === 'trailbase' ? env.trailUrl : env.supabaseUrl, key: backend === 'supabase' ? env.anonKey : '', backend, owner: owners[0] })).toBe(true);
    const checkbox = (index: number) => page.getByRole('checkbox', { name: `Complete KF-${ids[index]}`, exact: true });
    const refresh = page.getByRole('button', { name: 'Refresh tasks', exact: true }), error = page.getByRole('alert', { name: 'Task error', exact: true });
    const calls = () => page.evaluate(() => [...window.keyboardCompletion!.calls]);
    const recordsUrl = (url: URL) => url.pathname.includes('/todos');
    const toggle = async (index: number, fault?: 'write' | 'read', filtered = false) => {
      const before = (await calls()).length;
      if (fault) await page.route(recordsUrl, route => {
        if (route.request().method() === (fault === 'write' ? 'PATCH' : 'GET')) return route.abort('internetdisconnected');
        return route.fallback();
      });
      await checkbox(index).focus(); await checkbox(index).press('Space');
      await expect(refresh).toBeEnabled();
      if (fault) { await expect(error).toContainText(fault === 'write' ? 'TASK_OUTCOME_UNKNOWN' : 'TASK_SAVED_REFRESH_FAILED'); await page.unroute(recordsUrl); }
      else await expect(error).toBeEmpty();
      if (fault !== 'write') { completed[index] = !completed[index]; changes.push(index); }
      const sent = (await calls()).slice(before); expect(sent.map(call => call.method)).toEqual(fault === 'write' ? ['PATCH'] : ['PATCH', 'GET']);
      if (backend === 'trailbase') expect(sent[0].path).toBe(`/api/records/v1/todos/${nativeUuid(ids[index])}`);
      if (filtered) { await expect(checkbox(index)).toHaveCount(0); await expect(page.getByLabel('New task', { exact: true }), 'KF assertion: removed task leaves usable input focus').toBeFocused(); }
      else { await expect(checkbox(index), 'KF assertion: completion retains keyboard checkbox focus').toBeFocused(); await expect(checkbox(index)).toBeChecked({ checked: completed[index] }); }
      await database();
    };
    await toggle(0); await toggle(0); // Genuine success in both directions, no synthetic response.
    await toggle(0, 'write'); // Aborted genuine outgoing PATCH: rollback, no write or automatic replay.
    await toggle(0, 'read'); // Committed PATCH followed by failed real list GET is not replayed.
    await refresh.click(); await expect(refresh).toBeEnabled(); await expect(error).toBeEmpty(); await database();
    await page.getByRole('tab', { name: 'Completed', exact: true }).click(); await expect(refresh).toBeEnabled();
    await toggle(0, undefined, true); // Row leaves filter; do not focus a detached node.
    await page.getByRole('tab', { name: 'All', exact: true }).click(); await expect(refresh).toBeEnabled();
    const beforeHeld = (await calls()).length;
    await page.evaluate(() => { window.keyboardCompletion!.hold = true; });
    await checkbox(1).focus(); await checkbox(1).press('Space');
    await expect.poll(() => page.evaluate(() => window.keyboardCompletion!.held)).toBe(true);
    await expect(refresh).toBeDisabled(); const outside = page.getByRole('button', { name: 'Outside task list', exact: true }); await outside.focus();
    await page.evaluate(() => window.keyboardCompletion!.release()); await expect(refresh).toBeEnabled();
    await expect(outside, 'KF assertion: delayed completion does not steal moved focus').toBeFocused();
    completed[1] = true; changes.push(1); expect((await calls()).slice(beforeHeld).map(call => call.method)).toEqual(['PATCH', 'GET']);
    await database(); expect(pageErrors).toEqual([]);
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(async () => { if (window.keyboardCompletion) { window.keyboardCompletion.release(); window.keyboardCompletion.ui.dispose(); const result = await window.keyboardCompletion.client.auth.signOut({ scope: 'local' }); if (result.error) throw new Error('KF browser local cleanup failed'); delete window.keyboardCompletion; } }); },
    async () => { await page.unrouteAll({ behavior: 'wait' }); await page.context().unrouteAll({ behavior: 'wait' }); },
    ...[0, 1].map(index => async () => {
      if (!owners[index]) return; const owner = owners[index], rowIds = index ? [ids[2]] : ids.slice(0, 2);
      await withCleanup(async () => {
        if (backend === 'trailbase') await cleanupOwnedRows(records[index].records('todos'), nativeUuid(owner.id), rowIds.map(nativeUuid));
        else for (const id of rowIds) expect((await records[index].from('todos').delete().eq('id', id)).error).toBeNull();
      }, [async () => {
        const target = { ...owner, label: `kf-${index}` };
        if (backend === 'trailbase') await deleteNativeOwner(env, target);
        else { const audit = await referenceAuditSnapshot(env, target); await deleteReferenceOwner(env, target); assertReferenceAuditPreserved(audit, await referenceAuditSnapshot(env, target)); }
      }]);
    }),
    async () => { const after = nativeState(env); expect(after.users).toEqual(nativeBefore.users); expect(after.sessions).toEqual(nativeBefore.sessions); expect(after.todos).toEqual(nativeBefore.todos); expect(after.audit.slice(0, nativeBefore.audit.length)).toEqual(nativeBefore.audit); if (backend === 'trailbase') expect(after.audit.slice(nativeBefore.audit.length).every(row => ids.some(id => Buffer.from(nativeUuid(id), 'base64url').equals(row.todo_id as Uint8Array)))).toBe(true); else expect(after.audit).toEqual(nativeBefore.audit); },
  ]);
});
