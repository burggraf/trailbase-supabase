import { it, expect } from 'vitest';
import { createClient, type AuthStorage } from '../../src/index.js';
const trailbase = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const now = Math.floor(Date.now() / 1000), id = '12345678-1234-4234-8234-123456789abc';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (email = 'C', expired = false, owner = id) => `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from(owner.replaceAll('-', ''), 'hex').toString('base64url'), email, iat: now - 120, exp: now + (expired ? -60 : 600) })}.signature`;
const native = (email = 'C', expired = false) => ({ auth_token: token(email, expired), refresh_token: 'genuine-refresh', csrf_token: 'old-csrf' });
const renewed = (email = 'C') => ({ auth_token: token(email), csrf_token: 'new-csrf' });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const memory = (data: Map<string,string>): AuthStorage => ({ getItem: k => data.get(k) ?? null, setItem: (k,v) => { data.set(k,v); }, removeItem: k => { data.delete(k); } });
const factory = (data: Map<string,string>, fetch: typeof globalThis.fetch, storage = memory(data)) => createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storageKey: 'owned', storage }, global: { fetch } });
const stored = (expired = false) => new Map([['owned', JSON.stringify({ version: 1, tokens: native('C', expired) })], ['unrelated','keep']]);
const credentials = { email:'placeholder', password:'placeholder' };

