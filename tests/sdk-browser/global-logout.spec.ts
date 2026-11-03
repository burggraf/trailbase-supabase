import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { context, confirmedTrailUser, canonicalUuid, nativeUuid, nativeAuthSnapshot } from '../phase-a/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';

type GlobalMode = 'default' | 'explicit' | 'truncate' | 'drop' | 'storage' | 'replace';
declare global { interface Window { packedGlobal?: { prepare(mode: GlobalMode): Promise<boolean>; start(): Promise<boolean>; replace(): Promise<boolean>; finish(): Promise<boolean>; control(): Promise<boolean>; dispose(): Promise<void> } } }

test('L1-19/OGL02–03/OGL05–06 packed genuine0359 global receipt, complete owner isolation, lost/truncated replies, storage failure and held old-owner delivery', async ({ page }) => {
  const env = await context();
  if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'default' || env.nativeServerProfile !== 'default') throw new Error('OGL packed cases require owned official default fixture');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true }), sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const before = nativeAuthSnapshot(main, sessions), users: Awaited<ReturnType<typeof confirmedTrailUser>>[] = [], ids = [randomUUID(), randomUUID()];
  const key = `ogl-packed-${randomUUID()}`, unrelated = `ogl-unrelated-${randomUUID()}`;
  const belongs = (value: unknown) => value instanceof Uint8Array && users.some(user => Buffer.from(user.user.id, 'base64url').equals(value));
  const errors: string[] = []; page.on('pageerror', () => errors.push('unhandled-browser-error'));
  let completed = false;
  await withCleanup(async () => {
    users.push(await confirmedTrailUser(env, 'ogl-packed-a')); users.push(await confirmedTrailUser(env, 'ogl-packed-b'));
    for (const [index, user] of users.entries()) await user.client.records('todos').create({ id: nativeUuid(ids[index]), user_id: user.user.id, title: `OGL-packed-${ids[index]}` });
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    expect(await page.evaluate(async ({ base, accounts, ids, key, unrelated }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const check = (value: unknown, label: string) => { if (!value) throw new Error(`OGL assertion: ${label}`); };
      const bounded = async <T,>(operation: PromiseLike<T>, label: string): Promise<T> => {
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([operation, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`OGL deadline: ${label}`)), 10000); })]); }
        finally { clearTimeout(timer!); }
      };
      const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
      const controllers = new Set<AbortController>(), keys = new Set<string>(), pending: Promise<unknown>[] = [];
      let disposed = false;
      const real: typeof fetch = async (input, init) => {
        check(!disposed && new URL(String(input)).origin === base, 'owned fixed origin');
        const controller = new AbortController(); controllers.add(controller);
        try { return await fetch(input, { ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }); }
        finally { controllers.delete(controller); }
      };
      const control = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: real } });
      check(!(await control.auth.signInWithPassword({ email: accounts[1].email, password: accounts[1].password })).error, 'real control password login');
      const controlBefore = (await control.auth.getSession()).data.session!;
      localStorage.setItem(unrelated, 'keep');
      const nativeRemove = Storage.prototype.removeItem;
      async function preparePhase(mode: GlobalMode) {
        const ownedKey = `${key}-${mode}`; keys.add(ownedKey);
        const stats = { global: 0, local: 0, refresh: 0, records: 0, completed: false };
        let arrived!: () => void, release!: () => void, subject: import('../../src/index.js').AuthSession;
        const arrival = new Promise<void>(yes => { arrived = yes; }), gate = new Promise<void>(yes => { release = yes; });
        const observed: typeof fetch = async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith('/refresh')) stats.refresh++;
          if (path.startsWith('/api/records/')) stats.records++;
          if (!path.endsWith('/logout') || init?.method !== 'GET') { if (path.endsWith('/logout')) stats.local++; return real(input, init); }
          stats.global++;
          try {
            check(String(input) === `${base}/api/auth/v1/logout` && init.credentials === 'omit' && init.redirect === 'manual' && init.body === undefined, 'fixed global GET, no cookies/body/redirect');
            const headers = [...new Headers(init.headers)];
            check(JSON.stringify(headers) === JSON.stringify([['authorization', `Bearer ${subject.access_token}`], ['content-type', 'application/json']]), 'captured Bearer and exact requestJSON only');
            const actual = await real(input, init);
            check(actual.status === 200 && actual.headers.get('location') === null && await actual.clone().text() === 'logged out', 'genuine completed native receipt before delivery control');
            stats.completed = true; arrived();
            if (mode === 'replace') await bounded(gate, 'held actual response');
            if (mode === 'drop') { await actual.arrayBuffer(); throw new TypeError('Injected loss after genuine native completion'); }
            if (mode === 'truncate') return new Response((await actual.text()).slice(0, 5), { status: actual.status, headers: actual.headers });
            return actual; // Primary success/held/storage paths deliver genuine native response unchanged.
          } finally { arrived(); }
        };
        const a = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: ownedKey }, global: { fetch: observed } });
        const sibling = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: observed } });
        const events: string[] = []; let initial!: () => void;
        const initialized = new Promise<void>(yes => { initial = yes; });
        const subscription = a.auth.onAuthStateChange((event, session) => { events.push(`${event}:${session?.user.id === accounts[0].id ? 'A' : session?.user.id === accounts[1].id ? 'B' : 'null'}`); if (event === 'INITIAL_SESSION') initial(); }).data.subscription;
        await bounded(initialized, 'initial event');
        const input = { email: accounts[0].email, password: accounts[0].password };
        const login = await a.auth.signInWithPassword(input); check(!login.error && login.data.user?.id === accounts[0].id, 'real A password login'); subject = login.data.session!;
        const second = await sibling.auth.signInWithPassword(input); check(!second.error && second.data.session?.refresh_token !== subject.refresh_token, 'independent genuine second A session');
        check((await a.from('todos').select('*').eq('id', ids[0]).single()).data?.user_id === accounts[0].id, 'real mapped A owner read'); stats.records = 0;
        let logout: ReturnType<typeof a.auth.signOut> | undefined;
        return {
          async start() {
            if (mode === 'storage') Storage.prototype.removeItem = function (name: string) { Reflect.apply(nativeRemove, this, [name]); if (name === ownedKey) throw Error('Injected removal failure after genuine disk deletion'); };
            logout = mode === 'default' ? a.auth.signOut() : a.auth.signOut({ scope: 'global' }); pending.push(logout);
            await bounded(arrival, 'actual native completion'); check(stats.completed, 'failure controls require actual native success'); return true;
          },
          async replace() { check(mode === 'replace', 'held mode only'); const next = await a.auth.signInWithPassword({ email: accounts[1].email, password: accounts[1].password }); check(!next.error && next.data.user?.id === accounts[1].id, 'genuine different-owner replacement'); return true; },
          async finish() {
            release(); check(logout, 'global operation started'); const result = await bounded(logout!, 'global settlement');
            if (mode === 'drop') check(result.error?.name === 'AuthSignOutRequestError', 'lost receipt remains error');
            else if (mode === 'truncate') check(result.error?.name === 'AuthGlobalSignOutUnconfirmedError', 'truncated actual bytes cannot acknowledge');
            else if (mode === 'storage') check(result.error?.name === 'AuthStorageRemoveError', 'genuine receipt cannot hide failed local removal');
            else check(result.error === null, 'genuine full global acknowledgement');
            check(stats.global === 1 && stats.local === 0 && stats.refresh === 0 && stats.records === 0, 'one global, no renewal/local fallback/replay');
            const current = await a.auth.getSession();
            if (mode === 'replace') check(!current.error && current.data.session?.user.id === accounts[1].id && JSON.parse(localStorage.getItem(ownedKey)!).tokens.auth_token === current.data.session?.access_token, 'held old completion preserves committed B memory and disk');
            else { check(current.data.session === null && localStorage.getItem(ownedKey) === null, 'owned null state and disk removal'); if (mode === 'storage') { check(current.error?.name === 'AuthStorageRemoveError', 'removal failure remains latched'); check((await a.from('todos').select('*')).error?.name === 'AuthStorageRemoveError' && stats.records === 0, 'latched auth cannot dispatch data'); } else check(!current.error, 'ordinary cleared state'); }
            check(events.join(',') === ['INITIAL_SESSION:null', 'SIGNED_IN:A', 'SIGNED_OUT:null', ...(mode === 'replace' ? ['SIGNED_IN:B'] : [])].join(','), 'exact events/no late A event');
            check((await control.auth.getSession()).data.session?.access_token === controlBefore.access_token && localStorage.getItem(unrelated) === 'keep', 'independent B memory/storage unaffected');
            const refresh = await real(`${base}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: subject.refresh_token }), credentials: 'omit', redirect: 'error' }); check(refresh.status === 401, 'captured genuine A refresh rejected'); await refresh.body?.cancel();
            const residual = await real(`${base}/api/records/v1/todos?skip_cursor=true`, { headers: { authorization: `Bearer ${subject.access_token}` }, credentials: 'omit', redirect: 'error' }); check(residual.status === 200, 'unexpired residual A JWT remains usable'); await residual.body?.cancel();
            Storage.prototype.removeItem = nativeRemove; return true;
          },
          async dispose() { release(); Storage.prototype.removeItem = nativeRemove; if (logout) await bounded(logout, 'dispose current global'); subscription.unsubscribe(); Reflect.apply(nativeRemove, localStorage, [ownedKey]); },
        };
      }
      let phase: Awaited<ReturnType<typeof preparePhase>> | undefined;
      window.packedGlobal = {
        prepare: async mode => { await phase?.dispose(); phase = await preparePhase(mode); return true; },
        start: () => phase!.start(), replace: () => phase!.replace(), finish: () => phase!.finish(),
        control: async () => { check(!(await control.auth.refreshSession()).error, 'genuine B refresh survives all A global operations'); check((await control.from('todos').select('*').eq('id', ids[1]).single()).data?.user_id === accounts[1].id, 'genuine B row unchanged'); return true; },
        dispose: async () => { try { await phase?.dispose(); await bounded(Promise.allSettled(pending), 'drain all globals'); } finally { disposed = true; for (const controller of controllers) controller.abort(); Storage.prototype.removeItem = nativeRemove; for (const ownedKey of keys) Reflect.apply(nativeRemove, localStorage, [ownedKey]); Reflect.apply(nativeRemove, localStorage, [unrelated]); } },
      };
      return true;
    }, { base: env.trailUrl, accounts: users.map(user => ({ id: canonicalUuid(user.user.id), email: user.email, password: user.password })), ids, key, unrelated })).toBe(true);
    const ownerId = Buffer.from(users[0].user.id, 'base64url'), controlId = Buffer.from(users[1].user.id, 'base64url');
    for (const mode of ['default', 'explicit', 'truncate', 'drop', 'storage', 'replace'] as const) {
      expect(await page.evaluate(mode => window.packedGlobal!.prepare(mode), mode)).toBe(true);
      const state = nativeAuthSnapshot(main, sessions), own = (row: Record<string, unknown>) => row.user instanceof Uint8Array && ownerId.equals(row.user);
      expect(state.sessions.filter(own)).toHaveLength(mode === 'default' ? 3 : 2);
      expect(await page.evaluate(() => window.packedGlobal!.start())).toBe(true);
      const removed = { ...state, sessions: state.sessions.filter(row => !own(row)) };
      expect(nativeAuthSnapshot(main, sessions)).toEqual(removed);
      let settled = removed;
      if (mode === 'replace') {
        expect(await page.evaluate(() => window.packedGlobal!.replace())).toBe(true); settled = nativeAuthSnapshot(main, sessions);
        expect({ ...settled, sessions: [] }).toEqual({ ...removed, sessions: [] });
        const added = settled.sessions.filter(row => !removed.sessions.some(prior => prior.refresh_token === row.refresh_token));
        expect(added).toHaveLength(1); expect(added[0].user instanceof Uint8Array && controlId.equals(added[0].user)).toBe(true);
        expect(settled.sessions.filter(row => row.refresh_token !== added[0].refresh_token)).toEqual(removed.sessions);
      }
      expect(await page.evaluate(() => window.packedGlobal!.finish())).toBe(true); expect(nativeAuthSnapshot(main, sessions)).toEqual(settled);
    }
    expect(await page.evaluate(() => window.packedGlobal!.control())).toBe(true); expect(errors).toEqual([]); completed = true;
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(async () => { await window.packedGlobal?.dispose(); delete window.packedGlobal; }); },
    ...[0, 1].map(index => async () => { const user = users[index]; if (!user) return; await user.client.login(user.email, user.password); await cleanupOwnedRows(user.client.records('todos'), user.user.id, [nativeUuid(ids[index])]); const response = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { headers: { authorization: `Bearer ${user.client.tokens()!.auth_token}` }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(10000) }); expect(response.status).toBe(303); await response.body?.cancel(); }),
    async () => { const after = nativeAuthSnapshot(main, sessions); expect(after.todos).toEqual(before.todos); expect(after.sessions.filter(row => belongs(row.user))).toEqual([]); expect(after.sessions.filter(row => !belongs(row.user))).toEqual(before.sessions); expect(after.users.filter(row => !belongs(row.id))).toEqual(before.users); expect(after.audit.filter(row => !belongs(row.user_id))).toEqual(before.audit); if (completed) expect(after.audit.filter(row => belongs(row.user_id)).map(row => row.operation)).toEqual(['INSERT', 'INSERT', 'DELETE', 'DELETE']); },
    async () => { main.close(); sessions.close(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
