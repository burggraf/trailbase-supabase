import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertLocalUrl } from '../../scripts/harness.mjs';
import { supabase, verificationLink, type Context } from '../phase-a/helpers.js';
import { identity, referenceContext, sessionState, account } from './helpers.js';
import { withCleanup } from '../sdk-browser/cleanup.js';

const raw = (env: Context, path: string, token: string, init: RequestInit = {}) => fetch(new URL(path, env.supabaseUrl), {
  ...init, redirect: 'error', signal: AbortSignal.timeout(10000),
  headers: { apikey: env.anonKey, 'X-Supabase-Api-Version': '2024-01-01', authorization: `Bearer ${token}`, ...init.headers },
});
async function confirmed(env: Context, label: string) {
  const credentials = identity(label);
  expect((await supabase(env).auth.signUp(credentials)).error).toBeNull();
  let target = await verificationLink(env, credentials.email);
  for (let n = 0; n < 5; n++) {
    assertLocalUrl(target, env.origins);
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    expect([302, 303]).toContain(response.status);
    const location = response.headers.get('location'); expect(location).not.toBeNull();
    const next = new URL(location!, target); assertLocalUrl(next.href, env.origins);
    const access = new URLSearchParams(next.hash.slice(1)).get('access_token');
    if (access) {
      expect((await raw(env, '/auth/v1/logout?scope=local', access, { method: 'POST' })).status).toBe(204);
      expect(await sessionState(env, credentials.email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 });
      return credentials;
    }
    target = next.href;
  }
  throw new Error('Owned genuine confirmation did not deliver its session');
}

