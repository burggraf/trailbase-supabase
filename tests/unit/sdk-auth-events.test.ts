import { expect, it } from 'vitest';
import { createClient, type AuthChangeEvent, type AuthSession } from '../../src/index.js';

const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const credentials = { email: 'owned@example.test', password: 'Fixture-password' };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function tokens(label: string) {
  const now = Math.floor(Date.now() / 1000);
  return { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: label, iat: now - 1, exp: now + 600 })}.signature`, refresh_token: `refresh-${label}`, csrf_token: 'csrf' };
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const turn = () => new Promise<void>(yes => setImmediate(yes));
const factory = (fetch: typeof globalThis.fetch) => createClient('http://localhost:4000', undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch } });

it('L1-20/U20 initial/login/refresh/logout notifications are ordered, cloned and reentrant without deadlock', async () => {
  const client = factory(async input => {
    const path = new URL(String(input)).pathname;
    return path.endsWith('/logout') ? new Response() : path.endsWith('/refresh') ? Response.json({ auth_token: tokens('renewed').auth_token, csrf_token: 'new-csrf' }) : Response.json(tokens('A'));
  });
  const events: [AuthChangeEvent, string | null][] = [], reads: Promise<unknown>[] = [];
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    events.push([event, session?.user.email ?? null]); reads.push(client.auth.getSession());
    if (session) { session.user.email = 'tampered'; session.access_token = 'tampered'; }
  });
  await turn(); expect(events).toEqual([['INITIAL_SESSION', null]]);
  await client.auth.signInWithPassword(credentials); await client.auth.refreshSession(); await client.auth.signOut({ scope: 'local' }); await turn();
  expect(events).toEqual([['INITIAL_SESSION', null], ['SIGNED_IN', 'A'], ['TOKEN_REFRESHED', 'renewed'], ['SIGNED_OUT', null]]);
  await Promise.all(reads); expect((await client.auth.getSession()).data.session).toBeNull();
  subscription.unsubscribe(); subscription.unsubscribe(); await client.auth.signInWithPassword(credentials); await turn(); expect(events).toHaveLength(4);
});

it('L1-20/S08 late hydration never emits recovered A after newer login B', async () => {
  const held = deferred<string | null>(), entered = deferred<void>(); const events: [AuthChangeEvent, string | null][] = [];
  const client = createClient('http://localhost:4000', undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storage: { getItem: () => { entered.resolve(); return held.promise; }, setItem: () => {}, removeItem: () => {} } }, global: { fetch: async () => Response.json(tokens('B')) } });
  const subscription = client.auth.onAuthStateChange((event, session) => { events.push([event, session?.user.email ?? null]); }).data.subscription;
  await entered.promise; const login = client.auth.signInWithPassword(credentials); held.resolve(JSON.stringify({ version: 1, tokens: tokens('A') }));
  expect((await login).error).toBeNull(); await turn();
  expect(events[0]?.[0]).toBe('INITIAL_SESSION'); expect(events.filter(([event]) => event === 'SIGNED_IN')).toEqual([['SIGNED_IN', 'B']]);
  expect((await client.auth.getSession()).data.session?.user.email).toBe('B'); subscription.unsubscribe();
});

it('L1-20/U20 callback throws/rejections and snapshot mutation cannot affect independent listeners or auth state', async () => {
  const client = factory(async () => Response.json(tokens('A'))); const observed: (string | null)[] = [];
  const first = client.auth.onAuthStateChange((_event, session) => { if (session) session.user.email = 'tampered'; throw new Error('private-callback-error'); }).data.subscription;
  const second = client.auth.onAuthStateChange(async () => { throw new Error('private-async-error'); }).data.subscription;
  const third = client.auth.onAuthStateChange((_event, session) => { observed.push(session?.user.email ?? null); }).data.subscription;
  await turn(); expect((await client.auth.signInWithPassword(credentials)).error).toBeNull(); await turn();
  expect(observed).toEqual([null, 'A']); expect((await client.auth.getSession()).data.session?.user.email).toBe('A');
  for (const subscription of [first, second, third]) subscription.unsubscribe();
});

it('L1-20/U20 unsubscribe before initialization suppresses all late callbacks and invalid registration has no side effects', async () => {
  let calls = 0; const client = factory(async () => { calls++; return Response.json(tokens('A')); });
  for (const args of [[null], [() => {}, {}]]) expect(() => Reflect.apply(client.auth.onAuthStateChange, client.auth, args)).toThrow();
  const subscription = client.auth.onAuthStateChange(() => { calls++; }).data.subscription; subscription.unsubscribe(); await turn(); expect(calls).toBe(0);
});

it('L1-20/S08 failed/stale login and failed refresh never emit successful state transitions', async () => {
  const held = deferred<Response>(), entered = deferred<void>(); let calls = 0; const events: AuthChangeEvent[] = [];
  const client = factory(async input => {
    if (new URL(String(input)).pathname.endsWith('/logout')) return new Response();
    if (++calls === 1) { entered.resolve(); return held.promise; } return new Response(null, { status: 500 });
  });
  const subscription = client.auth.onAuthStateChange(event => { events.push(event); }).data.subscription; await turn();
  const old = client.auth.signInWithPassword(credentials); await entered.promise; await client.auth.signOut({ scope: 'local' }); held.resolve(Response.json(tokens('late'))); await old;
  await client.auth.signInWithPassword(credentials); await client.auth.refreshSession(); await turn();
  expect(events.every(event => event === 'INITIAL_SESSION' || event === 'SIGNED_OUT')).toBe(true); subscription.unsubscribe();
});

it('L1-20/U20 100 listener lifecycles leave no retired callbacks receiving later transitions', async () => {
  const client = factory(async () => Response.json(tokens('A'))); let retired = 0;
  for (let index = 0; index < 100; index++) { const subscription = client.auth.onAuthStateChange(() => { retired++; }).data.subscription; subscription.unsubscribe(); }
  await client.auth.signInWithPassword(credentials); await turn(); expect(retired).toBe(0);
});

// Compile-time callback uses only the supported public session, never native CSRF.
const callback: (event: AuthChangeEvent, session: AuthSession | null) => void = () => {}; void callback;
