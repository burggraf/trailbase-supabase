import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertLocalUrl } from '../../scripts/harness.mjs';
import { supabase, verificationLink, type Context } from '../phase-a/helpers.js';
import { account, authSnapshot, identity, referenceContext, sessionState } from './helpers.js';
import { withCleanup } from '../sdk-browser/cleanup.js';

async function confirmed(env: Context, label: string) {
  const credentials = identity(label), signup = await supabase(env).auth.signUp(credentials);
  expect(signup.error).toBeNull(); expect(signup.data.session).toBeNull();
  let target = await verificationLink(env, credentials.email);
  for (let i = 0; i < 5; i++) {
    assertLocalUrl(target, env.origins);
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    expect([302, 303]).toContain(response.status);
    const location = response.headers.get('location'); expect(location).not.toBeNull();
    const next = new URL(location!, target); assertLocalUrl(next.href, env.origins);
    const access = new URLSearchParams(next.hash.slice(1)).get('access_token');
    if (access) {
      // Confirmation itself creates a genuine session. Revoke it via its delivered JWT,
      // not SQL deletion, before establishing the two independently observed password sessions.
      const logout = await request(env, '/auth/v1/logout?scope=local', access, { method: 'POST' });
      expect(logout.status).toBe(204);
      expect(await sessionState(env, credentials.email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 });
      return credentials;
    }
    target = next.href;
  }
  throw new Error('Genuine confirmation did not return its session within the owned redirect bound');
}
const request = (env: Context, path: string, token?: string, init: RequestInit = {}) => fetch(new URL(path, env.supabaseUrl), {
  ...init, redirect: 'error', signal: AbortSignal.timeout(10000),
  headers: { apikey: env.anonKey, 'X-Supabase-Api-Version': '2024-01-01', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
});

for (const scope of ['default', 'global'] as const) {
  it(`L1-19/GL01 reference ${scope} logout revokes two refresh sessions, not issued access JWTs or another account`, async () => {
    const env = await referenceContext(), credentials = await confirmed(env, `logout-${scope}`), sibling = await confirmed(env, 'logout-sibling');
    const key = `reference-logout-${randomUUID()}`, values = new Map([['owned-unrelated', 'keep']]);
    const events: string[] = [], observed: Array<{ status: number; scope: string | null; empty: boolean }> = [];
    const first = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: key, storage: {
        getItem: name => values.get(name) ?? null, setItem: (name, value) => { values.set(name, value); }, removeItem: name => { values.delete(name); },
      } },
      global: { fetch: async (input, init) => {
        const response = await fetch(input, init), url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === '/auth/v1/logout') observed.push({ status: response.status, scope: url.searchParams.get('scope'), empty: (await response.clone().text()) === '' });
        return response; // Observe the genuine acknowledgement, never replace successful auth responses.
      } },
    });
    const second = supabase(env), other = supabase(env), remoteEvents: string[] = [];
    const subscription = first.auth.onAuthStateChange(event => { events.push(event); }).data.subscription;
    const remoteSubscription = second.auth.onAuthStateChange(event => { remoteEvents.push(event); }).data.subscription;
    const rowId = randomUUID(); let cleanupAccess: string | undefined;
    await withCleanup(async () => {
      const a = await first.auth.signInWithPassword(credentials), b = await second.auth.signInWithPassword(credentials), c = await other.auth.signInWithPassword(sibling);
      cleanupAccess = b.data.session?.access_token;
      for (const login of [a, b, c]) { expect(login.error).toBeNull(); expect(login.data.session).not.toBeNull(); }
      expect(a.data.session!.refresh_token).not.toBe(b.data.session!.refresh_token);
      expect(a.data.user!.id).toBe(b.data.user!.id); expect(c.data.user!.id).not.toBe(a.data.user!.id);
      expect(await sessionState(env, credentials.email)).toMatchObject({ sessions: 2, activeRefreshTokens: 2 });
      const siblingBefore = await sessionState(env, sibling.email), accountBefore = await account(env, credentials.email);
      const insert = await second.from('todos').insert({ id: rowId, user_id: b.data.user!.id, title: `logout-${rowId}`, note: 'preserved' });
      expect(insert.error).toBeNull();
      const read = (token: string) => request(env, `/rest/v1/todos?select=*&id=eq.${rowId}`, token);
      const before = await read(a.data.session!.access_token); expect(before.status).toBe(200); const rows = await before.json(); expect(rows).toHaveLength(1);
      const logout = scope === 'default' ? await first.auth.signOut() : await first.auth.signOut({ scope: 'global' });
      expect(logout.error).toBeNull(); expect(observed).toEqual([{ status: 204, scope: 'global', empty: true }]);
      expect((await first.auth.getSession()).data.session).toBeNull(); expect(values.has(key)).toBe(false); expect(values.get('owned-unrelated')).toBe('keep');
      expect(events.filter(event => event === 'SIGNED_OUT')).toHaveLength(1); expect(remoteEvents).not.toContain('SIGNED_OUT');
      expect(await sessionState(env, credentials.email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 });
      expect(await account(env, credentials.email)).toEqual(accountBefore); expect(await sessionState(env, sibling.email)).toEqual(siblingBefore);
      // JWT-backed REST access remains valid until expiry; refresh-session deletion is not immediate JWT revocation.
      for (const session of [a.data.session!, b.data.session!]) {
        expect(session.expires_at! * 1000).toBeGreaterThan(Date.now());
        const response = await read(session.access_token); expect(response.status).toBe(200); expect(await response.json()).toEqual(rows);
        const refresh = await request(env, '/auth/v1/token?grant_type=refresh_token', undefined, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
        expect(refresh.status).toBe(400); expect((await refresh.json()).code).toBe('refresh_token_not_found');
      }
      expect(remoteEvents).not.toContain('SIGNED_OUT');
      const remote = await second.auth.refreshSession(); expect(remote.error?.status).toBe(400); expect(remote.data.session).toBeNull();
      // JS2.117.2 preserves an unexpired cached session after failed proactive refresh; no fabricated remote sign-out event.
      expect((await second.auth.getSession()).data.session).toEqual(b.data.session); expect(remoteEvents).not.toContain('SIGNED_OUT');
      expect((await second.auth.signOut({ scope: 'local' })).error).toBeNull();
      expect((await second.auth.getSession()).data.session).toBeNull(); expect(remoteEvents.filter(event => event === 'SIGNED_OUT')).toHaveLength(1);
      expect((await other.auth.refreshSession()).error).toBeNull(); expect((await other.auth.getUser()).data.user?.id).toBe(c.data.user!.id);
      // The old, genuinely issued JWT still has ordinary owner permissions, including exact generated-row cleanup.
      const remove = await request(env, `/rest/v1/todos?id=eq.${rowId}`, a.data.session!.access_token, { method: 'DELETE' }); expect(remove.status).toBe(204);
      const gone = await read(b.data.session!.access_token); expect(gone.status).toBe(200); expect(await gone.json()).toEqual([]);
    }, [
      async () => { subscription.unsubscribe(); remoteSubscription.unsubscribe(); },
      async () => {
        if (!cleanupAccess) return;
        const path = `/rest/v1/todos?id=eq.${rowId}`, before = await request(env, path, cleanupAccess);
        expect(before.status).toBe(200);
        if ((await before.json()).length) expect((await request(env, path, cleanupAccess, { method: 'DELETE' })).status).toBe(204);
        const after = await request(env, path, cleanupAccess); expect(after.status).toBe(200); expect(await after.json()).toEqual([]);
      },
      ...[first, second, other].map(client => async () => { expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull(); }),
      async () => { for (const email of [credentials.email, sibling.email]) expect(await sessionState(env, email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 }); },
    ]);
  }, 60000);
}

