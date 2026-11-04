import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmedTrailUser, confirmedSupabaseUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { nativeState, deleteNativeOwner, deleteReferenceOwner, referenceAuditSnapshot, assertReferenceAuditPreserved } from '../auth-negative/helpers.js';
import { authSnapshot } from '../auth-reference/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';

declare global { interface Window { appResourcesDispose?: () => Promise<void> } }
for (const backend of ['trailbase', 'supabase'] as const) test(`L1-16/18–20/24/26/E14/S07/S08/AR01 100 reused-client auth and app lifecycles [${backend}]`, async ({ page }) => {
  const env = await context(), nativeBefore = nativeState(env), referenceBefore = await authSnapshot(env), ids = [randomUUID(), randomUUID()];
  const owners: { label: string; email: string; password: string; id: string }[] = [], clients: any[] = [], pageErrors: string[] = [];
  const auditBefore = await referenceAuditSnapshot(env, { label: 'ar-baseline', email: '', password: '', id: ids[0] });
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
    for (const label of ['ar-a', 'ar-b']) {
      const user = backend === 'trailbase' ? await confirmedTrailUser(env, label) : await confirmedSupabaseUser(env, label);
      owners.push({ label, email: user.email, password: user.password, id: backend === 'trailbase' ? canonicalUuid(user.user.id) : user.user.id }); clients.push(user.client);
    }
    for (const [index, id] of ids.entries()) {
      const row = { id, user_id: owners[index].id, title: `AR-${id}`, completed: false, priority: index, note: null, created_at: 1700000100 };
      if (backend === 'trailbase') await clients[index].records('todos').create({ ...row, id: nativeUuid(id), user_id: nativeUuid(row.user_id), completed: 0 });
      else expect((await clients[index].from('todos').insert(row)).error).toBeNull();
    }
    const baseline = await snapshot(), nativeSeeded = nativeState(env);
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    if (backend === 'supabase') await page.addScriptTag({ url: `${env.trailUrl}/fixtures/supabase.js` });
    expect(await page.evaluate(async ({ base, url, key, backend, owner, id, storageKey, unrelated }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const app: typeof import('../../examples/todos/app.js') = await import(`${base}/sdk-data/app.js`);
      const check = (condition: unknown, label: string) => { if (!condition) throw new Error(`AR assertion: ${label}`); };
      const root = document.querySelector('#todos')!;
      const realSet = window.setTimeout, realClear = window.clearTimeout, realInterval = window.setInterval, realClearInterval = window.clearInterval;
      const realAdd = EventTarget.prototype.addEventListener, realRemove = EventTarget.prototype.removeEventListener;
      const timers = new Set<number>(), intervals = new Set<number>(), focus = new Set<EventListenerOrEventListenerObject>(), visibility = new Set<EventListenerOrEventListenerObject>(), windowVisibility = new Set<EventListenerOrEventListenerObject>();
      const pageHide = new Set<EventListenerOrEventListenerObject>(), pageShow = new Set<EventListenerOrEventListenerObject>();
      const appListeners = new Set<{ target: EventTarget; type: string; original: EventListenerOrEventListenerObject; wrapped: EventListener; capture: boolean; signal: AbortSignal; retired: boolean }>();
      let retiredDomCalls = 0, retiredAuthCalls = 0, liveSubscriptions = 0, completed = 0;
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        check(typeof handler === 'function', 'native function timer');
        const timer = realSet(() => { timers.delete(timer); Reflect.apply(handler as (...values: unknown[]) => void, window, args); }, delay); timers.add(timer); return timer;
      }) as typeof window.setTimeout;
      window.clearTimeout = ((timer?: number) => { if (timer !== undefined) timers.delete(timer); realClear(timer); }) as typeof window.clearTimeout;
      window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => { const timer = realInterval(handler, delay, ...args); intervals.add(timer); return timer; }) as typeof window.setInterval;
      window.clearInterval = ((timer?: number) => { if (timer !== undefined) intervals.delete(timer); realClearInterval(timer); }) as typeof window.clearInterval;
      const globalListeners = (target: EventTarget, type: string) => target === window && type === 'focus' ? focus : target === document && type === 'visibilitychange' ? visibility : target === window && type === 'visibilitychange' ? windowVisibility : target === window && type === 'pagehide' ? pageHide : target === window && type === 'pageshow' ? pageShow : undefined;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (listener) globalListeners(this, type)?.add(listener);
        if (listener && this instanceof Node && (this === root || root.contains(this))) {
          const signal = typeof options === 'object' ? options.signal : undefined; check(signal, 'app listeners own abort signal');
          const original = listener, entry = { target: this, type, original, wrapped: undefined as unknown as EventListener, capture: typeof options === 'boolean' ? options : !!options?.capture, signal: signal!, retired: false };
          entry.wrapped = function (this: EventTarget, event: Event) { if (entry.retired) retiredDomCalls++; if (typeof original === 'function') original.call(this, event); else original.handleEvent(event); };
          appListeners.add(entry); realAdd.call(signal!, 'abort', () => { entry.retired = true; appListeners.delete(entry); }, { once: true }); listener = entry.wrapped;
        }
        realAdd.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (listener) globalListeners(this, type)?.delete(listener);
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        const entry = [...appListeners].find(item => item.target === this && item.type === type && item.original === listener && item.capture === capture);
        if (entry) { appListeners.delete(entry); entry.retired = true; listener = entry.wrapped; }
        realRemove.call(this, type, listener, options);
      };
      const bounded = async <T,>(work: PromiseLike<T>, label: string): Promise<T> => {
        let timer: number | undefined;
        try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = realSet(() => reject(new Error(`AR deadline: ${label}`)), 10000); })]); }
        finally { realClear(timer); }
      };
      const ready = (value: boolean) => bounded(new Promise<void>(resolve => {
        const done = () => { const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]'); return checkbox && !checkbox.disabled && checkbox.checked === value && root.querySelector('[data-task-title]')?.textContent === `AR-${id}`; };
        if (done()) { resolve(); return; }
        const observer = new MutationObserver(() => { if (done()) { observer.disconnect(); observers.delete(observer); resolve(); } }); observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true }); observers.add(observer);
      }), 'real task render');
      const observers = new Set<MutationObserver>(), calls: string[] = [];
      const options = { auth: { storageKey, detectSessionInUrl: false as const, ...(backend === 'supabase' ? { autoRefreshToken: false } : {}) }, global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = new URL(String(input)), method = init?.method ?? 'GET';
        calls.push(`${method}:${target.pathname}${target.pathname.endsWith('/token') ? ':' + target.searchParams.get('grant_type') : ''}`);
        return fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
      } } };
      const fields = { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } };
      const client: any = backend === 'trailbase' ? sdk.createClient(url, undefined, { ...options, trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } } }) : window.supabase.createClient(url, key, options);
      const subscribe = client.auth.onAuthStateChange.bind(client.auth);
      client.auth.onAuthStateChange = (callback: (event: string, session: any) => void) => {
        let retired = false; liveSubscriptions++;
        const result = subscribe((event: string, session: any) => { if (retired) retiredAuthCalls++; callback(event, session); });
        const unsubscribe = result.data.subscription.unsubscribe.bind(result.data.subscription);
        result.data.subscription.unsubscribe = () => { if (!retired) { retired = true; liveSubscriptions--; } unsubscribe(); };
        return result;
      };
      let ui: { dispose(): void } | undefined;
      const resources = (signedIn: boolean) => {
        check(timers.size === (backend === 'trailbase' && signedIn ? 1 : 0) && intervals.size === 0, 'stable real auth timers');
        // Pinned reference UMD has one auth visibility listener plus three caller-owned transport lifecycle listeners.
        check(focus.size === (backend === 'trailbase' && signedIn ? 1 : 0) && visibility.size === (backend === 'trailbase' && signedIn ? 1 : 0) && windowVisibility.size === (backend === 'supabase' ? 2 : 0) && pageHide.size === (backend === 'supabase' ? 1 : 0) && pageShow.size === (backend === 'supabase' ? 1 : 0), 'stable real auth and reference-client baseline listeners');
      };
      localStorage.setItem(unrelated, 'keep');
      window.appResourcesDispose = async () => {
        try { ui?.dispose(); await bounded(client.auth.signOut({ scope: 'local' }), 'final local cleanup'); if (backend === 'supabase') await client.auth.stopAutoRefresh(); }
        finally {
          for (const observer of observers) observer.disconnect();
          window.setTimeout = realSet; window.clearTimeout = realClear; window.setInterval = realInterval; window.clearInterval = realClearInterval;
          EventTarget.prototype.addEventListener = realAdd; EventTarget.prototype.removeEventListener = realRemove;
          localStorage.removeItem(storageKey); localStorage.removeItem(unrelated);
        }
      };
      for (let cycle = 0; cycle < 100; cycle++) {
        const start = calls.length;
        check(!(await bounded<{ error: unknown }>(client.auth.signInWithPassword({ email: owner.email, password: owner.password }), 'genuine login')).error, 'genuine password accepted');
        ui = app.mountAuthTodos(root, client); await ready(cycle % 2 === 1);
        check(liveSubscriptions === 1 && appListeners.size === 7, 'one mounted auth subscription and seven abort-owned DOM listeners'); resources(true);
        root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await ready(cycle % 2 === 0);
        check(root.querySelector('[aria-label="Task error"]')?.textContent === '', 'genuine mutation acknowledged');
        ui.dispose(); ui.dispose(); check(appListeners.size === 0, 'all app DOM signals aborted');
        for (const type of ['click', 'submit', 'input', 'change', 'keydown']) root.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        const detached = root.innerHTML;
        // Logout supplies a real event barrier every cycle; a final refresh also probes all100 retired subscriptions.
        if (cycle === 99) check(!(await bounded<{ error: unknown }>(client.auth.refreshSession(), 'genuine post-disposal refresh')).error, 'real refresh succeeds after app disposal');
        check(!(await bounded<{ error: unknown }>(client.auth.signOut({ scope: 'local' }), 'genuine local logout')).error, 'local logout acknowledged');
        check(retiredAuthCalls === 0 && liveSubscriptions === 0, 'retired auth callback is unsubscribed');
        check(retiredAuthCalls === 0 && retiredDomCalls === 0 && root.innerHTML === detached, 'retired app stays silent and unchanged'); resources(false);
        check(localStorage.getItem(storageKey) === null && localStorage.getItem(unrelated) === 'keep', 'owned persistence removed without unrelated deletion');
        const paths = calls.slice(start), api = backend === 'trailbase' ? '/api/records/v1/todos' : '/rest/v1/todos';
        check(paths.length === (cycle === 99 ? 6 : 5) && paths[1] === `GET:${api}` && paths[2].startsWith(`PATCH:${api}`) && paths[3] === `GET:${api}`, 'one read and one write/read per lifecycle without replay');
        check(paths[0] === (backend === 'trailbase' ? 'POST:/api/auth/v1/login' : 'POST:/auth/v1/token:password') && paths.at(-1) === (backend === 'trailbase' ? 'POST:/api/auth/v1/logout' : 'POST:/auth/v1/logout'), 'exact genuine password and local logout requests');
        if (cycle === 99) check(paths[4] === (backend === 'trailbase' ? 'POST:/api/auth/v1/refresh' : 'POST:/auth/v1/token:refresh_token'), 'final genuine post-disposal refresh request');
        completed++;
      }
      check(completed === 100 && liveSubscriptions === 0 && appListeners.size === 0, '100 complete auth/app lifecycles');
      if (backend === 'supabase') await client.auth.stopAutoRefresh();
      check(timers.size === 0 && intervals.size === 0 && focus.size === 0 && visibility.size === 0, 'final auth scheduling teardown');
      check(windowVisibility.size === (backend === 'supabase' ? 1 : 0) && pageHide.size === (backend === 'supabase' ? 1 : 0) && pageShow.size === (backend === 'supabase' ? 1 : 0), 'only constant reference transport baseline remains until owned page closes');
      return { cycles: completed, dataRequests: calls.filter(value => value.includes('/todos')).length, retiredAuthCalls, retiredDomCalls };
    }, { base: env.trailUrl, url: backend === 'trailbase' ? env.trailUrl : env.supabaseUrl, key: backend === 'supabase' ? env.anonKey : '', backend, owner: owners[0], id: ids[0], storageKey: `ar-owned-${randomUUID()}`, unrelated: `ar-unrelated-${randomUUID()}` })).toEqual({ cycles: 100, dataRequests: 300, retiredAuthCalls: 0, retiredDomCalls: 0 });
    const after = await snapshot(); expect(after[0]).toEqual(baseline[0]); expect(after.slice(2)).toEqual(baseline.slice(2));
    expect(after[1].slice(0, baseline[1].length)).toEqual(baseline[1]);
    expect(after[1].slice(baseline[1].length).map((row: any) => ({ todo_id: row.todo_id, user_id: row.user_id, operation: row.operation }))).toEqual(Array.from({ length: 100 }, () => ({ todo_id: backend === 'trailbase' ? nativeUuid(ids[0]) : ids[0], user_id: backend === 'trailbase' ? nativeUuid(owners[0].id) : owners[0].id, operation: 'UPDATE' })));
    const nativeAfter = nativeState(env); expect(nativeAfter.users).toEqual(nativeSeeded.users); expect(nativeAfter.sessions).toEqual(nativeSeeded.sessions); expect(nativeAfter.todos).toEqual(nativeSeeded.todos); expect(nativeAfter.audit.slice(0, nativeSeeded.audit.length)).toEqual(nativeSeeded.audit);
    const nativeDelta = nativeAfter.audit.slice(nativeSeeded.audit.length); expect(nativeDelta).toHaveLength(backend === 'trailbase' ? 100 : 0);
    expect(nativeDelta.every(row => row.operation === 'UPDATE' && Buffer.from(nativeUuid(ids[0]), 'base64url').equals(row.todo_id as Uint8Array) && Buffer.from(nativeUuid(owners[0].id), 'base64url').equals(row.user_id as Uint8Array))).toBe(true); expect(pageErrors).toEqual([]);
  }, [
    async () => { if (!page.isClosed()) try { await page.evaluate(async () => { await window.appResourcesDispose?.(); delete window.appResourcesDispose; }); } finally { await page.close(); } expect(page.isClosed()).toBe(true); },
    async () => { if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' }); await page.context().unrouteAll({ behavior: 'wait' }); },
    ...[0, 1].map(index => async () => {
      if (!owners[index]) return; const owner = owners[index];
      await withCleanup(async () => {
        if (backend === 'trailbase') await cleanupOwnedRows(clients[index].records('todos'), nativeUuid(owner.id), [nativeUuid(ids[index])]);
        else expect((await clients[index].from('todos').delete().eq('id', ids[index])).error).toBeNull();
      }, [async () => {
        if (backend === 'trailbase') await deleteNativeOwner(env, owner);
        else { const before = await referenceAuditSnapshot(env, owner); await deleteReferenceOwner(env, owner); assertReferenceAuditPreserved(before, await referenceAuditSnapshot(env, owner)); }
      }]);
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