it('L1-18/U18 manual/data/getSession actual-expiry preflight share one refresh and send original data once with bearer only', async () => {
  const data = stored(true), held = deferred<Response>(), ready = deferred<void>(); let refreshes=0, reads=0;
  const client = factory(data, async (input, init) => {
    expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error'); const headers = new Headers(init?.headers);
    if (new URL(String(input)).pathname.endsWith('/refresh')) { refreshes++; expect(JSON.parse(String(init?.body))).toEqual({refresh_token:'genuine-refresh'}); expect(headers.has('authorization')).toBe(false); expect(headers.has('refresh-token')).toBe(false); expect(headers.has('csrf-token')).toBe(false); ready.resolve(); return held.promise; }
    reads++; expect(headers.get('authorization')).toBe(`Bearer ${renewed().auth_token}`); expect(headers.has('refresh-token')).toBe(false); expect(headers.has('csrf-token')).toBe(false); return Response.json({records:[]});
  });
  const manual=client.auth.refreshSession(), read=Promise.resolve(client.from('todos').select()), cached=client.auth.getSession(); await ready.promise; held.resolve(Response.json(renewed()));
  expect((await manual).error).toBeNull(); expect((await read).error).toBeNull(); expect((await cached).data.session?.refresh_token).toBe('genuine-refresh'); expect(refreshes).toBe(1); expect(reads).toBe(1);
  expect(JSON.parse(data.get('owned')!).tokens).toEqual({...renewed(),refresh_token:'genuine-refresh'}); expect(data.get('unrelated')).toBe('keep');
});
it('L1-18/U18 malformed/private JSON, wrong identity and unsupported refresh fields preserve prior disk without retry', async () => {
  for (const payload of [{...renewed(),auth_token:`${encode({alg:'EdDSA'})}.${Buffer.from('private-jwt-prefix {broken').toString('base64url')}.signature`}, {}, {...renewed(),refresh_token:'fabricated'}, {...renewed(),csrf_token:null}, {...renewed(),auth_token:token('other',false,'12345678-1234-4234-8234-123456789abd')}]) {
    const data=stored(), before=data.get('owned'); let calls=0; const client=factory(data,async()=>{calls++;return Response.json(payload);});
    const failed = await client.auth.refreshSession(); expect(failed.error).not.toBeNull(); expect(failed.error?.message).not.toContain('private-jwt-prefix'); expect(data.get('owned')).toBe(before); expect((await client.auth.getSession()).data.session?.user.email).toBe('C'); expect(calls).toBe(1);
  }
  const data=stored(); const client=factory(data,async()=>new Response('private-json-prefix {broken'));
  const result=await client.auth.refreshSession(); expect(result.error?.name).toBe('AuthInvalidPayloadError'); expect(result.error?.message).not.toContain('private-json-prefix');
  expect(()=>Reflect.apply(client.auth.refreshSession,client.auth,[{}])).toThrowError(expect.objectContaining({name:'UnsupportedFeatureError'}));
});
it('L1-18/S08 held refresh JSON cannot replace newer login or authorize an old waiting query', async () => {
  const data=stored(true), held=deferred<unknown>(), ready=deferred<void>(); let reads=0;
  const client=factory(data,async(input,init)=>{
    const path=new URL(String(input)).pathname;
    if(path.endsWith('/refresh')){const response=Response.json({});response.json=()=>{ready.resolve();return held.promise;};return response;}
    if(path.endsWith('/login'))return Response.json(native('newer'));
    reads++; expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${native('newer').auth_token}`); return Response.json({records:[]});
  });
  const refresh=client.auth.refreshSession(), waiting=Promise.resolve(client.from('todos').select());await ready.promise;await client.auth.signInWithPassword(credentials);held.resolve(renewed());
  expect((await refresh).error?.name).toBe('AuthStaleOperationError');expect((await waiting).error?.name).toBe('AuthStaleOperationError');expect(reads).toBe(0);expect((await client.auth.getSession()).data.session?.user.email).toBe('newer');expect((await client.from('todos').select()).error).toBeNull();expect(reads).toBe(1);
});
it('L1-18/S08 held refresh write plus failed newer login compensates C; no stale refreshed disk survives', async () => {
  const data=stored(), before=data.get('owned'), held=deferred<void>(), ready=deferred<void>();
  const storage={...memory(data),setItem:async(k:string,v:string)=>{data.set(k,v);if(JSON.parse(v).tokens.csrf_token==='new-csrf'){ready.resolve();await held.promise;}}};
  const client=factory(data,async input=>new URL(String(input)).pathname.endsWith('/refresh')?Response.json(renewed()):new Response('Rejected',{status:401}),storage);
  const refresh=client.auth.refreshSession();await ready.promise;const login=client.auth.signInWithPassword(credentials);held.resolve();
  expect((await refresh).error?.name).toBe('AuthStaleOperationError');expect((await login).error?.status).toBe(401);expect(data.get('owned')).toBe(before);expect((await client.auth.getSession()).data.session?.user.email).toBe('C');
});
it('L1-18/U18 transient/network/other4xx preserve state and expired data never falls back or retries', async () => {
  for(const status of [403,429,500,503]){const data=stored(true),before=data.get('owned');let calls=0;const client=factory(data,async()=>{calls++;return new Response('Unavailable',{status});}); const result=await client.from('todos').select();expect(result.error?.status).toBe(status);expect(data.get('owned')).toBe(before);expect(calls).toBe(1);}
  const data=stored(),before=data.get('owned');const client=factory(data,async()=>{throw new Error('Network unavailable');});expect((await client.auth.refreshSession()).error?.message).toContain('Network unavailable');expect(data.get('owned')).toBe(before);
});
it('L1-18/S07 only refresh401 clears owned credentials; held removal cannot resurrect C after newer failed/successful login', async () => {
  for(const succeeds of [false,true]){const data=stored(),held=deferred<void>(),ready=deferred<void>();const storage={...memory(data),removeItem:async(k:string)=>{data.delete(k);ready.resolve();await held.promise;}};
    const client=factory(data,async input=>new URL(String(input)).pathname.endsWith('/refresh')?new Response('Revoked',{status:401}):succeeds?Response.json(native('B')):new Response('Rejected',{status:401}),storage);
    const refresh=client.auth.refreshSession();await ready.promise;const login=client.auth.signInWithPassword(credentials);held.resolve();
    expect((await refresh).error?.status).toBe(401);await login;const session=await client.auth.getSession();expect(session.data.session?.user.email??null).toBe(succeeds?'B':null);expect(data.has('owned')).toBe(succeeds);expect(data.get('unrelated')).toBe('keep');
  }
});
it('L1-18/S07 rejected terminal removal latches sanitized errors, leaves disk explicit and dispatches zero further requests', async () => {
  const data=stored(true),before=data.get('owned');let calls=0;const client=factory(data,async()=>{calls++;return new Response('Revoked',{status:401});},{...memory(data),removeItem:()=>{throw new Error('private-removal-payload');}});
  expect((await client.from('todos').select()).error?.name).toBe('AuthStorageRemoveError');expect(data.get('owned')).toBe(before);
  for(const result of [await client.auth.getSession(),await client.auth.refreshSession(),await client.auth.signInWithPassword(credentials),await client.from('todos').select()]){expect(result.error?.name).toBe('AuthStorageRemoveError');expect(result.error?.message).not.toContain('private-removal-payload');}expect(calls).toBe(1);
});