it('L1-19/GL02 reference missing/invalid authorization cannot acknowledge global revocation; empty SDK logout only clears local state', async () => {
  const env = await referenceContext(), credentials = await confirmed(env, 'logout-auth'), client = supabase(env);
  expect((await client.auth.signInWithPassword(credentials)).error).toBeNull();
  await withCleanup(async () => {
    const before = await authSnapshot(env);
    for (const [label, token, status] of [['missing', undefined, 401], ['invalid', 'not-a-jwt', 403]] as const) {
      const denied = await request(env, '/auth/v1/logout?scope=global', token, { method: 'POST' });
      // Keep each configured path's observed status distinct, rather than inferring one from the other.
      expect(denied.status, `${label} caller authorization`).toBe(status);
      if (token !== undefined) expect((await denied.json()).code).toBe('bad_jwt');
      expect(await authSnapshot(env)).toEqual(before);
    }
    let logoutRequests = 0;
    const empty = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => { if (new URL(input instanceof Request ? input.url : String(input)).pathname === '/auth/v1/logout') logoutRequests++; return fetch(input, init); } },
    });
    expect((await empty.auth.signOut()).error).toBeNull(); expect(logoutRequests).toBe(0);
    expect((await empty.auth.getSession()).data.session).toBeNull(); expect(await authSnapshot(env)).toEqual(before);
    expect((await client.auth.getUser()).data.user?.email).toBe(credentials.email);
  }, [
    async () => { expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull(); },
    async () => { expect(await sessionState(env, credentials.email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 }); },
  ]);
}, 60000);
