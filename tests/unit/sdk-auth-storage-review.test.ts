import { expect, it } from 'vitest';
import { createClient, type AuthStorage } from '../../src/index.js';
const trailbase = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const now = Math.floor(Date.now() / 1000);
const tokens = (email: string, expired = false) => { const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url'); return { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email, iat: now - 120, exp: now + (expired ? -60 : 600) })}.signature`, refresh_token: `refresh-${email}`, csrf_token: null }; };
const credentials = { email: 'placeholder', password: 'placeholder' };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
async function withPrototype(values: Record<string, unknown>, body: () => Promise<void>) {
  const originals = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)] as const);
  try { for (const [key, value] of Object.entries(values)) Object.defineProperty(Object.prototype, key, { configurable: true, writable: true, value }); await body(); }
  finally { for (const [key, original] of originals) if (original) Object.defineProperty(Object.prototype, key, original); else Reflect.deleteProperty(Object.prototype, key); }
}

it('L1-16/S08 held hydration plus current failed login reconciles expired/unexpired authoritative C without anonymous dispatch', async () => {
  for (const expired of [false, true]) {
    const c = tokens('C', expired), raw = JSON.stringify({ version: 1, tokens: c }); const read = deferred<string>(), started = deferred<void>();
    let authRequests = 0, dataRequests = 0;
    const storage = { getItem: () => { started.resolve(); return read.promise; }, setItem: () => { throw new Error('No write'); }, removeItem: () => { throw new Error('No removal'); } };
    const client = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storage }, global: { fetch: async (input, init) => {
      if (new URL(String(input)).pathname.endsWith('/login')) { authRequests++; return new Response('Rejected', { status: 401 }); }
      if (new URL(String(input)).pathname.endsWith('/refresh')) { expect(JSON.parse(String(init?.body)).refresh_token).toBe(c.refresh_token); return new Response('Unavailable', { status: 503 }); }
      dataRequests++; expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${c.auth_token}`); return Response.json({ records: [] });
    } } });
    const pending = client.auth.getSession(); await started.promise; const failed = client.auth.signInWithPassword(credentials); read.resolve(raw);
    expect((await pending).data.session).toBeNull(); expect((await failed).error?.status).toBe(401);
    const cached = await client.auth.getSession(); if (expired) expect(cached.error?.status).toBe(503); else { expect(cached.error).toBeNull(); expect(cached.data.session?.user.email).toBe('C'); expect(cached.data.session?.refresh_token).toBe(c.refresh_token); }
    const result = await client.from('todos').select();
    if (expired) { expect(result.error?.status).toBe(503); expect(dataRequests).toBe(0); }
    else { expect(result.error).toBeNull(); expect(dataRequests).toBe(1); }
    expect(authRequests).toBe(1);
  }
});
it('L1-16/S08 stale failed login cannot reconcile over a newer committed login', async () => {
  const held = deferred<Response>(), started = deferred<void>(); let calls = 0;
  const client = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async () => { if (++calls === 1) { started.resolve(); return held.promise; } return Response.json(tokens('newer')); } } });
  const old = client.auth.signInWithPassword(credentials); await started.promise; expect((await client.auth.signInWithPassword(credentials)).error).toBeNull(); held.resolve(new Response('Rejected', { status: 401 }));
  expect((await old).error?.status).toBe(401); expect((await client.auth.getSession()).data.session?.user.email).toBe('newer');
});
it('L1-16/S07 required auth settings must be own fields even when Object.prototype supplies flags', async () => {
  await withPrototype({ persistSession: true, autoRefreshToken: false }, async () => {
    for (const auth of [{}, { persistSession: false }, { autoRefreshToken: false }]) expect(() => createClient('http://localhost:4000', undefined, { trailbase, auth })).toThrowError(expect.objectContaining({ name: 'UnsupportedFeatureError' }));
  });
});
it('L1-16/S07 stored version must be own and exactly supported; inherited version plus unexpected own field rejected', async () => {
  await withPrototype({ version: 1 }, async () => {
    for (const raw of [JSON.stringify({ tokens: tokens('C'), unexpected: true }), JSON.stringify({ version: 0, tokens: tokens('C') }), JSON.stringify({ version: 2, tokens: tokens('C') })]) {
      const client = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storage: { getItem: () => raw, setItem: () => { throw new Error('No repair'); }, removeItem: () => { throw new Error('No removal'); } } } });
      expect((await client.auth.getSession()).error?.name).toBe('AuthInvalidStoredSessionError');
    }
  });
});
it('L1-16/S07 inherited optional storage/key/URL-adoption fields are never selected; legitimate storage prototype methods work', async () => {
  let sinkCalls = 0; const sink: AuthStorage = { getItem: () => { sinkCalls++; return null; }, setItem: () => { sinkCalls++; }, removeItem: () => { sinkCalls++; } };
  await withPrototype({ storage: sink, storageKey: 'inherited-sink', detectSessionInUrl: true }, async () => {
    const client = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false }, global: { fetch: async () => Response.json(tokens('C')) } });
    expect((await client.auth.signInWithPassword(credentials)).error).toBeNull(); expect(sinkCalls).toBe(0);
    const keys: string[] = [];
    class Storage implements AuthStorage { getItem(key: string) { keys.push(key); return null; } setItem() {} removeItem() {} }
    const explicit = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storage: new Storage() } });
    expect((await explicit.auth.getSession()).error).toBeNull(); expect(keys).toEqual(['trailbase-supabase.auth:http://localhost:4000']); expect(sinkCalls).toBe(0);
  });
});
