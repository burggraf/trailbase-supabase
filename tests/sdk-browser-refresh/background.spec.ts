import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { context, confirmedTrailUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { withCleanup, cleanupOwnedRows } from '../sdk-browser/cleanup.js';

type Schedule = 'timer' | 'disabled' | 'focus' | 'network' | 'http503' | 'truncated' | 'http403' | 'terminal';
const cases: [string, Schedule][] = [
  ['BF01 default real timer renews without public request trigger', 'timer'],
  ['BF02 disabled background owns no scheduling but manual renewal works', 'disabled'],
  ['BF03 visible DOM focus handlers share genuine held renewal', 'focus'],
  ['BF04 cancelled Fetch retains state and genuinely retries', 'network'],
  ['BF05 injected HTTP503 retains state and genuinely retries', 'http503'],
  ['BF06 truncated genuine reply retains state and genuinely retries', 'truncated'],
  ['BF07 injected HTTP403 retains state and genuinely retries', 'http403'],
  ['BF08 genuine refresh401 stops scheduling and explicit login recovers', 'terminal'],
];
declare global { interface Window { packedBackgroundDispose?: () => Promise<void> } }
for (const [name, schedule] of cases) test(`L1-16/L1-18–20/E08/E10/E13/S04/S07/S08 ${name}`, async ({ page }) => {
  const env = await context();
  if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'short-native-auth' || env.nativeServerProfile !== 'default') throw new Error('BF cases require owned official short-native-auth');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  const sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const rows = (db: DatabaseSync, table: '_user' | '_session' | 'todos' | 'todo_audit') => {
    const statement = db.prepare(`SELECT * FROM ${table} ORDER BY ${table === '_session' ? 'user,refresh_token' : table === 'todo_audit' ? 'audit_key' : 'id'}`);
    statement.setReadBigInts(true); return statement.all();
  };
  const before = { users: rows(main, '_user'), sessions: rows(sessions, '_session'), todos: rows(main, 'todos'), audit: rows(main, 'todo_audit') };
  const users: Awaited<ReturnType<typeof confirmedTrailUser>>[] = [], ids = [randomUUID(), randomUUID()];
  const key = `bf-owned-${randomUUID()}`, unrelated = `bf-unrelated-${randomUUID()}`;
  const belongs = (value: unknown) => users.some(user => value instanceof Uint8Array && Buffer.from(value).equals(Buffer.from(user.user.id, 'base64url')));
  let seeded: ReturnType<typeof rows> | undefined, ownersBefore: ReturnType<typeof rows> | undefined, completed = false;
  const pageErrors: string[] = []; page.on('pageerror', () => pageErrors.push('unhandled-browser-error'));
  await withCleanup(async () => {
    users.push(await confirmedTrailUser(env, 'bf-a')); users.push(await confirmedTrailUser(env, 'bf-b'));
    for (const [index, user] of users.entries()) await user.client.records('todos').create({ id: nativeUuid(ids[index]), user_id: user.user.id, title: `BF-${ids[index]}`, completed: 0, priority: 7, note: null, created_at: 1780000000 });
    seeded = rows(main, 'todos').filter(row => belongs(row.user_id)); expect(seeded).toHaveLength(2);
    ownersBefore = rows(main, '_user').filter(row => belongs(row.id));
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    expect(await page.evaluate(async ({ base, accounts, ids, key, unrelated, schedule }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const check = (condition: unknown, label: string) => { if (!condition) throw new Error(`BF assertion: ${label}`); };
      const originalSet = window.setTimeout, originalClear = window.clearTimeout;
      const realSet = originalSet.bind(window), realClear = originalClear.bind(window);
      const realAdd = EventTarget.prototype.addEventListener, realRemove = EventTarget.prototype.removeEventListener;
      const timers = new Map<number, { delay: number; at: number }>(), fired: { delay: number; elapsed: number }[] = [];
      const focus = new Set<EventListenerOrEventListenerObject>(), visibility = new Set<EventListenerOrEventListenerObject>();
      // Observe native resources; preserve real callbacks, arguments, deadlines and browser time.
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        check(typeof handler === 'function', 'function timer callback');
        const entry = { delay: delay ?? 0, at: performance.now() };
        const id = realSet(() => { timers.delete(id); fired.push({ delay: entry.delay, elapsed: performance.now() - entry.at }); Reflect.apply(handler as (...values: unknown[]) => void, window, args); }, delay);
        timers.set(id, entry); return id;
      }) as typeof window.setTimeout;
      window.clearTimeout = ((id?: number) => { if (id !== undefined) timers.delete(id); realClear(id); }) as typeof window.clearTimeout;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (listener && this === window && type === 'focus') focus.add(listener);
        if (listener && this === document && type === 'visibilitychange') visibility.add(listener);
        realAdd.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (listener && this === window && type === 'focus') focus.delete(listener);
        if (listener && this === document && type === 'visibilitychange') visibility.delete(listener);
        realRemove.call(this, type, listener, options);
      };
      const bounded = async <T,>(operation: PromiseLike<T>, label: string, milliseconds = 10000): Promise<T> => {
        let timer: number | undefined;
        try { return await Promise.race([operation, new Promise<never>((_, no) => { timer = realSet(() => no(new Error(`BF deadline: ${label}`)), milliseconds); })]); }
        finally { realClear(timer); }
      };
      let release!: () => void, arrived!: () => void, renewed!: () => void, initial!: () => void;
      const gate = new Promise<void>(yes => { release = yes; }), arrival = new Promise<void>(yes => { arrived = yes; });
      const tokenEvent = new Promise<void>(yes => { renewed = yes; }), initialEvent = new Promise<void>(yes => { initial = yes; });
      const pending: Promise<unknown>[] = [], controllers = new Set<AbortController>();
      let disposed = false, refreshes = 0, nativeSuccesses = 0, nativeRejected = 0, logins = 0, mutations = 0;
      let baselineRefresh = '', baselineDisk: string | null = null, eventFailure = false, firstFaultSettled = false;
      const wire: typeof fetch = async (input, init) => {
        if (disposed) throw new Error('BF owned transport closed');
        const controller = new AbortController(); controllers.add(controller);
        try { return await fetch(input, { ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }); }
        finally { controllers.delete(controller); }
      };
      const transient = ['network', 'http503', 'truncated', 'http403'].includes(schedule);
      const observed: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/login')) logins++;
        if (path.startsWith('/api/records/') && init?.method && init.method !== 'GET') mutations++;
        if (!path.endsWith('/refresh')) return wire(input, init);
        const attempt = ++refreshes;
        check(JSON.parse(String(init?.body)).refresh_token === baselineRefresh, 'captured genuine refresh retained');
        if (attempt === 1 && schedule === 'network') {
          arrived(); await bounded(gate, 'cancelled Fetch observer joins');
          const aborted = new AbortController(); aborted.abort();
          try { return await wire(input, { ...init, signal: aborted.signal }); }
          finally { firstFaultSettled = true; }
        }
        const response = await wire(input, init);
        if (response.status === 200) nativeSuccesses++; if (response.status === 401) nativeRejected++;
        if (attempt !== 1 || schedule === 'timer' || schedule === 'disabled') return response;
        arrived(); await bounded(gate, 'release actual first response');
        if (schedule === 'http503' || schedule === 'http403') {
          check(response.status === 200, 'genuine native success before injected failure-only HTTP'); await response.body?.cancel();
          firstFaultSettled = true; return new Response('Injected background delivery failure', { status: schedule === 'http503' ? 503 : 403 });
        }
        if (schedule === 'truncated') {
          check(response.status === 200, 'genuine native success before truncation'); const bytes = new Uint8Array(await response.arrayBuffer());
          firstFaultSettled = true; return new Response(bytes.slice(0, -1), { status: response.status, headers: response.headers });
        }
        return response; // Focus and terminal branches deliver the genuine reply unchanged.
      };
      const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
      const client = sdk.createClient(base, undefined, { trailbase: mapping, auth: { storageKey: key, ...(schedule === 'disabled' ? { autoRefreshToken: false } : {}) }, global: { fetch: observed } });
      const control = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: wire } });
      const events: { event: string; owner: string | null }[] = [];
      const refreshed: { session: import('../../src/index.js').AuthSession | null } = { session: null };
      const subscription = client.auth.onAuthStateChange((event, session) => {
        try {
          if (session) { const disk = JSON.parse(localStorage.getItem(key)!); if (disk.tokens.auth_token !== session.access_token || disk.tokens.refresh_token !== session.refresh_token) eventFailure = true; }
          events.push({ event, owner: session?.user.id ?? null });
          if (event === 'INITIAL_SESSION') initial();
          if (event === 'TOKEN_REFRESHED') { refreshed.session = session; renewed(); }
        } catch { eventFailure = true; }
      }).data.subscription;
      const resources = (enabled: boolean, delay?: number) => {
        check(timers.size === (enabled ? 1 : 0) && focus.size === (enabled ? 1 : 0) && visibility.size === (enabled ? 1 : 0), 'exact owned timer and listener resources');
        if (delay !== undefined) check([...timers.values()][0]?.delay === delay, 'documented native timer delay');
      };
      const stimuli = () => { check(document.visibilityState === 'visible', 'genuine visible document'); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); };
      window.packedBackgroundDispose = async () => {
        release(); for (const controller of controllers) controller.abort(); await bounded(Promise.allSettled(pending), 'drain owned joined operations');
        try { await bounded(client.auth.signOut({ scope: 'local' }), 'final primary local teardown'); await bounded(control.auth.signOut({ scope: 'local' }), 'final control local teardown'); }
        finally {
          subscription.unsubscribe(); disposed = true;
          window.setTimeout = originalSet; window.clearTimeout = originalClear;
          EventTarget.prototype.addEventListener = realAdd; EventTarget.prototype.removeEventListener = realRemove;
          localStorage.removeItem(key); localStorage.removeItem(unrelated);
        }
      };
      localStorage.setItem(unrelated, 'keep'); await bounded(initialEvent, 'initial notification');
      const password = (index: number) => ({ email: accounts[index].email, password: accounts[index].password });
      check(!(await bounded(control.auth.signInWithPassword(password(1)), 'control genuine password')).error, 'control login');
      const login = await bounded(client.auth.signInWithPassword(password(0)), 'primary genuine password');
      check(!login.error && login.data.session?.expires_in === 3 && login.data.user?.id === accounts[0].id, 'genuine primary three-second login');
      baselineRefresh = login.data.session!.refresh_token; baselineDisk = localStorage.getItem(key);
      resources(schedule !== 'disabled', schedule === 'disabled' ? undefined : 1000);
      check(events.map(e => e.event).join(',') === 'INITIAL_SESSION,SIGNED_IN', 'exact initial login events');
      if (schedule === 'disabled') {
        stimuli(); check(refreshes === 0, 'disabled handler stimuli dispatch zero renewal'); resources(false);
        const manual = await bounded(client.auth.refreshSession(), 'disabled background explicit renewal'); check(!manual.error, 'explicit renewal remains enabled');
      } else if (schedule === 'timer') {
        await bounded(tokenEvent, 'native timer-driven renewal');
        check(fired.some(timer => timer.delay === 1000 && timer.elapsed >= 900), 'real minimum-delay timer fired');
      } else {
        if (schedule === 'terminal') {
          const revoked = await wire(`${base}/api/auth/v1/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: baselineRefresh }), credentials: 'omit', redirect: 'error' });
          check(revoked.status === 200, 'real exact-session revocation'); await revoked.body?.cancel();
        }
        if (schedule === 'focus') stimuli();
        await bounded(arrival, 'background first attempt');
        check(refreshes === 1 && localStorage.getItem(key) === baselineDisk && events.length === 2, 'one held first attempt without premature commit');
        const joined = client.auth.getSession(); pending.push(joined);
        if (schedule === 'focus') { stimuli(); stimuli(); check(refreshes === 1, 'focus visibility handlers coalesce one flight'); }
        release(); const outcome = await bounded(joined, 'joined background outcome');
        if (schedule === 'focus') check(!outcome.error, 'genuine focus renewal succeeds');
        else if (transient) {
          check(outcome.data.session === null && !!outcome.error, 'joined transient error is observable without cached success');
          if (schedule === 'http503' || schedule === 'http403') check(outcome.error?.status === (schedule === 'http503' ? 503 : 403), 'injected failure HTTP status remains truthful');
          if (schedule === 'truncated') check(outcome.error?.name === 'AuthInvalidPayloadError', 'sanitized actual truncated JSON error');
          check(firstFaultSettled && localStorage.getItem(key) === baselineDisk && events.length === 2, 'transient failure preserves authoritative disk and events');
          resources(true, 10000); check(logins === 1 && refreshes === 1, 'one password login and no early retry');
          await bounded(tokenEvent, 'real transient retry recovers', 15000);
          check(fired.some(timer => timer.delay === 10000 && timer.elapsed >= 9900), 'real documented retry timer fired');
          check(logins === 1 && refreshes === 2, 'genuine retry without password replay');
        } else {
          check(outcome.error?.status === 401 && outcome.data.session === null && nativeRejected === 1, 'genuine native terminal401 observed');
          check(localStorage.getItem(key) === null && events.map(e => e.event).join(',') === 'INITIAL_SESSION,SIGNED_IN,SIGNED_OUT' && events[2].owner === null, 'terminal owned removal and null event');
          resources(false); check((await client.auth.getSession()).data.session === null, 'terminal cached state null');
          stimuli(); check((await client.auth.refreshSession()).error?.name === 'AuthSessionMissingError' && refreshes === 1, 'terminal has no automatic or explicit missing-session wire'); resources(false);
          const recovered = await bounded(client.auth.signInWithPassword(password(0)), 'explicit terminal password recovery');
          check(!recovered.error && recovered.data.session?.user.id === accounts[0].id && recovered.data.session.refresh_token !== baselineRefresh, 'explicit genuine terminal recovery');
          baselineRefresh = recovered.data.session!.refresh_token; resources(true, 1000);
        }
      }
      if (schedule !== 'terminal') {
        await bounded(tokenEvent, 'committed renewal notification');
        const current = await bounded(client.auth.getSession(), 'renewed cached truth');
        check(!current.error && current.data.session?.user.id === accounts[0].id && current.data.session.refresh_token === baselineRefresh && refreshed.session?.user.id === accounts[0].id, 'renewed authoritative owner and retained refresh');
        check(nativeSuccesses === (transient && schedule !== 'network' ? 2 : 1) && refreshes === (transient ? 2 : 1), 'exact genuine native successes and attempted renewals');
        if (transient) check(current.data.session!.expires_at > login.data.session!.expires_at, 'genuine new expiry after transient gap');
        if (schedule === 'disabled') resources(false); else resources(true, 1000);
      }
      const primaryRow = await bounded(client.from('todos').select('*').eq('id', ids[0]).single(), 'recovered genuine primary row');
      const canonicalRow = (value: unknown) => JSON.stringify(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
      check(!primaryRow.error && canonicalRow(primaryRow.data) === canonicalRow({ id: ids[0], user_id: accounts[0].id, title: `BF-${ids[0]}`, completed: false, priority: 7, note: null, created_at: 1780000000 }), 'complete recovered owner row');
      check(!(await bounded(client.auth.signOut({ scope: 'local' }), 'acknowledged primary local teardown')).error, 'primary local teardown acknowledged');
      resources(false); stimuli(); check((await client.auth.getSession()).data.session === null && localStorage.getItem(key) === null, 'no post-teardown revival');
      const expectedEvents = schedule === 'terminal' ? ['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'SIGNED_IN', 'SIGNED_OUT'] : ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_OUT'];
      check(events.map(e => e.event).join(',') === expectedEvents.join(',') && events.every(e => e.owner === (e.event === 'INITIAL_SESSION' || e.event === 'SIGNED_OUT' ? null : accounts[0].id)), 'exact truthful notification sequence');
      const revoked = await wire(`${base}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: baselineRefresh }), credentials: 'omit', redirect: 'error' });
      check(revoked.status === 401, 'captured local refresh actually revoked'); await revoked.body?.cancel();
      const canonical = (value: unknown) => JSON.stringify(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
      const controlRow = await bounded(control.from('todos').select('*').eq('id', ids[1]).single(), 'live control row barrier');
      check(!controlRow.error && canonical(controlRow.data) === canonical({ id: ids[1], user_id: accounts[1].id, title: `BF-${ids[1]}`, completed: false, priority: 7, note: null, created_at: 1780000000 }), 'complete control row and surviving independent session');
      check((await control.from('todos').select('*').eq('id', ids[0])).data?.length === 0, 'control cannot read primary row');
      resources(false); check(localStorage.getItem(unrelated) === 'keep' && !eventFailure && mutations === 0, 'storage events and no mutation dispatch');
      return { scheduling: true, truthfulEvents: true, recovered: true, localRevocation: true, noMutation: true };
    }, { base: env.trailUrl, accounts: users.map(user => ({ id: canonicalUuid(user.user.id), email: user.email, password: user.password })), ids, key, unrelated, schedule })).toEqual({ scheduling: true, truthfulEvents: true, recovered: true, localRevocation: true, noMutation: true });
    expect(rows(main, 'todos').filter(row => belongs(row.user_id))).toEqual(seeded);
    expect(rows(main, 'todo_audit').filter(row => belongs(row.user_id)).map(row => row.operation)).toEqual(['INSERT', 'INSERT']);
    completed = true;
  }, [
    async () => { if (!page.isClosed()) { try { await page.evaluate(async () => { await window.packedBackgroundDispose?.(); delete window.packedBackgroundDispose; }); } finally { await page.close(); } } },
    ...[0, 1].map(index => async () => {
      const user = users[index]; if (!user) return; await user.client.login(user.email, user.password);
      await cleanupOwnedRows(user.client.records('todos'), nativeUuid(canonicalUuid(user.user.id)), [nativeUuid(ids[index])]);
      const response = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { headers: { authorization: `Bearer ${user.client.tokens()!.auth_token}` }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await response.body?.cancel(); expect(response.status).toBe(303); // No SDK receipt inferred; measure session absence independently.
    }),
    async () => {
      expect(rows(main, 'todos')).toEqual(before.todos); expect(rows(sessions, '_session').filter(row => belongs(row.user))).toEqual([]);
      expect(rows(sessions, '_session').filter(row => !belongs(row.user))).toEqual(before.sessions);
      expect(rows(main, '_user').filter(row => !belongs(row.id))).toEqual(before.users);
      expect(rows(main, 'todo_audit').filter(row => !belongs(row.user_id))).toEqual(before.audit);
      if (ownersBefore) {
        const stable = (values: ReturnType<typeof rows>) => values.map(({ updated: _loginMetadata, ...row }) => row);
        expect(stable(rows(main, '_user').filter(row => belongs(row.id)))).toEqual(stable(ownersBefore));
      }
      if (completed) expect(rows(main, 'todo_audit').filter(row => belongs(row.user_id)).map(row => row.operation)).toEqual(['INSERT', 'INSERT', 'DELETE', 'DELETE']);
      expect(pageErrors).toEqual([]);
    },
    async () => { main.close(); sessions.close(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
