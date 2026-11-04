import { test, expect } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { context, confirmedTrailUser, canonicalUuid, nativeUuid, nativeAuthSnapshot } from '../phase-a/helpers.js';
import { withCleanup } from './cleanup.js';
import { deleteNativeOwner } from '../auth-negative/helpers.js';

declare global { interface Window { packedStatusRace?: { start(): Promise<boolean>; transition(): Promise<{ a: string; b: string | null }>; finish(): Promise<boolean>; control(): Promise<boolean>; dispose(): Promise<void> } } }

for (const mode of ['logout', 'replace'] as const) test(`L1-16/17/19/20/E07/E08/E11/E13/S07/S08/SR0${mode === 'logout' ? '1' : '2'} genuine held live status cannot outlive ${mode}`, async ({ page }) => {
  const env = await context();
  if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'default' || env.nativeServerProfile !== 'default') throw new Error('SR requires owned official default fixture');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true }), sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const before = nativeAuthSnapshot(main, sessions), users: Awaited<ReturnType<typeof confirmedTrailUser>>[] = [], ids = [randomUUID(), randomUUID()];
  const key = `sr-${randomUUID()}`, unrelated = `sr-unrelated-${randomUUID()}`, errors: string[] = [];
  page.on('pageerror', () => errors.push('unhandled-browser-error'));
  let completed = false;
  await withCleanup(async () => {
    for (const label of ['sr-a', 'sr-b']) users.push(await confirmedTrailUser(env, label));
    for (const [i, user] of users.entries()) await user.client.records('todos').create({ id: nativeUuid(ids[i]), user_id: user.user.id, title: `SR-${ids[i]}`, completed: i, priority: i + 1, note: null, created_at: 1700000000 });
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    expect(await page.evaluate(async ({ base, accounts, ids, key, unrelated, mode }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const check = (value: unknown, label: string) => { if (!value) throw new Error(`SR assertion: ${label}`); };
      const bounded = async <T,>(promise: PromiseLike<T>, label: string): Promise<T> => {
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([promise, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`SR deadline: ${label}`)), 10000); })]); }
        finally { clearTimeout(timer!); }
      };
      let arrived!: () => void, release!: () => void, sawInitial!: () => void;
      const arrival = new Promise<void>(yes => { arrived = yes; }), gate = new Promise<void>(yes => { release = yes; }), initial = new Promise<void>(yes => { sawInitial = yes; });
      const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
      const controllers = new Set<AbortController>();
      const real: typeof fetch = async (input, init) => {
        check(new URL(String(input)).origin === base && init?.credentials === 'omit' && ['error', 'manual'].includes(init.redirect!), 'fixed owned origin and native credential/redirect policy');
        const controller = new AbortController(); controllers.add(controller);
        try { return await fetch(input, { ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }); }
        finally { controllers.delete(controller); }
      };
      type NativeLogin = { auth_token: string; refresh_token: string; csrf_token: string };
      const logins: NativeLogin[] = [];
      const stats = { status: 0, records: 0, refresh: 0, login: 0, logout: 0, json: 0, cancel: 0, genuine: false };
      let nativeStatusSecrets: string[] = [];
      let subject: import('../../src/index.js').AuthSession, signal: AbortSignal | undefined, held: ReturnType<ReturnType<typeof sdk.createClient>['auth']['getUser']> | undefined;
      const observed: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.startsWith('/api/records/')) stats.records++;
        for (const name of ['refresh', 'login', 'logout'] as const) if (path.endsWith('/' + name)) stats[name]++;
        const actual = await real(input, init);
        if (path.endsWith('/login')) {
          check(actual.status === 200, 'genuine login response'); const payload = await actual.clone().json();
          check(Object.keys(payload).sort().join(',') === 'auth_token,csrf_token,refresh_token', 'complete genuine native login credentials'); logins.push(structuredClone(payload));
        }
        if (!path.endsWith('/status')) return actual;
        stats.status++; if (stats.status !== 1) return actual; // Later explicit B live validation is a genuine positive control, not held A delivery.
        signal = init?.signal ?? undefined;
        try {
          check(actual.status === 200 && !actual.redirected && actual.url === `${base}/api/auth/v1/status`, 'genuine successful native status');
          check(init?.method === 'GET' && !init.body && JSON.stringify([...new Headers(init.headers)]) === JSON.stringify([['authorization', `Bearer ${subject.access_token}`], ['refresh-token', subject.refresh_token]]), 'captured genuine A bearer/refresh only');
          const payload = await actual.clone().json(), claims = JSON.parse(atob(payload.auth_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
          const bytes = Uint8Array.from(atob(claims.sub.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
          check(Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('') === accounts[0].id.replaceAll('-', '') && payload.refresh_token === subject.refresh_token && typeof payload.csrf_token === 'string', 'actual native A identity/credential acknowledgement');
          nativeStatusSecrets = [payload.auth_token, payload.refresh_token, payload.csrf_token];
          const json = actual.json.bind(actual), body = actual.body!, cancel = body.cancel.bind(body);
          actual.json = () => { stats.json++; return json(); };
          body.cancel = reason => { stats.cancel++; return cancel(reason); };
          stats.genuine = true; arrived(); await bounded(gate, 'held actual status'); return actual;
        } finally { arrived(); }
      };
      const a = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: key }, global: { fetch: observed } });
      const b = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: real } });
      const events: { event: string; session: import('../../src/index.js').AuthSession | null }[] = [];
      const subscription = a.auth.onAuthStateChange((event, session) => { events.push({ event, session: structuredClone(session) }); if (event === 'INITIAL_SESSION') sawInitial(); }).data.subscription;
      let authoritative: Awaited<ReturnType<typeof a.auth.getSession>>, disk: string | null, controlSession: import('../../src/index.js').AuthSession, replacement: import('../../src/index.js').AuthSession | null = null;
      const coherent = (index: number, session: import('../../src/index.js').AuthSession) => {
        const payload = logins[index], claims = JSON.parse(atob(payload.auth_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))), stored = JSON.parse(localStorage.getItem(key)!);
        check(stored.version === 1 && Object.keys(stored).sort().join(',') === 'tokens,version' && Object.keys(stored.tokens).sort().join(',') === 'auth_token,csrf_token,refresh_token' && Object.entries(payload).every(([field, value]) => stored.tokens[field] === value), 'full persisted genuine login envelope');
        check(typeof payload.csrf_token === 'string' && payload.csrf_token === claims.csrf_token, 'native JWT/persisted CSRF coherence');
        check(JSON.stringify(session) === JSON.stringify({ access_token: payload.auth_token, refresh_token: payload.refresh_token, token_type: 'bearer', expires_at: claims.exp, expires_in: claims.exp - claims.iat, user: { id: accounts[index].id, email: accounts[index].email } }), 'complete cached genuine login session');
      };
      const handle = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
      const password = (i: number) => ({ email: accounts[i].email, password: accounts[i].password });
      window.packedStatusRace = {
        async start() {
          await bounded(initial, 'initial notification'); localStorage.setItem(unrelated, 'keep');
          const login = await a.auth.signInWithPassword(password(0)); check(!login.error && login.data.user?.id === accounts[0].id, 'ordinary genuine A login'); subject = structuredClone(login.data.session!); coherent(0, subject);
          const control = await b.auth.signInWithPassword(password(1)); check(!control.error && control.data.user?.id === accounts[1].id, 'independent genuine B login'); controlSession = control.data.session!;
          held = a.auth.getUser(); await bounded(arrival, 'genuine status arrival'); check(stats.genuine, 'status must genuinely execute'); return true;
        },
        async transition() {
          if (mode === 'logout') check(!(await a.auth.signOut({ scope: 'local' })).error, 'acknowledged local logout');
          else { const login = await a.auth.signInWithPassword(password(1)); check(!login.error && login.data.user?.id === accounts[1].id, 'committed genuine different-owner login'); replacement = structuredClone(login.data.session!); coherent(1, replacement); }
          authoritative = await a.auth.getSession(); disk = localStorage.getItem(key);
          check(!authoritative.error && (mode === 'logout' ? authoritative.data.session === null && disk === null : JSON.stringify(authoritative.data.session) === JSON.stringify(replacement)), 'transition memory/disk authoritative'); return { a: await handle(subject.refresh_token), b: replacement ? await handle(replacement.refresh_token) : null };
        },
        async finish() {
          release(); check(held, 'pending lookup exists'); const result = await bounded(held!, 'stale lookup settlement');
          check(result.data.user === null && result.error?.name === 'AuthStaleOperationError', 'old genuine status returns null/stale, never A success');
          check([...nativeStatusSecrets, subject.access_token, subject.refresh_token, ...accounts.flatMap(account => [account.email, account.password])].every(secret => !JSON.stringify(result).includes(secret)), 'stale error exposes no genuine credentials or identity');
          check(stats.status === 1 && stats.json === 0 && stats.cancel === 1 && signal?.aborted, 'one status; stale body discarded/cancelled/aborted before decode');
          check(stats.records === 0 && stats.refresh === 0 && stats.login === (mode === 'logout' ? 1 : 2) && stats.logout === (mode === 'logout' ? 1 : 0), 'no hidden renewal/data/replay');
          const current = await a.auth.getSession();
          check(JSON.stringify(current) === JSON.stringify(authoritative) && localStorage.getItem(key) === disk && localStorage.getItem(unrelated) === 'keep', 'exact authoritative memory/disk and unrelated key survive');
          check(JSON.stringify(events) === JSON.stringify([{ event: 'INITIAL_SESSION', session: null }, { event: 'SIGNED_IN', session: subject }, { event: mode === 'logout' ? 'SIGNED_OUT' : 'SIGNED_IN', session: replacement }]), 'complete committed event sessions without late A notification');
          check(JSON.stringify((await b.auth.getSession()).data.session) === JSON.stringify(controlSession), 'independent B credentials unaffected'); return true;
        },
        async control() {
          const response = await real(`${base}/api/auth/v1/refresh`, { method: 'POST', body: JSON.stringify({ refresh_token: subject.refresh_token }), headers: { 'content-type': 'application/json' }, credentials: 'omit', redirect: 'error' });
          check(response.status === (mode === 'logout' ? 401 : 200), 'captured A revocation/replacement distinction'); await response.body?.cancel();
          if (mode === 'logout') check(!!(await a.from('todos').select('*')).error, 'signed-out SDK protected read denied');
          else { check((await a.auth.getUser()).data.user?.id === accounts[1].id, 'new B live status works'); check((await a.from('todos').select('*').eq('id', ids[0])).data?.length === 0, 'new B cannot read A'); }
          check((await b.auth.getUser()).data.user?.id === accounts[1].id, 'independent B live identity survives');
          check(!(await b.from('todos').update({ note: 'SR-control' }).eq('id', ids[1])).error, 'acknowledged B control mutation');
          const row = await b.from('todos').select('*').eq('id', ids[1]).single();
          const expected = { id: ids[1], user_id: accounts[1].id, title: `SR-${ids[1]}`, completed: true, priority: 2, note: 'SR-control', created_at: 1700000000 };
          check(!row.error && row.data && Object.keys(row.data).sort().join(',') === Object.keys(expected).sort().join(',') && Object.entries(expected).every(([field, value]) => row.data![field] === value), 'complete mapped B control row'); return true;
        },
        async dispose() { release(); try { if (held) await bounded(held, 'drain pending lookup'); const results = await Promise.all([a.auth.signOut({ scope: 'local' }), b.auth.signOut({ scope: 'local' })]); check(results.every(result => !result.error), 'ordinary browser local cleanup acknowledgements'); } finally { subscription.unsubscribe(); for (const controller of controllers) controller.abort(); localStorage.removeItem(key); localStorage.removeItem(unrelated); } },
      };
      return true;
    }, { base: env.trailUrl, accounts: users.map(user => ({ id: canonicalUuid(user.user.id), email: user.email, password: user.password })), ids, key, unrelated, mode })).toBe(true);
    expect(await page.evaluate(() => window.packedStatusRace!.start())).toBe(true);
    const started = nativeAuthSnapshot(main, sessions), handles = await page.evaluate(() => window.packedStatusRace!.transition());
    const committed = nativeAuthSnapshot(main, sessions), matches = (row: Record<string, unknown>, hash: string) => createHash('sha256').update(String(row.refresh_token)).digest('hex') === hash;
    expect(started.sessions.filter(row => matches(row, handles.a))).toHaveLength(1);
    expect(committed.users).toEqual(started.users); expect(committed.todos).toEqual(started.todos); expect(committed.audit).toEqual(started.audit);
    if (mode === 'logout') expect(committed.sessions).toEqual(started.sessions.filter(row => !matches(row, handles.a)));
    else {
      expect(handles.b).not.toBeNull(); const added = committed.sessions.filter(row => matches(row, handles.b!)); expect(added).toHaveLength(1);
      expect(Buffer.from(added[0].user as Uint8Array)).toEqual(Buffer.from(users[1].user.id, 'base64url'));
      expect(started.sessions.some(row => matches(row, handles.b!))).toBe(false);
      expect(committed.sessions.filter(row => !matches(row, handles.b!))).toEqual(started.sessions);
    }
    expect(await page.evaluate(() => window.packedStatusRace!.finish())).toBe(true);
    expect(nativeAuthSnapshot(main, sessions)).toEqual(committed);
    expect(await page.evaluate(() => window.packedStatusRace!.control())).toBe(true);
    const after = nativeAuthSnapshot(main, sessions), controlId = Buffer.from(users[1].user.id, 'base64url');
    expect(after.users).toEqual(committed.users); expect(after.sessions).toEqual(committed.sessions);
    expect(after.todos).toEqual(committed.todos.map(row => Buffer.from(row.id as Uint8Array).equals(Buffer.from(nativeUuid(ids[1]), 'base64url')) ? { ...row, note: 'SR-control' } : row));
    expect(after.audit.slice(0, committed.audit.length)).toEqual(committed.audit); expect(after.audit).toHaveLength(committed.audit.length + 1);
    expect(after.audit.at(-1)).toEqual({ audit_key: BigInt(committed.audit.at(-1)?.audit_key as bigint ?? 0n) + 1n, todo_id: Uint8Array.from(Buffer.from(nativeUuid(ids[1]), 'base64url')), user_id: Uint8Array.from(controlId), operation: 'UPDATE' });
    expect(errors).toEqual([]); completed = true;
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(async () => { await window.packedStatusRace?.dispose(); delete window.packedStatusRace; }); },
    ...[0, 1].map(i => async () => {
      const user = users[i]; if (!user) return;
      const cleanup = () => deleteNativeOwner(env, { label: `sr-${i}`, email: user.email, password: user.password, id: canonicalUuid(user.user.id), rowId: ids[i] });
      if (i || !completed) { await cleanup(); return; }
      const transport = globalThis.fetch, rowFailure = new Error('SR owned DELETE reply lost after genuine commit'); let injected = false, failure: unknown;
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input)); const response = await transport(input, init);
        if (!injected && init?.method === 'DELETE' && url.origin === env.trailUrl && url.pathname.includes('/todos/') && decodeURIComponent(url.pathname.split('/').at(-1)!) === nativeUuid(ids[i])) {
          expect(response.ok).toBe(true); await response.arrayBuffer(); injected = true; throw rowFailure;
        }
        return response;
      };
      try { await cleanup(); } catch (error) { failure = error; } finally { globalThis.fetch = transport; }
      expect(injected).toBe(true); expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toHaveLength(1); expect((failure as AggregateError).errors[0]).toBe(rowFailure);
      const after = nativeAuthSnapshot(main, sessions), own = (value: unknown) => value instanceof Uint8Array && Buffer.from(value).equals(Buffer.from(user.user.id, 'base64url'));
      expect(after.users.some(row => own(row.id))).toBe(false); expect(after.sessions.some(row => own(row.user))).toBe(false);
    }),
    async () => { const after = nativeAuthSnapshot(main, sessions); expect(after.users).toEqual(before.users); expect(after.sessions).toEqual(before.sessions); expect(after.todos).toEqual(before.todos); expect(after.audit.slice(0, before.audit.length)).toEqual(before.audit); if (completed) expect(after.audit.slice(before.audit.length).map(row => row.operation)).toEqual(['INSERT', 'INSERT', 'UPDATE', 'DELETE', 'DELETE']); },
    async () => { main.close(); sessions.close(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