// Characterization, not a recommendation to reproduce the reference's replacement-session loss.
// Read actual owned storage while signOut's lock is held; reentrant getSession would join that lock.
for (const stage of ['before-delete', 'after-delete'] as const) {
  for (const replacement of ['same-user', 'different-user'] as const) {
    it(`L1-19/C08-01 reference ${stage} held receipt with ${replacement} login measures replacement clearing and DELETE ordering`, async () => {
      const env = await referenceContext(), owner = await confirmed(env, 'state-owner'), sibling = await confirmed(env, 'state-sibling');
      const key = `reference-state-${randomUUID()}`, values = new Map([['unrelated', 'keep']]), events: Array<{ event: string; id: string | null }> = [];
      let release!: () => void, entered!: () => void, backend = 0, status = 0;
      const gate = new Promise<void>(yes => { release = yes; }), arrival = new Promise<void>(yes => { entered = yes; });
      const client = createClient(env.supabaseUrl, env.anonKey, {
        auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: key, storage: {
          getItem: name => values.get(name) ?? null, setItem: (name, value) => { values.set(name, value); }, removeItem: name => { values.delete(name); },
        } },
        global: { fetch: async (input, init) => {
          const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
          if (path !== '/auth/v1/logout') return fetch(input, init);
          if (stage === 'before-delete') { entered(); await gate; }
          backend++; const response = await fetch(input, init); status = response.status;
          if (stage === 'after-delete') { await response.clone().arrayBuffer(); entered(); await gate; }
          return response; // Hold only genuine response delivery, never fabricate a successful reply.
        } },
      });
      const control = supabase(env), rowId = randomUUID(), delivered = new Map<string, string>();
      let ownerAfterLogin: Awaited<ReturnType<typeof account>>, siblingAfterLogin: Awaited<ReturnType<typeof account>>;
      const subscription = client.auth.onAuthStateChange((event, session) => { events.push({ event, id: session?.user.id ?? null }); }).data.subscription;
      let pending: Promise<{ error: unknown }> | undefined;
      await withCleanup(async () => {
        const a = await client.auth.signInWithPassword(owner), c = await control.auth.signInWithPassword(sibling);
        for (const [credentials, login] of [[owner, a], [sibling, c]] as const) { expect(login.error).toBeNull(); delivered.set(credentials.email, login.data.session!.access_token); }
        expect((await control.from('todos').insert({ id: rowId, user_id: c.data.user!.id, title: `state-${rowId}` })).error).toBeNull();
        const rows = await control.from('todos').select('*').eq('id', rowId); expect(rows.error).toBeNull(); expect(rows.data).toHaveLength(1);
        const ownerBefore = await account(env, owner.email), siblingBefore = await account(env, sibling.email), controlBefore = await sessionState(env, sibling.email);
        events.length = 0; pending = client.auth.signOut();
        try {
          await arrival;
          expect(JSON.parse(values.get(key)!).access_token).toBe(a.data.session!.access_token);
          expect(events).toEqual([]); expect(backend).toBe(stage === 'before-delete' ? 0 : 1);
          expect(await sessionState(env, owner.email)).toMatchObject({ sessions: stage === 'before-delete' ? 1 : 0 });
          const b = await client.auth.signInWithPassword(replacement === 'same-user' ? owner : sibling);
          expect(b.error).toBeNull(); delivered.set(replacement === 'same-user' ? owner.email : sibling.email, b.data.session!.access_token);
          expect(JSON.parse(values.get(key)!).refresh_token).toBe(b.data.session!.refresh_token);
          expect(events).toEqual([{ event: 'SIGNED_IN', id: b.data.user!.id }]);
          // Genuine login updates sign-in metadata. Compare complete post-login fingerprints
          // across logout, and separately preserve identity/password from before replacement.
          ownerAfterLogin = await account(env, owner.email); siblingAfterLogin = await account(env, sibling.email);
          for (const [before, after] of [[ownerBefore, ownerAfterLogin], [siblingBefore, siblingAfterLogin]]) {
            expect(after).toMatchObject({ id: before!.id, email: before!.email, confirmed: before!.confirmed, passwordSha256: before!.passwordSha256 });
          }
        } finally { release(); }
        expect((await pending).error).toBeNull(); expect(status).toBe(204); expect(backend).toBe(1);
        // The measured SDK clears even the replacement's local session after the held old logout.
        expect(values.has(key)).toBe(false); expect(values.get('unrelated')).toBe('keep');
        expect(events.map(item => item.event)).toEqual(['SIGNED_IN', 'SIGNED_OUT']); expect(events.at(-1)?.id).toBeNull();
        expect((await client.auth.getSession()).data.session).toBeNull();
        expect(await sessionState(env, owner.email)).toMatchObject({ sessions: replacement === 'same-user' && stage === 'after-delete' ? 1 : 0 });
        if (replacement === 'same-user') expect(await sessionState(env, sibling.email)).toEqual(controlBefore);
        else expect(await sessionState(env, sibling.email)).toMatchObject({ sessions: 2, activeRefreshTokens: 2 });
        expect(await account(env, owner.email)).toEqual(ownerAfterLogin!); expect(await account(env, sibling.email)).toEqual(siblingAfterLogin!);
        expect(await control.from('todos').select('*').eq('id', rowId)).toEqual(rows);
      }, [
        async () => { release(); if (pending) await pending; subscription.unsubscribe(); },
        async () => { expect((await control.from('todos').delete().eq('id', rowId)).error).toBeNull(); expect((await control.from('todos').select('*').eq('id', rowId)).data).toEqual([]); },
        // Delivered valid JWTs independently recover locally discarded genuine sessions. No SQL repair.
        ...[owner.email, sibling.email].map(email => async () => {
          if ((await sessionState(env, email)).sessions > 0) {
            const access = delivered.get(email); expect(access).toBeDefined();
            expect((await raw(env, '/auth/v1/logout?scope=global', access!, { method: 'POST' })).status).toBe(204);
          }
        }),
        async () => { for (const email of [owner.email, sibling.email]) expect(await sessionState(env, email)).toMatchObject({ sessions: 0, activeRefreshTokens: 0 }); },
      ]);
    }, 60000);
  }
}
