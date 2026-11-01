import { afterEach, expect, it, vi } from 'vitest';
import { createClient, type AuthOptions } from '../../src/index.js';

const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const credentials = { email: 'owned@example.test', password: 'Fixture-password' };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function tokens(label = 'A') {
  const now = Math.floor(Date.now() / 1000);
  return { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: label, iat: now, exp: now + 60 })}.signature`, refresh_token: `refresh-${label}`, csrf_token: 'csrf' };
}
const factory = (fetch: typeof globalThis.fetch, auth: AuthOptions = {}) => createClient('http://localhost:4000', undefined, { trailbase: mapping, auth, global: { fetch } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('L1-18/U18 explicit false owns no timer; opted-in defaults renew before expiry and logout clears every timer', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-06T00:00:00Z') });
  for (const autoRefreshToken of [false, true]) {
    let renewals = 0;
    const client = factory(async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/logout')) return new Response();
      if (path.endsWith('/refresh')) { renewals++; return Response.json({ auth_token: tokens().auth_token, csrf_token: 'renewed' }); }
      return Response.json(tokens());
    }, { persistSession: false, autoRefreshToken });
    expect((await client.auth.signInWithPassword(credentials)).error).toBeNull(); expect(vi.getTimerCount()).toBe(autoRefreshToken ? 1 : 0);
    await vi.advanceTimersByTimeAsync(31000); expect(renewals).toBe(autoRefreshToken ? 1 : 0);
    expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  }
});

it('L1-18/U18 auth option defaults persist per-client Node memory and own background renewal, not inherited flags', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-06T00:00:00Z') }); const client = factory(async () => Response.json(tokens()));
  expect((await client.auth.signInWithPassword(credentials)).error).toBeNull(); expect(vi.getTimerCount()).toBe(1);
  const other = factory(async () => Response.json(tokens())); expect((await other.auth.getSession()).data.session).toBeNull();
  await client.auth.signOut({ scope: 'local' }); expect(vi.getTimerCount()).toBe(0);
});

it('L1-18/S08 background and manual refresh share one flight and a late result cannot revive logout', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-06T00:00:00Z') }); let release!: (value: Response) => void, calls = 0;
  const held = new Promise<Response>(yes => { release = yes; });
  const client = factory(async input => {
    const path = new URL(String(input)).pathname; if (path.endsWith('/logout')) return new Response();
    if (path.endsWith('/refresh')) { calls++; return held; } return Response.json(tokens());
  }, { persistSession: false, autoRefreshToken: true });
  await client.auth.signInWithPassword(credentials); await vi.advanceTimersByTimeAsync(31000); const manual = client.auth.refreshSession(); expect(calls).toBe(1);
  await client.auth.signOut({ scope: 'local' }); release(Response.json({ auth_token: tokens().auth_token, csrf_token: 'renewed' }));
  expect((await manual).error?.name).toBe('AuthStaleOperationError'); await vi.advanceTimersByTimeAsync(120000);
  expect(calls).toBe(1); expect(vi.getTimerCount()).toBe(0); expect((await client.auth.getSession()).data.session).toBeNull();
});

it('L1-18/U18 transient background errors have bounded retries; terminal401 clears credentials and resources', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-06T00:00:00Z') }); let renewals = 0;
  const client = factory(async input => {
    if (new URL(String(input)).pathname.endsWith('/refresh')) return new Response(null, { status: ++renewals === 1 ? 503 : 401 });
    return Response.json(tokens());
  }, { persistSession: false, autoRefreshToken: true });
  await client.auth.signInWithPassword(credentials); await vi.advanceTimersByTimeAsync(30000); expect(renewals).toBe(1);
  await vi.advanceTimersByTimeAsync(9999); expect(renewals).toBe(1); await vi.advanceTimersByTimeAsync(1); expect(renewals).toBe(2);
  expect((await client.auth.getSession()).data.session).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});

it('L1-18/U18 focus/visibility renewal is owned once and both listeners detach on logout', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-06T00:00:00Z') }); const target = new EventTarget(), visibility = new EventTarget(); let renewals = 0;
  const add = vi.spyOn(target, 'addEventListener'), remove = vi.spyOn(target, 'removeEventListener');
  const addVisibility = vi.spyOn(visibility, 'addEventListener'), removeVisibility = vi.spyOn(visibility, 'removeEventListener');
  vi.stubGlobal('window', target); vi.stubGlobal('document', Object.assign(visibility, { visibilityState: 'visible' }));
  const client = factory(async input => {
    const path = new URL(String(input)).pathname; if (path.endsWith('/logout')) return new Response();
    if (path.endsWith('/refresh')) { renewals++; return Response.json({ auth_token: tokens().auth_token, csrf_token: 'new' }); } return Response.json(tokens());
  }, { persistSession: false, autoRefreshToken: true });
  await client.auth.signInWithPassword(credentials); await vi.advanceTimersByTimeAsync(30000); expect(renewals).toBe(1);
  target.dispatchEvent(new Event('focus')); visibility.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
  expect(renewals).toBe(1); expect(add).toHaveBeenCalledTimes(1); expect(addVisibility).toHaveBeenCalledTimes(1);
  await client.auth.signOut({ scope: 'local' }); expect(remove).toHaveBeenCalledTimes(1); expect(removeVisibility).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
