import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmedTrailUser, confirmedSupabaseUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { nativeState, deleteNativeOwner, deleteReferenceOwner, referenceAuditSnapshot, assertReferenceAuditPreserved } from '../auth-negative/helpers.js';
import { authSnapshot } from '../auth-reference/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';

declare global { interface Window { disposedMutation?: {
  arm(): void; held(): boolean; dispose(): void; remount(): void; replace(): Promise<void>;
  settle(): Promise<{ selects: number; calls: string[]; unchanged: boolean }>;
  calls(): string[]; cleanup(): Promise<void>;
} } }

for (const backend of ['trailbase', 'supabase'] as const) test(`L1-07/16/19/24/26/E04/E11/E14/S08/DR01 disposed mutation does not start a retired follow-up read [${backend}]`, async ({ page }) => {
  const env = await context(), nativeBefore = nativeState(env), referenceBefore = await authSnapshot(env), ids = [randomUUID(), randomUUID()];
  const owners: { label: string; email: string; password: string; id: string }[] = [], clients: any[] = [], pageErrors: string[] = [];
  const auditBefore = await referenceAuditSnapshot(env, { label: 'dr-baseline', email: '', password: '', id: ids[0] });
  page.on('pageerror', () => pageErrors.push('unhandled-browser-error'));
  const snapshot = async () => {
    const rows = [];
    for (const client of clients) for (const table of ['todos', 'todo_audit']) {
      if (backend === 'trailbase') rows.push((await client.records(table).list({ pagination: { limit: 1000 }, order: [table === 'todos' ? '+id' : '+audit_key'] })).records);
      else { const result = await client.from(table).select('*').order(table === 'todos' ? 'id' : 'audit_key'); expect(result.error).toBeNull(); rows.push(result.data); }
    }
    return rows;
  };
  await withCleanup(async () => {
    for (const label of ['dr-a', 'dr-b']) {
      const user = backend === 'trailbase' ? await confirmedTrailUser(env, label) : await confirmedSupabaseUser(env, label);
      owners.push({ label, email: user.email, password: user.password, id: backend === 'trailbase' ? canonicalUuid(user.user.id) : user.user.id }); clients.push(user.client);
    }
    for (const [index, id] of ids.entries()) {
      const row = { id, user_id: owners[index].id, title: `DR-${id}`, completed: false, priority: index, note: null, created_at: 1700000100 };
      if (backend === 'trailbase') await clients[index].records('todos').create({ ...row, id: nativeUuid(id), user_id: nativeUuid(row.user_id), completed: 0 });
      else expect((await clients[index].from('todos').insert(row)).error).toBeNull();
    }
    const baseline = await snapshot(), changes: number[] = [], completed = [false, false];
    const database = async () => {
      const actual = await snapshot();
      for (const index of [0, 1]) {
        expect(actual[index * 2]).toEqual(baseline[index * 2].map((row: any) => ({ ...row, completed: backend === 'trailbase' ? Number(completed[index]) : completed[index] })));
        expect(actual[index * 2 + 1].slice(0, baseline[index * 2 + 1].length)).toEqual(baseline[index * 2 + 1]);
        expect(actual[index * 2 + 1].slice(baseline[index * 2 + 1].length).map((row: any) => ({ todo_id: row.todo_id, user_id: row.user_id, operation: row.operation }))).toEqual(changes.filter(owner => owner === index).map(() => ({ todo_id: backend === 'trailbase' ? nativeUuid(ids[index]) : ids[index], user_id: backend === 'trailbase' ? nativeUuid(owners[index].id) : owners[index].id, operation: 'UPDATE' })));
      }
    };
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    if (backend === 'supabase') await page.addScriptTag({ url: `${env.trailUrl}/fixtures/supabase.js` });
    expect(await page.evaluate(async ({ base, url, key, backend, owners }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const app: typeof import('../../examples/todos/app.js') = await import(`${base}/sdk-data/app.js`);
      const root = document.querySelector('#todos')!;
      const bounded = async <T,>(work: PromiseLike<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DR genuine operation deadline')), 10000); })]); }
        finally { clearTimeout(timer); }
      };
      const calls: { method: string; bearer: string | null }[] = [], tokens: string[] = [];
      let hold = false, held = false, selects = 0, release = () => {}, markSettled = () => {}, markRead = () => {};
      let settled = Promise.resolve(), retiredRead = Promise.resolve(), captureRead = false;
      const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false as const }, global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const data = new URL(String(input)).pathname.includes('/todos'), method = init?.method ?? 'GET';
        if (data) calls.push({ method, bearer: new Headers(init?.headers).get('Authorization') });
        const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
        if (data && method === 'GET' && captureRead) markRead();
        if (data && method === 'PATCH' && hold) {
          hold = false;
          if (!response.ok) throw new Error('DR genuine mutation was rejected');
          await bounded(new Promise<void>(resolve => { release = resolve; held = true; }));
        }
        return response; // Original genuine response, not a fabricated status/body/acknowledgement.
      } } };
      const fields = { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } };
      const client: any = backend === 'trailbase' ? sdk.createClient(url, undefined, { ...options, trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } } }) : window.supabase.createClient(url, key, { ...options, db: { retry: false } });
      const login = async (index: number) => { const result = await client.auth.signInWithPassword({ email: owners[index].email, password: owners[index].password }); if (result.error || !result.data.session) throw new Error('DR ordinary login failed'); tokens[index] = `Bearer ${result.data.session.access_token}`; };
      const from = client.from.bind(client);
      client.from = (table: string) => {
        const builder = from(table), select = builder.select.bind(builder), update = builder.update.bind(builder);
        builder.select = (...args: unknown[]) => { selects++; return select(...args); };
        builder.update = (...args: unknown[]) => {
          const query = update(...args); if (!hold) return query;
          const then = query.then.bind(query), delivered = markSettled;
          query.then = (yes: any, no: any) => then((value: unknown) => { try { return yes ? yes(value) : value; } finally { queueMicrotask(delivered); } }, (failure: unknown) => { try { if (no) return no(failure); throw failure; } finally { queueMicrotask(delivered); } });
          return query;
        };
        return builder;
      };
      await login(0); let ui = app.mountAuthTodos(root, client);
      const summary = () => calls.map(call => { const owner = tokens.indexOf(call.bearer ?? ''); if (owner < 0) throw new Error('DR unexpected data authorization'); return `${call.method}:${owner ? 'B' : 'A'}`; });
      window.disposedMutation = {
        arm() { hold = true; held = false; settled = new Promise<void>(resolve => { markSettled = resolve; }); retiredRead = new Promise<void>(resolve => { markRead = resolve; }); },
        held: () => held, dispose() { ui.dispose(); ui.dispose(); }, remount() { ui = app.mountAuthTodos(root, client); }, replace: () => login(1), calls: summary,
        async settle() {
          const before = selects, start = calls.length, markup = root.innerHTML; captureRead = true; release();
          // The real query delivers to await first. Its queued marker runs after the app resumes;
          // a follow-up select is constructed synchronously before read's first await.
          await bounded(settled); const delta = selects - before;
          if (delta) await bounded(retiredRead); // Retain actual wire evidence on the regressing implementation.
          captureRead = false; return { selects: delta, calls: summary().slice(start), unchanged: root.innerHTML === markup };
        },
        async cleanup() { release(); ui.dispose(); try { await bounded(settled); const result = await client.auth.signOut({ scope: 'local' }); if (result.error) throw new Error('DR local cleanup failed'); } finally { if (backend === 'supabase') await client.auth.stopAutoRefresh(); } },
      };
      return true;
    }, { base: env.trailUrl, url: backend === 'trailbase' ? env.trailUrl : env.supabaseUrl, key: backend === 'supabase' ? env.anonKey : '', backend, owners })).toBe(true);
    const checkbox = (index: number) => page.getByRole('checkbox', { name: `Complete DR-${ids[index]}`, exact: true });
    const refresh = page.getByRole('button', { name: 'Refresh tasks', exact: true });
    await expect(checkbox(0)).toBeEnabled();
    for (const replace of [false, true]) {
      await page.evaluate(() => window.disposedMutation!.arm()); await checkbox(0).focus(); await checkbox(0).press('Space');
      await expect.poll(() => page.evaluate(() => window.disposedMutation!.held())).toBe(true);
      completed[0] = !completed[0]; changes.push(0); await database(); // Prove commit before disposal/ack delivery, not rollback by abort.
      if (replace) {
        await page.evaluate(() => window.disposedMutation!.replace());
        await expect(checkbox(1)).toBeEnabled(); await expect(checkbox(0)).toHaveCount(0); await page.getByLabel('New task', { exact: true }).focus();
      } else await page.evaluate(() => window.disposedMutation!.dispose());
      const retired = await page.evaluate(() => window.disposedMutation!.settle());
      expect(retired.unchanged, 'DR assertion: retired completion leaves current DOM unchanged').toBe(true);
      expect(retired, 'DR assertion: disposed mutation starts no follow-up select or genuine GET').toEqual({ selects: 0, calls: [], unchanged: true });
      await database();
      if (replace) await expect(page.getByLabel('New task', { exact: true }), 'DR assertion: retired completion does not steal B focus').toBeFocused();
      else { await page.evaluate(() => window.disposedMutation!.remount()); await expect(checkbox(0)).toBeEnabled(); await expect(checkbox(0)).toBeChecked(); }
    }
    await checkbox(1).focus(); await checkbox(1).press('Space'); await expect(refresh).toBeEnabled(); await expect(checkbox(1)).toBeChecked();
    await expect(page.getByRole('alert', { name: 'Task error', exact: true })).toBeEmpty(); completed[1] = true; changes.push(1); await database();
    expect(await page.evaluate(() => window.disposedMutation!.calls())).toEqual(['GET:A', 'PATCH:A', 'GET:A', 'PATCH:A', 'GET:B', 'PATCH:B', 'GET:B']);
    expect(pageErrors).toEqual([]);
  }, [
    async () => { if (!page.isClosed()) try { await page.evaluate(async () => { await window.disposedMutation?.cleanup(); delete window.disposedMutation; }); } finally { await page.close(); } expect(page.isClosed()).toBe(true); },
    async () => { if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' }); await page.context().unrouteAll({ behavior: 'wait' }); },
    ...[0, 1].map(index => async () => {
      if (!owners[index]) return; const owner = owners[index];
      await withCleanup(async () => {
        if (backend === 'trailbase') await cleanupOwnedRows(clients[index].records('todos'), nativeUuid(owner.id), [nativeUuid(ids[index])]);
        else expect((await clients[index].from('todos').delete().eq('id', ids[index])).error).toBeNull();
      }, [async () => { if (backend === 'trailbase') await deleteNativeOwner(env, owner); else { const before = await referenceAuditSnapshot(env, owner); await deleteReferenceOwner(env, owner); assertReferenceAuditPreserved(before, await referenceAuditSnapshot(env, owner)); } }]);
    }),
    async () => {
      const after = nativeState(env); expect(after.users).toEqual(nativeBefore.users); expect(after.sessions).toEqual(nativeBefore.sessions); expect(after.todos).toEqual(nativeBefore.todos); expect(after.audit.slice(0, nativeBefore.audit.length)).toEqual(nativeBefore.audit);
      if (backend === 'trailbase') expect(after.audit.slice(nativeBefore.audit.length).every(row => ids.some(id => Buffer.from(nativeUuid(id), 'base64url').equals(row.todo_id as Uint8Array)))).toBe(true); else expect(after.audit).toEqual(nativeBefore.audit);
      expect((await authSnapshot(env)).filter(row => row.name !== 'audit_log_entries')).toEqual(referenceBefore.filter(row => row.name !== 'audit_log_entries'));
      const first = await referenceAuditSnapshot(env, { label: '', email: '', password: '', id: owners[0]?.id ?? ids[0] }), second = new Map((await referenceAuditSnapshot(env, { label: '', email: '', password: '', id: owners[1]?.id ?? ids[1] })).map(row => [row.id, row.owned]));
      assertReferenceAuditPreserved(auditBefore, first.map(row => ({ ...row, owned: row.owned || second.get(row.id) === true })));
    },
  ]);
});
