import { expect, it } from 'vitest';
import { createClient, type AuthStorage } from '../../src/index.js';

const origin = 'http://localhost:4000';
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const credentials = { email: 'owned@example.test', password: 'Fixture-password' };
const sub = Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url');
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function tokens(label: string) {
  const now = Math.floor(Date.now() / 1000);
  return { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub, email: credentials.email, iat: now - 1, exp: now + 600, label })}.signature`, refresh_token: `refresh-${label}`, csrf_token: `csrf-${label}` };
}
const envelope = (label: string) => JSON.stringify({ version: 1, tokens: tokens(label) });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const memory = (data: Map<string, string>): AuthStorage => ({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } });
function factory(fetch: typeof globalThis.fetch, data = new Map<string, string>(), storage = memory(data)) {
  return createClient(origin, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: 'owned', storage }, global: { fetch } });
}

it('L1-19/U19/S07 local signOut clears owned memory/storage and sends captured refresh only once', async () => {
  const data = new Map([['owned', envelope('A')], ['unrelated', 'keep']]); let calls = 0;
  const client = factory(async (input, init) => {
    calls++; expect(String(input)).toBe(`${origin}/api/auth/v1/logout`); expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'refresh-A' });
    expect([...new Headers(init?.headers)]).toEqual([['content-type', 'application/json']]);
    expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error');
    return new Response(null, { status: 200 });
  }, data);
  expect((await client.auth.getSession()).data.session).not.toBeNull();
  expect(await client.auth.signOut({ scope: 'local' })).toEqual({ error: null });
  expect(await client.auth.getSession()).toEqual({ data: { session: null }, error: null });
  expect(data.has('owned')).toBe(false); expect(data.get('unrelated')).toBe('keep');
  expect(await client.auth.signOut({ scope: 'local' })).toEqual({ error: null }); expect(calls).toBe(1);
});

it('L1-19/U19/S01 default global never follows or accepts a redirect/health response as authenticated acknowledgement', async () => {
  for (const variant of ['redirect', 'opaque', 'health'] as const) {
    const data = new Map([['owned', envelope('A')]]); let calls = 0, cancelled = 0;
    const client = factory(async (_input, init) => {
      calls++; expect(init?.method).toBe('GET'); expect(init?.body).toBeUndefined(); expect(init?.redirect).toBe('manual'); expect(init?.credentials).toBe('omit');
      expect([...new Headers(init?.headers)]).toEqual([['authorization', `Bearer ${tokens('A').auth_token}`], ['content-type', 'application/json']]);
      const response = new Response(new ReadableStream({ cancel() { cancelled++; } }), variant === 'redirect' ? { status: 303, headers: { location: '/' } } : { status: 200 });
      if (variant === 'opaque') Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
      return response;
    }, data);
    const result = await client.auth.signOut(); expect(result.error?.name).toBe('AuthGlobalSignOutUnconfirmedError');
    expect(data.has('owned')).toBe(false); expect((await client.auth.getSession()).data.session).toBeNull(); expect(calls).toBe(1); expect(cancelled).toBe(1);
  }
});

it('L1-19/U19 unsupported scopes/options/arity reject before invalidating a session or dispatching', async () => {
  const data = new Map([['owned', envelope('A')]]); let calls = 0;
  const client = factory(async () => { calls++; return new Response(); }, data);
  for (const args of [[{ scope: 'others' }], [{ scope: 'local', extra: true }], [null], [{}, {}]]) expect(() => Reflect.apply(client.auth.signOut, client.auth, args)).toThrow();
  expect(calls).toBe(0); expect(data.has('owned')).toBe(true); expect((await client.auth.getSession()).data.session?.refresh_token).toBe('refresh-A');
});

it('L1-19/U19/S07 local transport/HTTP/unexpected success/redirect failures remain observable after local clearing', async () => {
  for (const status of [0, 401, 405, 500, 204, 303]) {
    const data = new Map([['owned', envelope('A')]]);
    const client = factory(async () => { if (!status) throw new TypeError('private-transport-detail'); return new Response(null, { status }); }, data);
    const result = await client.auth.signOut({ scope: 'local' }); expect(result.error).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-transport-detail'); expect(data.has('owned')).toBe(false); expect((await client.auth.getSession()).data.session).toBeNull();
  }
});

it('L1-19/S08 held hydration cannot restore a signed-out session and still revokes its captured credential', async () => {
  const held = deferred<string | null>(), entered = deferred<void>(); const data = new Map([['unrelated', 'keep']]); const revoked: string[] = [];
  const storage = { ...memory(data), getItem: () => { entered.resolve(); return held.promise; } };
  const client = factory(async (_input, init) => { revoked.push(JSON.parse(String(init?.body)).refresh_token); return new Response(); }, data, storage);
  const cached = client.auth.getSession(); await entered.promise; const logout = client.auth.signOut({ scope: 'local' }); held.resolve(envelope('A'));
  expect((await logout).error).toBeNull(); expect((await cached).data.session).toBeNull(); expect((await client.auth.getSession()).data.session).toBeNull();
  expect(revoked).toEqual(['refresh-A']); expect(data.get('unrelated')).toBe('keep');
});

it('L1-19/S08 pending login is invalidated at signOut invocation; only discarded new session is cleaned', async () => {
  const held = deferred<Response>(), entered = deferred<void>(); const revoked: string[] = [];
  const client = factory(async (input, init) => {
    if (new URL(String(input)).pathname.endsWith('/login')) { entered.resolve(); return held.promise; }
    revoked.push(JSON.parse(String(init?.body)).refresh_token); return new Response();
  });
  const login = client.auth.signInWithPassword(credentials); await entered.promise;
  expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull(); held.resolve(Response.json(tokens('late')));
  expect((await login).error?.name).toBe('AuthStaleOperationError'); expect(revoked).toEqual(['refresh-late']); expect((await client.auth.getSession()).data.session).toBeNull();
});

it('L1-19/S08 held remote logout completion cannot clear a newer successful login', async () => {
  const held = deferred<Response>(), entered = deferred<void>(), data = new Map([['owned', envelope('A')]]);
  const client = factory(async input => {
    if (new URL(String(input)).pathname.endsWith('/logout')) { entered.resolve(); return held.promise; }
    return Response.json(tokens('B'));
  }, data);
  const logout = client.auth.signOut({ scope: 'local' }); await entered.promise;
  expect((await client.auth.signInWithPassword(credentials)).error).toBeNull(); held.resolve(new Response()); expect((await logout).error).toBeNull();
  expect((await client.auth.getSession()).data.session?.refresh_token).toBe('refresh-B'); expect(JSON.parse(data.get('owned')!).tokens.refresh_token).toBe('refresh-B');
});

it('L1-19/S08 late refresh and live status never revive logout or emit a data request', async () => {
  for (const operation of ['refreshSession', 'getUser'] as const) {
    const held = deferred<Response>(), entered = deferred<void>(), data = new Map([['owned', envelope('A')]]);
    const client = factory(async input => { if (new URL(String(input)).pathname.endsWith('/logout')) return new Response(); entered.resolve(); return held.promise; }, data);
    const pending = client.auth[operation](); await entered.promise; expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull();
    held.resolve(Response.json(operation === 'getUser' ? tokens('A') : { auth_token: tokens('renewed').auth_token, csrf_token: 'new-csrf' }));
    expect((await pending).error?.name).toBe('AuthStaleOperationError'); expect((await client.auth.getSession()).data.session).toBeNull(); expect(data.has('owned')).toBe(false);
  }
});

it('L1-19/S07 removal failure is sanitized and fail-closed even when remote revocation succeeds', async () => {
  const data = new Map([['owned', envelope('A')], ['unrelated', 'keep']]); let calls = 0;
  const client = factory(async () => { calls++; return new Response(); }, data, { ...memory(data), removeItem: () => { throw new Error('private-storage-detail'); } });
  expect((await client.auth.signOut({ scope: 'local' })).error?.name).toBe('AuthStorageRemoveError');
  expect((await client.auth.getSession()).error?.name).toBe('AuthStorageRemoveError');
  expect((await client.from('todos').select()).error?.name).toBe('AuthStorageRemoveError'); expect(calls).toBe(1); expect(data.get('unrelated')).toBe('keep');
});

it('L1-19/S08 concurrent same-scope logout shares one request and refuses a conflicting scope', async () => {
  const held = deferred<Response>(), entered = deferred<void>(); let calls = 0;
  const client = factory(async () => { calls++; entered.resolve(); return held.promise; }, new Map([['owned', envelope('A')]]));
  const first = client.auth.signOut({ scope: 'local' }); await entered.promise;
  const second = client.auth.signOut({ scope: 'local' }); expect(second).toBe(first);
  expect((await client.auth.signOut()).error?.name).toBe('AuthSignOutInProgressError');
  held.resolve(new Response()); expect((await first).error).toBeNull(); expect(calls).toBe(1);
});

it('L1-19/S08 held old login write compensates to signed-out authority before a newer failed login settles', async () => {
  const held = deferred<void>(), entered = deferred<void>(), data = new Map([['unrelated', 'keep']]); let logins = 0;
  const storage = { ...memory(data), setItem: async (key: string, value: string) => { data.set(key, value); entered.resolve(); await held.promise; } };
  const client = factory(async input => new URL(String(input)).pathname.endsWith('/logout') ? new Response() : ++logins === 1 ? Response.json(tokens('old')) : new Response(null, { status: 401 }), data, storage);
  const old = client.auth.signInWithPassword(credentials); await entered.promise;
  const logout = client.auth.signOut({ scope: 'local' }); const replacement = client.auth.signInWithPassword(credentials); held.resolve();
  expect((await old).error?.name).toBe('AuthStaleOperationError'); expect((await logout).error).toBeNull(); expect((await replacement).error?.status).toBe(401);
  expect(data.has('owned')).toBe(false); expect(data.get('unrelated')).toBe('keep'); expect((await client.auth.getSession()).data.session).toBeNull();
});

it('L1-19/S08 held logout removal cannot delete a newer queued successful login', async () => {
  const held = deferred<void>(), entered = deferred<void>(), data = new Map([['owned', envelope('A')]]);
  const storage = { ...memory(data), removeItem: async (key: string) => { entered.resolve(); await held.promise; data.delete(key); } };
  const client = factory(async input => new URL(String(input)).pathname.endsWith('/logout') ? new Response() : Response.json(tokens('B')), data, storage);
  const logout = client.auth.signOut({ scope: 'local' }); await entered.promise; const replacement = client.auth.signInWithPassword(credentials); held.resolve();
  expect((await logout).error).toBeNull(); expect((await replacement).error).toBeNull(); expect(JSON.parse(data.get('owned')!).tokens.refresh_token).toBe('refresh-B');
});

it('L1-19/PN03 public SIGNED_OUT is immediate null state; owned disk removal completes before awaited logout', async () => {
  const entered = deferred<void>(), held = deferred<void>(), data = new Map([['owned', envelope('A')], ['unrelated', 'keep']]);
  const storage = { ...memory(data), removeItem: async (key: string) => { entered.resolve(); await held.promise; data.delete(key); } };
  const client = factory(async () => new Response(), data, storage);
  await client.auth.getSession();
  const observations: { nullSession: boolean; keyPresent: boolean }[] = [];
  const listener = client.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_OUT') observations.push({ nullSession: session === null, keyPresent: data.has('owned') }); }).data.subscription;
  try {
    const logout = client.auth.signOut({ scope: 'local' }); await entered.promise;
    expect(observations).toEqual([{ nullSession: true, keyPresent: true }]);
    held.resolve(); expect((await logout).error).toBeNull();
    expect(data.has('owned')).toBe(false); expect(data.get('unrelated')).toBe('keep'); expect((await client.auth.getSession()).data.session).toBeNull();
  } finally { held.resolve(); listener.unsubscribe(); }
});

it('L1-19/S08 stale login cleanup failure is observable without overwriting a newer session', async () => {
  const held = deferred<Response>(), entered = deferred<void>(); let logins = 0;
  const client = factory(async input => {
    if (new URL(String(input)).pathname.endsWith('/logout')) throw new TypeError('private-cleanup-detail');
    if (++logins === 1) { entered.resolve(); return held.promise; } return Response.json(tokens('B'));
  });
  const old = client.auth.signInWithPassword(credentials); await entered.promise; await client.auth.signInWithPassword(credentials); held.resolve(Response.json(tokens('A')));
  const result = await old; expect(result.error?.name).toBe('AuthStaleOperationError'); expect(result.error?.details).toBe('discardedSessionCleanup=failed');
  expect(JSON.stringify(result)).not.toContain('private-cleanup-detail'); expect((await client.auth.getSession()).data.session?.refresh_token).toBe('refresh-B');
});
