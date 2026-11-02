import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertLocalUrl } from '../../scripts/harness.mjs';
import { supabase, verificationLink } from '../phase-a/helpers.js';
import { identity, referenceContext, sessionState, account } from './helpers.js';
import { withCleanup } from '../sdk-browser/cleanup.js';

it('L1-18/L1-19/C08-02/03 PRIVATE120s reference installs genuine expired renewal and distinguishes proactive rejection from expired rejection', async () => {
  const env = await referenceContext(); expect(await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8')).toContain('jwt_expiry = 120');
  const good = identity('state-exp-good'), bad = identity('state-exp-bad'), sibling = identity('state-exp-control');
  const raw = (path: string, token: string, method = 'GET') => fetch(new URL(path, env.supabaseUrl), { method, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { apikey: env.anonKey, 'X-Supabase-Api-Version': '2024-01-01', authorization: `Bearer ${token}` } });
  for (const credentials of [good, bad, sibling]) {
    expect((await supabase(env).auth.signUp(credentials)).error).toBeNull(); let target = await verificationLink(env, credentials.email), delivered = false;
    for (let n = 0; n < 5; n++) {
      assertLocalUrl(target, env.origins); const r = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10000) }); expect([302, 303]).toContain(r.status);
      const location = r.headers.get('location'); expect(location).not.toBeNull(); const next = new URL(location!, target); assertLocalUrl(next.href, env.origins);
      const access = new URLSearchParams(next.hash.slice(1)).get('access_token');
      if (access) { expect((await raw('/auth/v1/logout?scope=local', access, 'POST')).status).toBe(204); delivered = true; break; } target = next.href;
    }
    expect(delivered).toBe(true); expect(await sessionState(env, credentials.email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 });
  }
  const stores = new Map<string, Map<string, string>>(), events: Array<{ label: string; event: string; token: string | null }> = [], calls: Array<{ label: string; path: string; status: number }> = [];
  const entries = new Map<string, () => void>(), gates = new Map<string, Promise<void>>(), releases = new Map<string, () => void>(), arrivals = new Map<string, Promise<void>>();
  for (const label of ['good', 'proactive']) { gates.set(label, new Promise(yes => releases.set(label, yes))); arrivals.set(label, new Promise(yes => entries.set(label, yes))); }
  const make = (label: string) => {
    const values = new Map([['unrelated', 'keep']]); stores.set(label, values);
    return createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: label, storage: {
        getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
      } }, global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input)), path = url.pathname + (url.searchParams.has('grant_type') ? '?' + url.searchParams.get('grant_type') : '');
        if (url.pathname === '/auth/v1/logout' && gates.has(label)) { entries.get(label)!(); await gates.get(label)!; }
        const r = await fetch(input, init); if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/logout') calls.push({ label, path, status: r.status }); return r;
      } },
    });
  };
  const first = make('good'), second = make('remote'), proactive = make('proactive'), expired = make('expired'), control = make('control');
  const clients = [first, second, proactive, expired, control], labels = ['good', 'remote', 'proactive', 'expired', 'control'];
  const subscriptions = clients.map((client, i) => client.auth.onAuthStateChange((event, session) => { events.push({ label: labels[i], event, token: session?.access_token ?? null }); }).data.subscription);
  const rowId = randomUUID(); const pending: Array<Promise<unknown>> = [];
  await withCleanup(async () => {
    const a = await first.auth.signInWithPassword(good), b = await second.auth.signInWithPassword(good), p = await proactive.auth.signInWithPassword(bad), e = await expired.auth.signInWithPassword(bad), c = await control.auth.signInWithPassword(sibling);
    for (const result of [a, b, p, e, c]) { expect(result.error).toBeNull(); expect(result.data.session?.expires_in).toBe(120); }
    const accounts = await Promise.all([good, bad, sibling].map(x => account(env, x.email))), controlBefore = await sessionState(env, sibling.email);
    expect((await control.from('todos').insert({ id: rowId, user_id: c.data.user!.id, title: `state-exp-${rowId}` })).error).toBeNull();
    const rows = await control.from('todos').select('*').eq('id', rowId); expect(rows.error).toBeNull(); expect(rows.data).toHaveLength(1);
    expect((await raw('/auth/v1/logout?scope=global', p.data.session!.access_token, 'POST')).status).toBe(204);
    expect(await sessionState(env, bad.email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 });
    const maxExpiry = Math.max(...[a, b, p, e, c].map(x => x.data.session!.expires_at!));
    const proactiveWait = (p.data.session!.expires_at! - 80) * 1000 - Date.now(); expect(proactiveWait).toBeGreaterThan(0); expect(proactiveWait).toBeLessThan(45000);
    await new Promise(yes => setTimeout(yes, proactiveWait)); // One bounded genuine claims-based wait; no fake clock or timestamp edit.
    events.length = 0; calls.length = 0;
    const early = proactive.auth.signOut(); pending.push(early);
    try {
      await arrivals.get('proactive'); expect(Date.now()).toBeLessThan(p.data.session!.expires_at! * 1000);
      expect(calls.filter(x => x.label === 'proactive')).toEqual([{ label: 'proactive', path: '/auth/v1/token?refresh_token', status: 400 }]);
      expect(JSON.parse(stores.get('proactive')!.get('proactive')!).access_token).toBe(p.data.session!.access_token);
      expect(events.filter(x => x.label === 'proactive')).toEqual([]);
    } finally { releases.get('proactive')!(); }
    expect((await early).error).toBeNull();
    // SDK ignores this genuine403. It is local sign-out success, NOT a server revocation receipt.
    expect(calls.filter(x => x.label === 'proactive').map(x => x.status)).toEqual([400, 403]);
    expect(stores.get('proactive')!.has('proactive')).toBe(false); expect(events.filter(x => x.label === 'proactive').map(x => x.event)).toEqual(['SIGNED_OUT']);
    const expiredWait = (maxExpiry + 61) * 1000 - Date.now(); expect(expiredWait).toBeGreaterThan(0); expect(expiredWait).toBeLessThan(150000);
    await new Promise(yes => setTimeout(yes, expiredWait));
    expect((await raw('/rest/v1/todos?select=*', a.data.session!.access_token)).status).toBe(401);
    events.length = 0; calls.length = 0;
    const logout = first.auth.signOut(); pending.push(logout);
    try {
      await arrivals.get('good');
      const installed = JSON.parse(stores.get('good')!.get('good')!); expect(installed.access_token).not.toBe(a.data.session!.access_token);
      expect(installed.expires_at * 1000).toBeGreaterThan(Date.now());
      expect(events.filter(x => x.label === 'good')).toEqual([{ label: 'good', event: 'TOKEN_REFRESHED', token: installed.access_token }]);
      expect(calls.filter(x => x.label === 'good')).toEqual([{ label: 'good', path: '/auth/v1/token?refresh_token', status: 200 }]);
      expect(await sessionState(env, good.email)).toMatchObject({ sessions: 2, activeRefreshTokens: 2 });
    } finally { releases.get('good')!(); }
    expect((await logout).error).toBeNull(); expect(events.filter(x => x.label === 'good').map(x => x.event)).toEqual(['TOKEN_REFRESHED', 'SIGNED_OUT']);
    expect(calls.filter(x => x.label === 'good').map(x => x.status)).toEqual([200, 204]); expect(stores.get('good')!.has('good')).toBe(false);
    const rejected = await expired.auth.signOut(); expect(rejected.error?.status).toBe(400); expect(rejected.error?.code).toBe('refresh_token_not_found');
    expect(calls.filter(x => x.label === 'expired')).toEqual([{ label: 'expired', path: '/auth/v1/token?refresh_token', status: 400 }]);
    expect(stores.get('expired')!.has('expired')).toBe(false); expect(events.filter(x => x.label === 'expired').map(x => x.event)).toEqual(['SIGNED_OUT']);
    expect(await sessionState(env, sibling.email)).toEqual(controlBefore);
    expect(await Promise.all([good, bad, sibling].map(x => account(env, x.email)))).toEqual(accounts);
    expect((await control.auth.refreshSession()).error).toBeNull(); expect(await control.from('todos').select('*').eq('id', rowId)).toEqual(rows);
    await writeFile(resolve(env.directory, 'c08-state-expiry-observations-private.json'), JSON.stringify({ configured120s: true, actualExpiry61s: true, installedBeforeGlobal: true, genuineRefreshedEvent: true, proactiveRefreshStatus: 400, proactiveLogoutStatus: 403, proactiveErrorNullIsNotServerAck: true, expiredRefreshStatus: 400, expiredGlobalRequests: 0, cleanupPending: true }, null, 2) + '\n', { mode: 0o600 });
  }, [
    async () => { for (const release of releases.values()) release(); await Promise.allSettled(pending); for (const s of subscriptions) s.unsubscribe(); },
    async () => { if (!(await control.auth.refreshSession()).error) { expect((await control.from('todos').delete().eq('id', rowId)).error).toBeNull(); expect((await control.from('todos').select('*').eq('id', rowId)).data).toEqual([]); } else throw new Error('Independent owned row cleanup refresh failed'); },
    ...[[good, first], [bad, proactive], [sibling, control]].map(([credentials, client]) => async () => {
      const credential = credentials as typeof good, sdk = client as typeof first;
      if ((await sessionState(env, credential.email)).sessions > 0) { expect((await sdk.auth.signInWithPassword(credential)).error).toBeNull(); expect((await sdk.auth.signOut()).error).toBeNull(); }
    }),
    async () => { for (const credentials of [good, bad, sibling]) expect(await sessionState(env, credentials.email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 }); },
  ]);
}, 240000);
