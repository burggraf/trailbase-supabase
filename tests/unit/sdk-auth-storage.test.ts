import { expect, it } from 'vitest';
import { createClient, type AuthStorage } from '../../src/index.js';
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const key = 'owned-auth'; const password = { email: 'placeholder@example.test', password: 'placeholder' };
const nativeId = Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url');
const now = Math.floor(Date.now() / 1000);
const tokens = (email: string, expired = false) => { const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url'); return { auth_token: `${part({ alg: 'EdDSA' })}.${part({ sub: nativeId, email, iat: now - 120, exp: now + (expired ? -60 : 600) })}.signature`, refresh_token: `refresh-${email}`, csrf_token: `csrf-${email}` }; };
const envelope = (value: ReturnType<typeof tokens>) => JSON.stringify({ version: 1, tokens: value });
const factory = (storage: AuthStorage, fetch: typeof globalThis.fetch, persistSession = true) => createClient('http://localhost:4000', undefined, { trailbase: mapping, auth: { persistSession, autoRefreshToken: false, storageKey: key, storage }, global: { fetch } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const memory = (data: Map<string, string>) => ({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } });

it('L1-16/U16 S07 sync/async exact credential persistence reload preserves csrf privately and unrelated keys', async () => {
  for (const asynchronous of [false, true]) {
    const data = new Map([['unrelated', 'keep']]); const raw = memory(data);
    const storage: AuthStorage = asynchronous ? { getItem: async k => raw.getItem(k), setItem: async (k, v) => raw.setItem(k, v), removeItem: async k => raw.removeItem(k) } : raw;
    const native = tokens('owned@example.test'); const a = factory(storage, async () => Response.json(native));
    expect((await a.auth.signInWithPassword(password)).error).toBeNull(); expect(data.get(key)).toBe(envelope(native));
    const b = factory(storage, async () => { throw new Error('No auth/network hydration'); }); const session = await b.auth.getSession();
    expect(session.data.session?.user.email).toBe('owned@example.test'); expect(session.data.session).not.toHaveProperty('csrf_token');
    session.data.session!.user.email = 'mutated'; expect((await b.auth.getSession()).data.session?.user.email).toBe('owned@example.test'); expect(data.get('unrelated')).toBe('keep');
  }
});
it('L1-16/U16 disabled persistence has zero storage calls; Node default stores never cross clients', async () => {
  const storage = { getItem: () => { throw new Error('Must not read'); }, setItem: () => { throw new Error('Must not write'); }, removeItem: () => { throw new Error('Must not remove'); } };
  expect((await factory(storage, async () => Response.json(tokens('owned')), false).auth.signInWithPassword(password)).error).toBeNull();
  const create = () => createClient('http://localhost:4000', undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false }, global: { fetch: async () => Response.json(tokens('owned')) } });
  await create().auth.signInWithPassword(password); expect((await create().auth.getSession()).data.session).toBeNull();
});
it('L1-16/U16 S08 held hydration cannot install old A after newer B login invocation', async () => {
  const read = deferred<string | null>(), started = deferred<void>(); const data = new Map<string, string>();
  const sdk = factory({ ...memory(data), getItem: () => { started.resolve(); return read.promise; } }, async () => Response.json(tokens('B')));
  const old = sdk.auth.getSession(); await started.promise; const login = sdk.auth.signInWithPassword(password); read.resolve(envelope(tokens('A')));
  expect((await old).data.session?.user.email).not.toBe('A'); expect((await login).data.user?.email).toBe('B'); expect((await sdk.auth.getSession()).data.session?.user.email).toBe('B'); expect(JSON.parse(data.get(key)!).tokens).toEqual(tokens('B'));
});
it('L1-16/U16 S08 held stale write A plus failed B restores preexisting good C before responses settle', async () => {
  const c = tokens('C'), a = tokens('A'); const data = new Map([[key, envelope(c)], ['unrelated', 'keep']]); const held = deferred<void>(), started = deferred<void>();
  const storage = { ...memory(data), setItem: async (k: string, value: string) => { data.set(k, value); if (value === envelope(a)) { started.resolve(); await held.promise; } } };
  let calls = 0; const sdk = factory(storage, async () => ++calls === 1 ? Response.json(a) : new Response('Rejected', { status: 401 }));
  expect((await sdk.auth.getSession()).data.session?.user.email).toBe('C'); const first = sdk.auth.signInWithPassword(password); await started.promise; const newer = sdk.auth.signInWithPassword(password); held.resolve();
  expect((await first).error?.name).toBe('AuthStaleOperationError'); expect((await newer).error?.status).toBe(401); expect(data.get(key)).toBe(envelope(c)); expect((await sdk.auth.getSession()).data.session?.user.email).toBe('C'); expect(data.get('unrelated')).toBe('keep');
});
it('L1-16/U16 S08 rejected compensation latches sanitized failure and zero auth/data dispatch, disk remains explicit A', async () => {
  const c = tokens('C'), a = tokens('A'); const data = new Map([[key, envelope(c)]]); const held = deferred<void>(), started = deferred<void>(); const writes: string[] = [];
  const storage = { ...memory(data), setItem: async (k: string, value: string) => { writes.push(value); if (value === envelope(c)) throw new Error('private-storage-payload'); data.set(k, value); started.resolve(); await held.promise; } };
  let calls = 0; const sdk = factory(storage, async () => ++calls === 1 ? Response.json(a) : new Response('Rejected', { status: 401 }));
  const good = await sdk.auth.getSession(); expect(good.data.session?.user.email).toBe('C'); const first = sdk.auth.signInWithPassword(password); await started.promise; const newer = sdk.auth.signInWithPassword(password); held.resolve();
  const failed = await first; const failedB = await newer; expect(failed.error?.name).toBe('AuthStorageRestoreError'); expect(failed.error?.details).toContain('AuthStaleOperationError'); expect(failedB.error?.name).toBe('AuthStorageRestoreError'); expect(failedB.error?.details).toContain('AuthHttpError');
  expect(writes).toEqual([envelope(a), envelope(c)]); expect(data.get(key)).toBe(envelope(a));
  for (const result of [await sdk.auth.getSession(), await sdk.auth.signInWithPassword(password), await sdk.auth.signUp(password), await sdk.from('todos').select()]) { expect(result.error?.name).toBe('AuthStorageRestoreError'); expect(result.error?.message).not.toContain('private-storage-payload'); if (result.data !== null && 'session' in result.data) expect(result.data.session).toBeNull(); else expect(result.data).toBeNull(); }
  expect(calls).toBe(2);
});
it('L1-16/U16 write rejection restores C without installing new memory; empty stale write removes only owned key', async () => {
  const c = tokens('C'), a = tokens('A'); const data = new Map([[key, envelope(c)], ['unrelated', 'keep']]);
  const sdk = factory({ ...memory(data), setItem: (k, value) => { data.set(k, value); if (value === envelope(a)) throw new Error('Secret write failure'); } }, async () => Response.json(a));
  expect((await sdk.auth.signInWithPassword(password)).error?.name).toBe('AuthStorageWriteError'); expect((await sdk.auth.getSession()).data.session?.user.email).toBe('C'); expect(data.get(key)).toBe(envelope(c));
  data.delete(key); const held = deferred<void>(), started = deferred<void>(); let calls = 0;
  const empty = factory({ ...memory(data), setItem: async (k, value) => { data.set(k, value); started.resolve(); await held.promise; } }, async () => ++calls === 1 ? Response.json(a) : new Response('Rejected', { status: 401 }));
  const first = empty.auth.signInWithPassword(password); await started.promise; const second = empty.auth.signInWithPassword(password); held.resolve(); await Promise.all([first, second]); expect(data.has(key)).toBe(false); expect(data.get('unrelated')).toBe('keep');
});
it('L1-16/U16 corrupt/property stored vectors and read failures are private/request-free; expired refresh is retained', async () => {
  const valid = envelope(tokens('owned')); const vectors = [JSON.stringify({ version: 2, tokens: tokens('owned') }), JSON.stringify({ version: 1, tokens: tokens('owned'), user: {} }), JSON.stringify({ version: 1, tokens: { ...tokens('owned'), csrf_token: undefined } }), ...Array.from({ length: 32 }, (_, i) => valid.slice(0, i)), null, 3];
  for (const value of vectors) {
    let calls = 0; const storage = { getItem: () => value as string | null, setItem: () => { throw new Error('No repair'); }, removeItem: () => { throw new Error('No deletion'); } };
    const sdk = factory(storage, async () => { calls++; return Response.json({}); }); const result = await sdk.auth.getSession();
    if (value === null) expect(result.error).toBeNull(); else { expect(result.error?.name).toBe('AuthInvalidStoredSessionError'); expect(result.data.session).toBeNull(); expect(result.error?.message).not.toContain('refresh-owned'); }
    expect(calls).toBe(0);
  }
  const broken = factory({ getItem: () => { throw new Error('private-read-payload'); }, setItem: () => {}, removeItem: () => {} }, async () => { throw new Error('No wire'); }); expect((await broken.auth.getSession()).error?.name).toBe('AuthStorageReadError');
  const data = new Map([[key, envelope(tokens('expired', true))]]); let expiredDataRequests = 0;
  const expired = factory(memory(data), async input => { if (new URL(String(input)).pathname.endsWith('/refresh')) return new Response('Unavailable', { status: 503 }); expiredDataRequests++; throw new Error('No anonymous expired dispatch'); });
  expect((await expired.auth.getSession()).error?.status).toBe(503); expect((await expired.from('todos').select()).error?.status).toBe(503); expect(expiredDataRequests).toBe(0); expect(JSON.parse(data.get(key)!).tokens.refresh_token).toBe('refresh-expired'); expect(data.get(key)).toBe(envelope(tokens('expired', true)));
});
