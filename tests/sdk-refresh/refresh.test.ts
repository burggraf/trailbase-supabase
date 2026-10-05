import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type AuthStorage } from '../../src/index.js';
import { context, confirmEmail, nativeUuid, type Context } from '../phase-a/helpers.js';
import { withCleanup, cleanupOwnedRows } from '../sdk-browser/cleanup.js';

const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
function fixture(env: Context) {
  if (env.nativeAuthProfile !== 'short-native-auth') throw new Error('Run dedicated test:sdk:refresh with owned short-native-auth profile');
  const key = `refresh-${randomUUID()}`, data = new Map([['unrelated', 'keep']]);
  const credentials = { email: `sdk-refresh-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` }, rowId = randomUUID();
  let owner: string | undefined, rowAttempted = false, storageRejected = false, cleanupVerified = false, refreshes = 0, recordRequests = 0;
  const storage: AuthStorage = { getItem: k => { if (storageRejected) throw new Error('Injected owned storage unavailable'); return data.get(k) ?? null; }, setItem: (k, v) => { if (storageRejected) throw new Error('Injected owned storage unavailable'); data.set(k, v); }, removeItem: k => { if (storageRejected) throw new Error('Injected owned storage unavailable'); data.delete(k); } };
  const make = (persist = true) => createClient(env.trailUrl, undefined, { trailbase: mapping, auth: { persistSession: persist, autoRefreshToken: false, ...(persist ? { storageKey: key, storage } : {}) }, global: { fetch: (input, init) => { const path = new URL(String(input)).pathname; if (path.endsWith('/refresh')) refreshes++; if (path.startsWith('/api/records/')) recordRequests++; return fetch(input, { ...init, signal: AbortSignal.timeout(10000) }); } } });
  const client = make();
  async function acquire() {
    expect((await client.auth.signUp(credentials)).error).toBeNull(); await confirmEmail(env, credentials.email);
    const login = await client.auth.signInWithPassword(credentials); expect(login.error).toBeNull(); const original = login.data.session!;
    owner = original.user.id; expect(original.expires_in).toBe(3);
    rowAttempted = true; // Unknown write outcomes still require exact-ID cleanup.
    expect((await client.from('todos').insert({ id: rowId, user_id: owner, title: `refresh-${rowId}` })).error).toBeNull();
    return original;
  }
  const cleanup = [
    async () => {
      if (!rowAttempted) return;
      if (!owner) throw new Error('Owned row attempt lacks acquired owner');
      // Independent fresh genuine password credentials; never storage/expired refresh under test.
      const fresh = make(false), login = await fresh.auth.signInWithPassword(credentials);
      expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(owner);
      const { initClient } = await import('trailbase');
      const raw = initClient(env.trailUrl, { transport: { fetch: (path, init) => fetch(new URL(path, env.trailUrl), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: `Bearer ${login.data.session!.access_token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) }) } });
      await cleanupOwnedRows(raw.records('todos'), nativeUuid(owner), [nativeUuid(rowId)]);
      expect((await raw.records('todos').list({ filters: [{ column: 'id', value: nativeUuid(rowId) }] })).records).toEqual([]);
      cleanupVerified = true;
    },
    async () => { data.delete(key); expect(data.get('unrelated')).toBe('keep'); },
  ];
  return { client, make, acquire, cleanup, data, key, rowId, rejectStorage: () => { storageRejected = true; }, counts: () => ({ refreshes, recordRequests }), cleanupVerified: () => cleanupVerified };
}
async function waitActualDenial(env: Context, token: string, exp: number) {
  const deadline = Date.now() + 80000;
  while (Date.now() < deadline) {
    const response = await fetch(`${env.trailUrl}/api/records/v1/todos`, { headers: { authorization: `Bearer ${token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000) });
    const status = response.status; await response.body?.cancel();
    if ([401, 403].includes(status)) { expect(Date.now() / 1000).toBeGreaterThan(exp); return; }
    expect(status).toBe(200); await new Promise(yes => setTimeout(yes, 250));
  }
  throw new Error('Actual native access expiry denial deadline exceeded');
}
it('L1-18/I18 genuine expired data/getSession initiate shared renewal, independent manual join, persistent owner reload and rejected refresh', async () => {
  const env = await context(), run = fixture(env);
  await withCleanup(async () => {
    const original = await run.acquire();
    const nativeRefresh = await fetch(`${env.trailUrl}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: original.refresh_token }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    expect(nativeRefresh.status).toBe(200); expect(Object.keys(await nativeRefresh.json()).sort()).toEqual(['auth_token', 'csrf_token']);
    await waitActualDenial(env, original.access_token, original.expires_at);
    const expiredStatus = await fetch(`${env.trailUrl}/api/auth/v1/status`, { headers: { authorization: `Bearer ${original.access_token}`, 'Refresh-Token': original.refresh_token }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    expect(expiredStatus.status).toBe(200); expect(await expiredStatus.json()).toEqual({auth_token:null,refresh_token:null,csrf_token:null});
    const before = run.counts(), diskBefore = run.data.get(run.key);
    // No manual call: this fails if the actual-expiry trigger is removed.
    const row = Promise.resolve(run.client.from('todos').select().eq('id', run.rowId).single()), cached = run.client.auth.getSession();
    expect((await row).data?.user_id).toBe(original.user.id); expect((await cached).error).toBeNull();
    expect(run.counts().refreshes - before.refreshes).toBe(1); expect(run.counts().recordRequests - before.recordRequests).toBe(1); expect(run.data.get(run.key)).not.toBe(diskBefore);
    const liveUser = await run.client.auth.getUser(); expect(liveUser.error).toBeNull(); expect(liveUser.data.user).toEqual(original.user);
    const manualCount = run.counts().refreshes, manual = run.client.auth.refreshSession(), joined = run.client.auth.getSession();
    expect((await manual).data.session?.refresh_token).toBe(original.refresh_token); expect((await joined).error).toBeNull(); expect(run.counts().refreshes - manualCount).toBe(1);
    const reload = run.make(); expect((await reload.auth.getSession()).data.session?.user.id).toBe(original.user.id); expect((await reload.from('todos').select().eq('id', run.rowId).single()).data?.user_id).toBe(original.user.id);
    expect((await run.client.from('todos').delete().eq('id', run.rowId)).error).toBeNull(); expect((await run.client.from('todos').select().eq('id', run.rowId)).data).toEqual([]);
    const session = (await run.client.auth.getSession()).data.session!;
    const logout = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ refresh_token: session.refresh_token }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) }); expect(logout.ok).toBe(true);
    expect((await run.client.auth.refreshSession()).error?.status).toBe(401); expect(run.data.has(run.key)).toBe(false); expect((await run.client.auth.getSession()).data.session).toBeNull();
  }, run.cleanup);
  expect(run.cleanupVerified()).toBe(true);
}, 120000);
for (const unavailable of ['absent', 'rejected'] as const) it(`L1-18/I18 cleanup verifies owned row absence after genuine expiry/injected failure with ${unavailable} storage`, async () => {
  const env = await context(), run = fixture(env), injected = new Error('Injected failure after genuine backend expiry'); let failure: unknown;
  try {
    await withCleanup(async () => {
      const original = await run.acquire(); await waitActualDenial(env, original.access_token, original.expires_at);
      if (unavailable === 'absent') run.data.delete(run.key); else run.rejectStorage();
      throw injected; // No refresh occurs; original access credential has actually been denied.
    }, run.cleanup);
  } catch (error) { failure = error; }
  expect(failure).toBe(injected); // Aggregate cleanup failures must fail this vector, not mask it.
  expect(run.cleanupVerified()).toBe(true); expect(run.data.get('unrelated')).toBe('keep');
}, 120000);
