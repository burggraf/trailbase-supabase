import { expect, it } from 'vitest';
import { createClient } from '../../src/index.js';
const id = '12345678-1234-4234-8234-123456789abc';
const nativeId = Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url');
const now = Math.floor(Date.now() / 1000);
const claims = { sub: nativeId, email: 'owned@example.test', iat: now, exp: now + 600 };
const jwt = (value: unknown) => [Buffer.from(JSON.stringify({ alg: 'EdDSA' })).toString('base64url'), Buffer.from(JSON.stringify(value)).toString('base64url'), 'signature'].join('.');
const reply = (value: unknown = claims) => ({ auth_token: jwt(value), refresh_token: 'fixture-refresh', csrf_token: 'fixture-csrf' });
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const memory = { persistSession: false, autoRefreshToken: false };
const credentials = { email: 'owned@example.test', password: 'Fixture-password' };
const client = (fetch: typeof globalThis.fetch) => createClient('http://localhost:4000', undefined, { trailbase: mapping, auth: memory, global: { fetch } });

it('L1-14/U14 signup sends native repeat once without session or synthetic user', async () => {
  let count = 0;
  const sdk = client(async (input, init) => { count++; expect(new URL(String(input)).pathname).toBe('/api/auth/v1/register'); expect(JSON.parse(String(init?.body))).toEqual({ email: credentials.email, password: credentials.password, password_repeat: credentials.password }); expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error'); expect(new Headers(init?.headers).has('authorization')).toBe(false); return new Response(null, { status: 200 }); });
  expect(await sdk.auth.signUp(credentials)).toEqual({ data: { user: null, session: null }, error: null });
  expect((await sdk.auth.getSession()).data.session).toBeNull(); expect(count).toBe(1);
});
it('L1-15/U15 L1-16/U16 login owns canonical memory/issuance lifetime and bearer-only native data dispatch', async () => {
  const calls: string[] = [];
  const sdk = client(async (input, init) => { const path = new URL(String(input)).pathname; calls.push(path); expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error'); const headers = new Headers(init?.headers); if (path.endsWith('/login')) { expect(JSON.parse(String(init?.body))).toEqual({ email_or_username: credentials.email, password: credentials.password }); expect(headers.has('authorization')).toBe(false); return Response.json(reply()); } expect(headers.get('authorization')).toBe(`Bearer ${reply().auth_token}`); for (const key of ['refresh-token', 'csrf-token', 'apikey']) expect(headers.has(key)).toBe(false); return Response.json({ records: [{ id: nativeId }] }); });
  const result = await sdk.auth.signInWithPassword(credentials);
  expect(result.error).toBeNull(); expect(result.data.user).toEqual({ id, email: claims.email });
  expect(result.data.session).toMatchObject({ token_type: 'bearer', expires_at: claims.exp, expires_in: 600 });
  result.data.session!.user.id = 'tampered'; result.data.session!.access_token = 'tampered'; result.data.user!.email = 'tampered';
  expect((await sdk.auth.getSession()).data.session?.user.id).toBe(id);
  expect((await sdk.from('todos').select()).data).toEqual([{ id }]); expect(calls).toHaveLength(2);
});
it('L1-15/U15 failed replacement retains good session and genuine backend status', async () => {
  let count = 0; const sdk = client(async () => ++count === 1 ? Response.json(reply()) : new Response('Password rejected', { status: 401 }));
  await sdk.auth.signInWithPassword(credentials); const before = await sdk.auth.getSession();
  const failed = await sdk.auth.signInWithPassword(credentials); expect(failed.error?.status).toBe(401); expect(failed.error?.message).toContain('Password rejected'); expect(failed.data).toEqual({ user: null, session: null }); expect(await sdk.auth.getSession()).toEqual(before);
});
it('L1-15/U15 S08 stale login through held JSON decode cannot overwrite newer state', async () => {
  let release!: (value: unknown) => void, started!: () => void;
  const held = new Promise<unknown>(yes => { release = yes; }), ready = new Promise<void>(yes => { started = yes; });
  let count = 0; const sdk = client(async () => { if (++count !== 1) return Response.json(reply({ ...claims, email: 'newer@example.test' })); const response = Response.json({}); response.json = () => { started(); return held; }; return response; });
  const old = sdk.auth.signInWithPassword(credentials); await ready; await sdk.auth.signInWithPassword(credentials); release(reply());
  expect((await old).error?.name).toBe('AuthStaleOperationError'); expect((await sdk.auth.getSession()).data.session?.user.email).toBe('newer@example.test');
});
it('L1-15/U15 malformed credential/JWT/claim/MFA replies never install synthetic state', async () => {
  for (const payload of [{}, { ...reply(), refresh_token: null }, { ...reply(), csrf_token: undefined }, { ...reply(), auth_token: 'bad' }, reply({ ...claims, sub: 'bad' }), reply({ ...claims, email: undefined }), reply({ ...claims, iat: claims.exp + 1 }), reply({ ...claims, exp: now - 1 }), reply({ ...claims, exp: 1.5 }), { mfa_token: 'challenge' }]) {
    const sdk = client(async () => Response.json(payload)); const result = await sdk.auth.signInWithPassword(credentials); expect(result.error).not.toBeNull(); expect(result.data).toEqual({ user: null, session: null }); expect((await sdk.auth.getSession()).data.session).toBeNull();
  }
  const sdk = client(async () => Response.json({ mfa_token: 'private-challenge' }, { status: 403 }));
  const result = await sdk.auth.signInWithPassword(credentials); expect(result.error?.status).toBe(403); expect(result.error?.name).toBe('AuthMfaUnsupportedError'); expect(result.error?.message).not.toContain('private-challenge');
});
it('L1-14/U14 L1-15/U15 unsupported inputs/settings/deferred lifecycle methods are request-free', async () => {
  let calls = 0; const fetch = async () => { calls++; return Response.json(reply()); }; const sdk = client(fetch);
  for (const method of [sdk.auth.signUp, sdk.auth.signInWithPassword]) for (const input of [{ ...credentials, options: {} }, { phone: 'placeholder', password: 'placeholder' }, { ...credentials, email: '' }, Object.create(credentials)]) expect(() => Reflect.apply(method, sdk.auth, [input])).toThrow();
  for (const invoke of [() => Reflect.apply(sdk.auth.getSession, sdk.auth, ['jwt']), () => Reflect.apply(sdk.auth.getUser, sdk.auth, ['jwt']), () => Reflect.apply(sdk.auth.refreshSession, sdk.auth, [{}]), () => sdk.auth.signOut(), () => sdk.auth.onAuthStateChange(() => {})]) expect(invoke).toThrowError(expect.objectContaining({ name: 'UnsupportedFeatureError' }));
  for (const auth of [{}, { persistSession: true }, { persistSession: false, autoRefreshToken: true }, { ...memory, future: true }]) expect(() => createClient('http://localhost:4000', undefined, { trailbase: mapping, auth, global: { fetch } })).toThrowError(expect.objectContaining({ name: 'UnsupportedFeatureError' }));
  const tokenless = createClient('http://localhost:4000', undefined, { trailbase: mapping, global: { fetch } }); expect(() => tokenless.auth.signInWithPassword(credentials)).toThrowError(expect.objectContaining({ name: 'UnsupportedFeatureError' })); expect(calls).toBe(0);
});
it('L1-16/U16 memory state never crosses client instances or leaks to auth requests', async () => {
  const a = client(async () => Response.json(reply())), b = client(async () => Response.json(reply())); await a.auth.signInWithPassword(credentials); expect((await b.auth.getSession()).data.session).toBeNull();
  let calls = 0; const sdk = client(async (_url, init) => { calls++; expect(new Headers(init?.headers).has('authorization')).toBe(false); return Response.json(reply()); }); await sdk.auth.signInWithPassword(credentials); await sdk.auth.signUp(credentials); expect(calls).toBe(2); expect((await sdk.auth.getSession()).data.session).not.toBeNull();
});
