import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { context, confirmedTrailUser, canonicalUuid, nativeUuid, nativeAuthSnapshot } from '../phase-a/helpers.js';
import { withCleanup, cleanupOwnedRows } from '../sdk-browser/cleanup.js';

type Schedule = 'expiry' | 'logout' | 'replace' | 'logout-replace';
declare global {
  interface Window {
    packedRace?: { run(schedule: Schedule): Promise<{ sharedRefreshes: number; staleMutationRequests: number; finalOwner: 'A' | 'B' | null; eventsChecked: boolean; persisted: boolean }>; rejectExpiredGlobal(): Promise<boolean>; dispose(): Promise<void> };
  }
}
const cases: [string, Schedule][] = [
  ['PB01 genuine expiry and shared data/session/manual renewal', 'expiry'],
  ['PB02 delayed genuine renewal versus awaited local logout', 'logout'],
  ['PB03 delayed genuine renewal versus direct new-owner login', 'replace'],
  ['PB04 delayed genuine renewal versus local logout then new-owner login', 'logout-replace'],
];
for (const [name, schedule] of cases) test(`L1-16–20/L1-24/E08/E10/E11/E13/S07/S08 ${name}`, async ({ page }) => {
  const env = await context();
  if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'short-native-auth' || env.nativeServerProfile !== 'default') throw new Error('PB cases require owned official short-native-auth');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  const sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const rows = (db: DatabaseSync, table: '_user' | '_session' | 'todos' | 'todo_audit') => {
    const statement = db.prepare(`SELECT * FROM ${table} ORDER BY ${table === '_session' ? 'user,refresh_token' : table === 'todo_audit' ? 'audit_key' : 'id'}`);
    statement.setReadBigInts(true); return statement.all();
  };
  const before = { users: rows(main, '_user'), sessions: rows(sessions, '_session'), todos: rows(main, 'todos'), audit: rows(main, 'todo_audit') };
  const users: Awaited<ReturnType<typeof confirmedTrailUser>>[] = [], ids = [randomUUID(), randomUUID()];
  const key = `pb-owned-${randomUUID()}`, unrelated = `pb-unrelated-${randomUUID()}`;
  let seeded: ReturnType<typeof rows> | undefined, completed = false;
  const belongs = (value: unknown) => users.some(user => value instanceof Uint8Array && Buffer.from(value).equals(Buffer.from(user.user.id, 'base64url')));
  await withCleanup(async () => {
    // Registration/mail already has packed-app coverage; these genuine ordinary fixture owners are not fabricated browser sessions.
    users.push(await confirmedTrailUser(env, 'pb-a')); users.push(await confirmedTrailUser(env, 'pb-b'));
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    expect(await page.evaluate(async ({ base, accounts, ids, key, unrelated }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const check = (value: unknown, label: string) => { if (!value) throw new Error(`PB assertion: ${label}`); };
      const bounded = async <T,>(operation: PromiseLike<T>, label: string, milliseconds = 10000): Promise<T> => {
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([operation, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`PB deadline: ${label}`)), milliseconds); })]); }
        finally { clearTimeout(timer!); }
      };
      const pending: Promise<unknown>[] = [], controllers = new Set<AbortController>();
      let disposed = false, cancelHeld: (() => void) | undefined;
      const fetchReal = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (disposed) throw new Error('PB owned transport closed');
        const controller = new AbortController(); controllers.add(controller);
        try { return await fetch(input, { ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }); }
        finally { controllers.delete(controller); }
      };
      const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
      let hold = false, release!: () => void, received!: () => void;
      let gate: Promise<void>, arrival: Promise<void>, responseStatus = 0, refreshes = 0, records = 0, mutations = 0;
      const arm = () => { gate = new Promise(yes => { release = yes; }); arrival = new Promise(yes => { received = yes; }); hold = true; refreshes = records = mutations = 0; };
      const observed: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.startsWith('/api/records/')) { records++; if (init?.method === 'PATCH') mutations++; }
        if (path.endsWith('/refresh')) refreshes++;
        const response = await fetchReal(input, init);
        if (hold && path.endsWith('/refresh')) {
          hold = false; cancelHeld = () => { void response.body?.cancel().catch(() => {}); }; responseStatus = response.status; received();
          // Deliver the actual response unchanged, only after the explicit test barrier.
          await bounded(gate, 'release genuine renewal');
        }
        return response;
      };
      const make = (persist: boolean, transport: typeof fetch = fetchReal) => sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: persist, autoRefreshToken: false, ...(persist ? { storageKey: key } : {}) }, global: { fetch: transport } });
      const client = make(true, observed), control = make(false);
      const label = (id?: string) => id === accounts[0].id ? 'A' : id === accounts[1].id ? 'B' : id === undefined ? null : 'unexpected';
      const events: { event: string; owner: ReturnType<typeof label>; committed: boolean }[] = [], callbackErrors: string[] = [];
      let initialized!: () => void; const initial = new Promise<void>(yes => { initialized = yes; });
      const subscription = client.auth.onAuthStateChange((event, session) => {
        try {
          const stored = localStorage.getItem(key);
          // SIGNED_OUT is an immediate null notification, not a promise that async removal already settled.
          const committed = session === null || !!stored && JSON.parse(stored).tokens.auth_token === session.access_token && JSON.parse(stored).tokens.refresh_token === session.refresh_token;
          events.push({ event, owner: label(session?.user.id), committed });
          if (event === 'INITIAL_SESSION') initialized();
        } catch { callbackErrors.push('callback-state-check'); }
      }).data.subscription;
      window.packedRace = { run: async () => { throw new Error('PB setup incomplete'); }, rejectExpiredGlobal: async () => {
        const expiredKey = `${key}-expired-global`, currentDisk = localStorage.getItem(key); let exchanges = 0;
        // Secondary negative reload uses the verbatim genuine SDK-persisted frame, never a synthetic JWT or primary-flow session stub.
        localStorage.setItem(expiredKey, oldFrame);
        try {
          const expired = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: expiredKey }, global: { fetch: (input, init) => {
            exchanges++; check(String(input) === `${base}/api/auth/v1/logout` && init?.method === 'GET' && new Headers(init.headers).get('authorization') === `Bearer ${old.access_token}`, 'expired global captured JWT only, no renewal/probe');
            return fetchReal(input, init);
          } } });
          const result = await bounded(expired.auth.signOut(), 'expired global native rejection');
          check(result.error?.status === 401 && exchanges === 1, 'expired global401 not suppressed or replayed');
          check((await expired.auth.getSession()).data.session === null && localStorage.getItem(expiredKey) === null, 'expired global owned state cleared');
          check(localStorage.getItem(key) === currentDisk && localStorage.getItem(unrelated) === 'keep', 'independent original storage unchanged'); return true;
        } finally { localStorage.removeItem(expiredKey); }
      }, dispose: async () => {
        disposed = true; for (const controller of controllers) controller.abort(); cancelHeld?.(); release?.();
        await bounded(Promise.allSettled(pending), 'drain owned operations');
        subscription.unsubscribe(); localStorage.removeItem(key); localStorage.removeItem(unrelated);
      } };
      localStorage.setItem(unrelated, 'keep'); await bounded(initial, 'initial notification');
      const password = (index: number) => ({ email: accounts[index].email, password: accounts[index].password });
      const first = await bounded(client.auth.signInWithPassword(password(0)), 'password A');
      const second = await bounded(control.auth.signInWithPassword(password(1)), 'password B control');
      check(!first.error && first.data.user?.id === accounts[0].id && first.data.session?.expires_in === 3, 'genuine three-second A login');
      check(!second.error && second.data.user?.id === accounts[1].id, 'genuine B control login');
      check(!(await bounded(client.from('todos').insert({ id: ids[0], user_id: accounts[0].id, title: `A-${ids[0]}` }), 'seed A')).error, 'A seed');
      check(!(await bounded(control.from('todos').insert({ id: ids[1], user_id: accounts[1].id, title: `B-${ids[1]}` }), 'seed B')).error, 'B seed');
      const a = await bounded(client.from('todos').select('*').eq('id', ids[0]).single(), 'golden A');
      const b = await bounded(control.from('todos').select('*').eq('id', ids[1]).single(), 'golden B');
      check(!a.error && !b.error && a.data?.user_id === accounts[0].id && b.data?.user_id === accounts[1].id, 'complete owner controls');
      const canonical = (value: unknown) => JSON.stringify(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
      check(Object.keys(a.data!).sort().join(',') === 'completed,created_at,id,note,priority,title,user_id', 'seven scalar A row');
      const goldenA = canonical(a.data), goldenB = { ...b.data, title: `B-final-${ids[1]}` };
      const old = (await client.auth.getSession()).data.session!, oldFrame = localStorage.getItem(key)!;
      window.packedRace.run = async schedule => {
        const phaseEvents = events.map(e => `${e.event}:${e.owner}`), phaseEventCount = events.length;
        check(phaseEvents[0] === 'INITIAL_SESSION:null' && phaseEvents[1] === 'SIGNED_IN:A' && phaseEvents.slice(2).every(e => e === 'TOKEN_REFRESHED:A'), 'initial and setup event sequence');
        if (schedule === 'expiry') {
          const until = Date.now() + 80000;
          // Native JWT leeway is real: require actual server denial, not just a decoded exp or arbitrary sleep.
          for (;;) {
            const response = await fetchReal(`${base}/api/records/v1/todos`, { headers: { authorization: `Bearer ${old.access_token}` }, credentials: 'omit', redirect: 'error' });
            const status = response.status; await response.body?.cancel();
            if (status === 401 || status === 403) { check(Date.now() / 1000 > old.expires_at, 'actual expiry clock'); break; }
            check(status === 200 && Date.now() < until, 'actual native denial deadline');
            await new Promise(yes => setTimeout(yes, 250));
          }
        }
        arm(); const diskBefore = localStorage.getItem(key);
        let shared: Promise<{ error: unknown; data?: unknown }>;
        if (schedule === 'expiry') {
          shared = client.from('todos').select('*').eq('id', ids[0]).single().then(result => result);
        } else shared = client.auth.refreshSession();
        pending.push(shared); await bounded(arrival!, 'genuine refresh response');
        check(responseStatus === 200 && refreshes === 1 && records === 0, 'one held successful response before records');
        // Calling then starts execution synchronously; native transport enters sessionReady and joins this exact held flight.
        const queued = schedule === 'expiry'
          ? client.from('todos').select('*').eq('id', ids[0]).single().then(result => result)
          : client.from('todos').update({ title: 'stale-A-write' }).eq('id', ids[0]).then(result => result);
        const cached = client.auth.getSession(); pending.push(queued, cached);
        if (schedule === 'expiry') {
          const manual = client.auth.refreshSession(); pending.push(manual);
          check(refreshes === 1 && records === 0, 'shared preflight join'); release();
          const results = await bounded(Promise.all([shared, queued, cached, manual]), 'shared expiry results');
          check(results.every(result => !result.error), 'all shared operations succeed');
          check(refreshes === 1 && records === 2 && mutations === 0, 'exact shared request counts');
          const renewed = results[2].data.session;
          check(renewed?.user.id === accounts[0].id && renewed.refresh_token === old.refresh_token && renewed.access_token !== old.access_token && renewed.expires_at > old.expires_at, 'genuine retained refresh and new access');
          check(localStorage.getItem(key) !== diskBefore, 'renewed persistence');
          check(canonical(results[0].data) === goldenA && canonical(results[1].data) === goldenA, 'both complete A rows after shared expiry');
          check(events.map(e => `${e.event}:${e.owner}`).join(',') === [...phaseEvents, 'TOKEN_REFRESHED:A'].join(','), 'exact expiry notifications');
        } else {
          if (schedule !== 'replace') {
            check(!(await bounded(client.auth.signOut({ scope: 'local' }), 'local signout')).error, 'local exact acknowledgement');
            check(localStorage.getItem(key) === null, 'awaited owned-key removal');
            const denied = await fetchReal(`${base}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: old.refresh_token }), credentials: 'omit', redirect: 'error' });
            check(denied.status === 401, 'captured local refresh revoked'); await denied.body?.cancel();
          }
          if (schedule !== 'logout') {
            const replacement = await bounded(client.auth.signInWithPassword(password(1)), 'new owner password');
            check(!replacement.error && replacement.data.user?.id === accounts[1].id, 'real B replacement');
          }
          const committed = localStorage.getItem(key); release();
          const stale = await bounded(Promise.all([shared, queued, cached]), 'stale old generation settlement');
          check(stale.every(result => result.error && (result.error as { name: string }).name === 'AuthStaleOperationError'), 'old auth and queued mutation stale');
          check(mutations === 0 && records === 0 && localStorage.getItem(key) === committed, 'no stale dispatch or persisted overwrite');
          const wanted = [...phaseEvents, ...(schedule !== 'replace' ? ['SIGNED_OUT:null'] : []), ...(schedule !== 'logout' ? ['SIGNED_IN:B'] : [])].join(',');
          check(events.map(e => `${e.event}:${e.owner}`).join(',') === wanted, 'no late old-owner event');
          if (schedule === 'replace') {
            const retained = await fetchReal(`${base}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: old.refresh_token }), credentials: 'omit', redirect: 'error' });
            check(retained.status === 200, 'replacement alone is not remote A revocation'); await retained.body?.cancel();
          }
        }
        const sharedRefreshes = refreshes;
        const finalOwner = schedule === 'logout' ? null : schedule === 'expiry' ? 'A' : 'B';
        const current = await bounded(client.auth.getSession(), 'final cached identity');
        check(!current.error && label(current.data.session?.user.id) === finalOwner, 'final current identity');
        if (finalOwner) {
          const live = await bounded(client.auth.getUser(), 'final live user');
          check(!live.error && label(live.data.user?.id) === finalOwner, 'real final live acknowledgement');
          const final = await client.auth.getSession(), disk = JSON.parse(localStorage.getItem(key)!);
          check(label(final.data.session?.user.id) === finalOwner && disk.version === 1 && disk.tokens.auth_token === final.data.session?.access_token && disk.tokens.refresh_token === final.data.session?.refresh_token, 'final identity and persisted credentials');
          if (finalOwner === 'B') check((await client.from('todos').select('*').eq('id', ids[0])).data?.length === 0, 'new owner cannot read A');
        } else check(current.data.session === null && localStorage.getItem(key) === null, 'no revived signed-out state');
        check(!(await bounded(control.from('todos').update({ title: goldenB.title }).eq('id', ids[1]), 'B control write')).error, 'live independent B barrier');
        check(canonical((await control.from('todos').select('*').eq('id', ids[1]).single()).data) === canonical(goldenB), 'complete B control after schedule');
        check(localStorage.getItem(unrelated) === 'keep' && callbackErrors.length === 0 && events.every(e => e.committed), 'owned storage and event consistency');
        check(events.slice(phaseEventCount).filter(e => e.event === 'TOKEN_REFRESHED').every(e => e.owner === finalOwner), 'no refreshed old-owner notification');
        return { sharedRefreshes, staleMutationRequests: mutations, finalOwner, eventsChecked: true, persisted: true };
      };
      return true;
    }, { base: env.trailUrl, accounts: users.map(user => ({ id: canonicalUuid(user.user.id), email: user.email, password: user.password })), ids, key, unrelated })).toBe(true);
    seeded = rows(main, 'todos').filter(row => belongs(row.user_id)); expect(seeded).toHaveLength(2);
    const result = await page.evaluate(schedule => window.packedRace!.run(schedule), schedule);
    expect(result).toEqual({ sharedRefreshes: 1, staleMutationRequests: 0, finalOwner: schedule === 'logout' ? null : schedule === 'expiry' ? 'A' : 'B', eventsChecked: true, persisted: true });
    const after = rows(main, 'todos').filter(row => belongs(row.user_id));
    expect(after.find(row => row.id instanceof Uint8Array && Buffer.from(row.id).equals(Buffer.from(ids[0].replaceAll('-', ''), 'hex')))).toEqual(seeded.find(row => row.id instanceof Uint8Array && Buffer.from(row.id).equals(Buffer.from(ids[0].replaceAll('-', ''), 'hex'))));
    expect(after.find(row => row.id instanceof Uint8Array && Buffer.from(row.id).equals(Buffer.from(ids[1].replaceAll('-', ''), 'hex')))).toEqual({ ...seeded.find(row => row.id instanceof Uint8Array && Buffer.from(row.id).equals(Buffer.from(ids[1].replaceAll('-', ''), 'hex'))), title: `B-final-${ids[1]}` });
    expect(rows(main, 'todo_audit').filter(row => belongs(row.user_id)).map(row => row.operation)).toEqual(['INSERT', 'INSERT', 'UPDATE']);
    if (schedule === 'expiry') {
      const expiredBefore = nativeAuthSnapshot(main, sessions);
      expect(await page.evaluate(() => window.packedRace!.rejectExpiredGlobal())).toBe(true);
      expect(nativeAuthSnapshot(main, sessions)).toEqual(expiredBefore);
      // A genuine page reload hydrates the persisted short-TTL credentials, never a token injected by the driver.
      await page.reload();
      expect(await page.evaluate(async ({ base, owner, id, key, unrelated }) => {
        const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
        const client = sdk.createClient(base, undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' }, user_id: { type: 'uuid' }, title: { type: 'text' }, completed: { type: 'boolean' }, priority: { type: 'integer' }, note: { type: 'text', nullable: true }, created_at: { type: 'integer' } } } } }, auth: { persistSession: true, autoRefreshToken: false, storageKey: key } });
        const initial: (string | undefined)[] = [];
        const subscription = client.auth.onAuthStateChange((event, session) => { if (event === 'INITIAL_SESSION') initial.push(session?.user.id); }).data.subscription;
        try {
          const session = await client.auth.getSession(), live = await client.auth.getUser(), row = await client.from('todos').select('*').eq('id', id).single(), final = await client.auth.getSession();
          const disk = JSON.parse(localStorage.getItem(key)!);
          return !session.error && session.data.session?.user.id === owner && !live.error && live.data.user?.id === owner && !row.error && row.data?.user_id === owner && row.data.id === id && row.data.title === `A-${id}` && !final.error && disk.tokens.auth_token === final.data.session?.access_token && disk.tokens.refresh_token === final.data.session?.refresh_token && initial.length === 1 && initial[0] === owner && localStorage.getItem(unrelated) === 'keep';
        } finally { subscription.unsubscribe(); }
      }, { base: env.trailUrl, owner: canonicalUuid(users[0].user.id), id: ids[0], key, unrelated })).toBe(true);
    }
    completed = true;
  }, [
    async () => { if (!page.isClosed()) { try { await page.evaluate(async ({ key, unrelated }) => { await window.packedRace?.dispose(); delete window.packedRace; localStorage.removeItem(key); localStorage.removeItem(unrelated); }, { key, unrelated }); } finally { await page.close(); } } },
    ...[0, 1].map(index => async () => {
        const user = users[index]; if (!user) return; await user.client.login(user.email, user.password);
        await cleanupOwnedRows(user.client.records('todos'), nativeUuid(canonicalUuid(user.user.id)), [nativeUuid(ids[index])]);
        const response = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { headers: { authorization: `Bearer ${user.client.tokens()!.auth_token}` }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(10000) });
        await response.body?.cancel(); expect(response.status).toBe(303);
        // A raw303 is not an SDK receipt: independently measure actual owned-session absence below.
    }),
    async () => {
      expect(rows(main, 'todos')).toEqual(before.todos);
      expect(rows(sessions, '_session').filter(row => belongs(row.user))).toEqual([]);
      expect(rows(sessions, '_session').filter(row => !belongs(row.user))).toEqual(before.sessions);
      expect(rows(main, '_user').filter(row => !belongs(row.id))).toEqual(before.users);
      expect(rows(main, 'todo_audit').filter(row => !belongs(row.user_id))).toEqual(before.audit);
      if (completed) expect(rows(main, 'todo_audit').filter(row => belongs(row.user_id)).map(row => row.operation)).toEqual(['INSERT', 'INSERT', 'UPDATE', 'DELETE', 'DELETE']);
    },
    async () => { main.close(); sessions.close(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
