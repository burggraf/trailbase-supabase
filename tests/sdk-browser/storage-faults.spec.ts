import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { context, confirmedTrailUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';

type Schedule = 'corrupt' | 'read' | 'write' | 'restore' | 'logout-remove' | 'terminal-remove' | 'held-write' | 'held-read';
const cases: [string, Schedule][] = [
  ['PS01 corrupt genuine saved payload on actual reload', 'corrupt'],
  ['PS02 unavailable and throwing storage reads; disabled control', 'read'],
  ['PS03 failed writes restore committed owner before and after disk effect', 'write'],
  ['PS04 failed compensation latches unknown consistency until external repair', 'restore'],
  ['PS05 rejected local logout removal reports actual disk truth', 'logout-remove'],
  ['PS06 genuine rejected refresh with failed terminal removal', 'terminal-remove'],
  ['PS07 held refresh write versus logout and new owner', 'held-write'],
  ['PS08 held saved hydration versus logout and new owner', 'held-read'],
];
for (const [name, schedule] of cases) test(`L1-16–20/E07/E13/S07/S08 ${name}`, async ({ page }) => {
  const env = await context();
  const pageErrors: string[] = []; page.on('pageerror', () => pageErrors.push('unhandled-browser-error'));
  if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'default' || env.nativeServerProfile !== 'default') throw new Error('PS cases require owned official default fixture');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  const sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const rows = (db: DatabaseSync, table: '_user' | '_session' | 'todos' | 'todo_audit') => {
    const statement = db.prepare(`SELECT * FROM ${table} ORDER BY ${table === '_session' ? 'user,refresh_token' : table === 'todo_audit' ? 'audit_key' : 'id'}`);
    statement.setReadBigInts(true); return statement.all();
  };
  const before = { users: rows(main, '_user'), sessions: rows(sessions, '_session'), todos: rows(main, 'todos'), audit: rows(main, 'todo_audit') };
  const users: Awaited<ReturnType<typeof confirmedTrailUser>>[] = [], ids = [randomUUID(), randomUUID()];
  const key = `ps-owned-${randomUUID()}`, unrelated = `ps-unrelated-${randomUUID()}`;
  const belongs = (value: unknown) => users.some(user => value instanceof Uint8Array && Buffer.from(value).equals(Buffer.from(user.user.id, 'base64url')));
  let seeded: ReturnType<typeof rows> | undefined, completed = false;
  await withCleanup(async () => {
    for (const owner of ['a', 'b']) users.push(await confirmedTrailUser(env, `ps-${owner}`));
    for (const [i, user] of users.entries()) await user.client.records('todos').create({ id: nativeUuid(ids[i]), user_id: user.user.id, title: `PS-${i}`, completed: i, priority: i + 1, note: i ? 'control' : null, created_at: 1700000000 + i });
    seeded = rows(main, 'todos');
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    expect(await page.evaluate(async ({ base, account, key, unrelated }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const client = sdk.createClient(base, undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } }, auth: { storageKey: key, autoRefreshToken: false } });
      const login = await client.auth.signInWithPassword({ email: account.email, password: account.password });
      if (login.error || login.data.user?.id !== account.id || !localStorage.getItem(key)) return false;
      // Test-owned backup survives a real document reload; credentials originate only from genuine SDK login.
      sessionStorage.setItem(key, localStorage.getItem(key)!); localStorage.setItem(unrelated, 'keep'); return true;
    }, { base: env.trailUrl, account: { email: users[0].email, password: users[0].password, id: canonicalUuid(users[0].user.id) }, key, unrelated })).toBe(true);
    for (let vector = 0; vector < (schedule === 'corrupt' ? 3 : 1); vector++) {
      if (schedule === 'corrupt') await page.evaluate(({ key, vector }) => {
        const raw = sessionStorage.getItem(key)!, parsed = JSON.parse(raw);
        if (vector === 0) localStorage.setItem(key, raw.slice(0, -7));
        else if (vector === 1) localStorage.setItem(key, JSON.stringify({ ...parsed, version: 2 }));
        else { delete parsed.tokens.refresh_token; localStorage.setItem(key, JSON.stringify(parsed)); }
      }, { key, vector });
      await page.reload();
      expect(await page.evaluate(async ({ base, accounts, ids, key, unrelated, schedule }) => {
        const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
        const check = (value: unknown, label: string) => { if (!value) throw new Error(`PS assertion: ${label}`); };
        const bounded = async <T,>(promise: PromiseLike<T>): Promise<T> => {
          let timer: ReturnType<typeof setTimeout>;
          try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PS operation deadline')), 10000); })]); }
          finally { clearTimeout(timer!); }
        };
        const original = sessionStorage.getItem(key)!, genuine = JSON.parse(original).tokens;
        const marker = `private-storage-${accounts[0].password}-${genuine.refresh_token}`;
        const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
        const disk = localStorage, descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
        const counts = { auth: 0, records: 0, mutations: 0 }, controllers = new Set<AbortController>();
        const observed: typeof fetch = async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path.startsWith('/api/auth/')) counts.auth++;
          if (path.startsWith('/api/records/')) { counts.records++; if (init?.method === 'PATCH') counts.mutations++; }
          const controller = new AbortController(); controllers.add(controller);
          try { return await fetch(input, { ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }); }
          finally { controllers.delete(controller); }
        };
        const storage = { getItem: (k: string) => disk.getItem(k), setItem: (k: string, v: string) => disk.setItem(k, v), removeItem: (k: string) => disk.removeItem(k) };
        const make = (adapter?: import('../../src/index.js').AuthStorage, persistSession = true) => sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession, autoRefreshToken: false, storageKey: key, ...(adapter ? { storage: adapter } : {}) }, global: { fetch: observed } });
        type Client = ReturnType<typeof make>;
        const password = (i: number) => ({ email: accounts[i].email, password: accounts[i].password });
        const safeError = (result: { error: { name: string; message: string } | null }, name: string) => {
          check(result.error?.name === name, `sanitized ${name}`);
          const text = JSON.stringify(result);
          check(![marker, genuine.auth_token, genuine.refresh_token, accounts[0].password, accounts[1].password].some(secret => text.includes(secret)), 'no credential or raw storage error exposure');
        };
        const subscriptions: { unsubscribe(): void }[] = [], pending: Promise<unknown>[] = [];
        const observe = async (client: Client) => {
          const events: { event: string; owner: string | null }[] = [];
          let ready!: () => void; const initial = new Promise<void>(yes => { ready = yes; });
          subscriptions.push(client.auth.onAuthStateChange((event, session) => { events.push({ event, owner: session?.user.id ?? null }); if (event === 'INITIAL_SESSION') ready(); }).data.subscription);
          await bounded(initial); return events;
        };
        const blocked = async (client: Client, name: string) => {
          const before = { ...counts };
          for (const result of [await client.auth.getSession(), await client.auth.getUser(), await client.auth.refreshSession(), await client.auth.signInWithPassword(password(1)), await client.auth.signUp(password(1)), await client.from('todos').select(), await client.from('todos').update({ title: 'forbidden-storage-write' }).eq('id', ids[0])]) {
            safeError(result, name);
            check(result.data === null || Object.values(result.data).every(value => value === null), 'blocked null result');
          }
          check(JSON.stringify(counts) === JSON.stringify(before), 'blocked auth and record dispatch');
        };
        const validOwner = async (client: Client, i: number) => {
          const cached = await client.auth.getSession(), live = await client.auth.getUser();
          check(!cached.error && cached.data.session?.user.id === accounts[i].id && !live.error && live.data.user?.id === accounts[i].id, 'cached and live authoritative owner');
          const row = await client.from('todos').select().eq('id', ids[i]).single();
          const expected = { id: ids[i], user_id: accounts[i].id, title: `PS-${i}`, completed: !!i, priority: i + 1, note: i ? 'control' : null, created_at: 1700000000 + i };
          const canonical = (value: unknown) => JSON.stringify(Object.entries(value as object).sort(([a], [b]) => a.localeCompare(b)));
          check(!row.error && canonical(row.data) === canonical(expected), 'complete authoritative owner row');
          check((await client.from('todos').select().eq('id', ids[1 - i])).data?.length === 0, 'foreign owner remains invisible');
          const final = await client.auth.getSession(), stored = JSON.parse(disk.getItem(key)!);
          check(!final.error && stored.tokens.auth_token === final.data.session?.access_token && stored.tokens.refresh_token === final.data.session?.refresh_token, 'truthful final memory and disk');
        };
        const rawRefresh = async (token: string) => { const response = await observed(`${base}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: token }), credentials: 'omit', redirect: 'error' }); await response.body?.cancel(); return response.status; };
        let release: (() => void) | undefined;
        try {
          if (schedule === 'corrupt') {
            const bad = disk.getItem(key), before = { ...counts }, client = make(), events = await observe(client);
            await blocked(client, 'AuthInvalidStoredSessionError');
            check(JSON.stringify(counts) === JSON.stringify(before) && disk.getItem(key) === bad, 'corrupt payload no repair or dispatch');
            check(JSON.stringify(events) === JSON.stringify([{ event: 'INITIAL_SESSION', owner: null }]), 'corrupt null initialization');
            disk.setItem(key, original); await validOwner(make(), 0);
          } else if (schedule === 'read') {
            for (const mode of ['unavailable', 'throw', 'reject']) {
              disk.setItem(key, original); const before = { ...counts }; let writes = 0;
              if (mode === 'unavailable') Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error(marker); } });
              const client = make(mode === 'unavailable' ? undefined : { ...storage, getItem: () => { if (mode === 'throw') throw new Error(marker); return Promise.reject(new Error(marker)); }, setItem: () => { writes++; }, removeItem: () => { writes++; } });
              const events = await observe(client); await blocked(client, mode === 'unavailable' ? 'AuthStorageUnavailableError' : 'AuthStorageReadError');
              check(JSON.stringify(counts) === JSON.stringify(before) && writes === 0 && disk.getItem(key) === original && events.length === 1 && events[0].owner === null, 'failed hydration disk and events');
              if (descriptor) Object.defineProperty(window, 'localStorage', descriptor); else Reflect.deleteProperty(window, 'localStorage');
            }
            let calls = 0; const fail = () => { calls++; throw new Error(marker); };
            const disabled = make({ getItem: fail, setItem: fail, removeItem: fail }, false);
            check(!(await disabled.auth.signInWithPassword(password(1))).error && (await disabled.auth.getSession()).data.session?.user.id === accounts[1].id, 'real memory-only login');
            check(!(await disabled.auth.signOut({ scope: 'local' })).error && calls === 0 && disk.getItem(key) === original, 'disabled storage zero calls');
            check(!(await disabled.auth.signInWithPassword(password(1))).error && (await disabled.auth.getSession()).data.session?.user.id === accounts[1].id && calls === 0, 'live memory-only session before actual reload');
          } else if (schedule === 'write' || schedule === 'restore') {
            for (const asyncFailure of schedule === 'restore' ? [true] : [false, true]) for (const afterEffect of schedule === 'restore' ? [true] : [false, true]) {
              disk.setItem(key, original); let writes = 0;
              const client = make({ ...storage, setItem: (k, value) => {
                writes++;
                if (writes === 1) { if (afterEffect) disk.setItem(k, value); if (asyncFailure) return Promise.reject(new Error(marker)); throw new Error(marker); }
                if (schedule === 'restore') return Promise.reject(new Error(marker));
                disk.setItem(k, value);
              } });
              const events = await observe(client), result = await client.auth.signInWithPassword(password(1));
              safeError(result, schedule === 'restore' ? 'AuthStorageRestoreError' : 'AuthStorageWriteError');
              check(result.data.user === null && result.data.session === null && writes === 2 && events.every(e => e.event === 'INITIAL_SESSION' && e.owner === accounts[0].id), 'no failed replacement install or notification');
              if (schedule === 'restore') {
                const actual = disk.getItem(key); check(!!actual && actual !== original && JSON.parse(actual).tokens.refresh_token !== genuine.refresh_token, 'actual failed-compensation disk not claimed restored');
                await blocked(client, 'AuthStorageRestoreError'); check(disk.getItem(key) === actual, 'latched failure does not repair disk');
                disk.setItem(key, original); await blocked(client, 'AuthStorageRestoreError'); await validOwner(make(), 0);
              } else { check(disk.getItem(key) === original, 'exact committed A compensation'); await validOwner(client, 0); }
            }
          } else if (schedule === 'logout-remove' || schedule === 'terminal-remove') {
            for (const asyncFailure of [false, true]) for (const afterEffect of [false, true]) {
              disk.removeItem(key);
              const client = make({ ...storage, removeItem: k => { if (afterEffect) disk.removeItem(k); if (asyncFailure) return Promise.reject(new Error(marker)); throw new Error(marker); } });
              const events = await observe(client); const login = await client.auth.signInWithPassword(password(0)); check(!login.error && !!login.data.session, 'real removable session');
              const token = login.data.session!.refresh_token, saved = disk.getItem(key);
              if (schedule === 'terminal-remove') {
                const response = await observed(`${base}/api/auth/v1/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: token }), credentials: 'omit', redirect: 'error' });
                check(response.status === 200, 'genuine captured-session revocation'); await response.body?.cancel();
              }
              const result = schedule === 'logout-remove' ? await client.auth.signOut({ scope: 'local' }) : await client.auth.refreshSession();
              safeError(result, 'AuthStorageRemoveError'); check(await rawRefresh(token) === 401, 'real rejected captured refresh');
              check(disk.getItem(key) === (afterEffect ? null : saved), 'remove rejection actual disk effect');
              check(JSON.stringify(events.map(e => [e.event, e.owner])) === JSON.stringify([['INITIAL_SESSION', null], ['SIGNED_IN', accounts[0].id], ['SIGNED_OUT', null]]), 'exact null terminal event');
              await blocked(client, 'AuthStorageRemoveError');
              disk.removeItem(key); await blocked(client, 'AuthStorageRemoveError'); check((await make().auth.getSession()).data.session === null, 'external removal new instance null');
            }
          } else {
            disk.setItem(key, original);
            let entered!: () => void; const arrival = new Promise<void>(yes => { entered = yes; });
            const gate = new Promise<void>(yes => { release = yes; }); let held = false;
            const client = make({ ...storage,
              getItem: async k => { const value = disk.getItem(k); if (schedule === 'held-read') { entered(); await bounded(gate); } return value; },
              setItem: async (k, value) => { disk.setItem(k, value); if (schedule === 'held-write' && !held) { held = true; entered(); await bounded(gate); } },
            });
            const events: { event: string; owner: string | null }[] = [];
            subscriptions.push(client.auth.onAuthStateChange((event, session) => events.push({ event, owner: session?.user.id ?? null })).data.subscription);
            const old = schedule === 'held-write' ? client.auth.refreshSession() : client.auth.getSession(); pending.push(old);
            await bounded(arrival);
            // Start the lazy query now so it joins the held flight before logout changes generation.
            const mutation = schedule === 'held-write' ? client.from('todos').update({ title: 'stale-write' }).eq('id', ids[0]).then(result => result) : undefined;
            if (mutation) pending.push(mutation);
            const logout = client.auth.signOut({ scope: 'local' }); pending.push(logout);
            const login = client.auth.signInWithPassword(password(1)); pending.push(login);
            release!(); const prior = await bounded(old);
            if (schedule === 'held-write') { safeError(prior, 'AuthStaleOperationError'); safeError(await mutation!, 'AuthStaleOperationError'); }
            else check(!prior.error && prior.data.session?.user.id !== accounts[0].id, 'held hydration never revives A');
            check(!(await bounded(logout)).error && !(await bounded(login)).error, 'logout and new-owner commit settle');
            check(await rawRefresh(genuine.refresh_token) === 401, 'old hydration/refresh credential revoked');
            check(counts.mutations === 0, 'no stale mutation dispatch');
            check(JSON.stringify(events.map(e => [e.event, e.owner])) === JSON.stringify([['INITIAL_SESSION', schedule === 'held-write' ? accounts[0].id : null], ['SIGNED_OUT', null], ['SIGNED_IN', accounts[1].id]]), 'exact storage-race events without late A');
            await validOwner(client, 1);
          }
          check(disk.getItem(unrelated) === 'keep' && counts.mutations === 0, 'unrelated key and zero forbidden mutations');
          return true;
        } finally {
          release?.(); for (const controller of controllers) controller.abort();
          await bounded(Promise.allSettled(pending)); for (const subscription of subscriptions) subscription.unsubscribe();
          if (descriptor) Object.defineProperty(window, 'localStorage', descriptor); else Reflect.deleteProperty(window, 'localStorage');
        }
      }, { base: env.trailUrl, accounts: users.map(user => ({ id: canonicalUuid(user.user.id), email: user.email, password: user.password })), ids, key, unrelated, schedule })).toBe(true);
    }
    if (schedule === 'read') {
      await page.reload();
      expect(await page.evaluate(async base => {
        const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
        const client = sdk.createClient(base, undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } }, auth: { persistSession: false, autoRefreshToken: false } });
        const result = await client.auth.getSession(); return !result.error && result.data.session === null;
      }, env.trailUrl)).toBe(true);
    }
    expect(pageErrors).toEqual([]);
    expect(rows(main, 'todos')).toEqual(seeded);
    expect(rows(main, 'todo_audit').filter(row => belongs(row.user_id)).map(row => row.operation)).toEqual(['INSERT', 'INSERT']);
    completed = true;
  }, [
    async () => { if (!page.isClosed()) { try { await page.evaluate(({ key, unrelated }) => { localStorage.removeItem(key); sessionStorage.removeItem(key); localStorage.removeItem(unrelated); }, { key, unrelated }); } finally { await page.close(); } } },
    ...[0, 1].map(index => async () => {
      const user = users[index]; if (!user) return; await user.client.login(user.email, user.password);
      await cleanupOwnedRows(user.client.records('todos'), nativeUuid(canonicalUuid(user.user.id)), [nativeUuid(ids[index])]);
      const response = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { headers: { authorization: `Bearer ${user.client.tokens()!.auth_token}` }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await response.body?.cancel(); expect(response.status).toBe(303);
    }),
    async () => {
      expect(rows(main, 'todos')).toEqual(before.todos);
      expect(rows(sessions, '_session').filter(row => belongs(row.user))).toEqual([]);
      expect(rows(sessions, '_session').filter(row => !belongs(row.user))).toEqual(before.sessions);
      expect(rows(main, '_user').filter(row => !belongs(row.id))).toEqual(before.users);
      expect(rows(main, 'todo_audit').filter(row => !belongs(row.user_id))).toEqual(before.audit);
      if (completed) expect(rows(main, 'todo_audit').filter(row => belongs(row.user_id)).map(row => row.operation)).toEqual(['INSERT', 'INSERT', 'DELETE', 'DELETE']);
    },
    async () => { main.close(); sessions.close(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
