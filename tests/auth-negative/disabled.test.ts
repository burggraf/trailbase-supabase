import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { negativeContext, load, save, identity, nativeState, request, sdk } from './helpers.js';
import { nativeUuid, supabase } from '../phase-a/helpers.js';
import { authSnapshot, mailCount } from '../auth-reference/helpers.js';

it('L1-15/AN02 disabled reference TOTP enrollment is a distinct422/no-factor/session mutation control', async () => {
  const env = await negativeContext(true), state = await load(env), owner = state.reference!;
  const client = supabase(env), login = await client.auth.signInWithPassword({ email: owner.email, password: owner.password });
  expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(owner.id);
  const session = (await client.auth.getSession()).data.session, before = await authSnapshot(env), native = nativeState(env);
  const denied = await client.auth.mfa.enroll({ factorType: 'totp' });
  expect(denied.data).toBeNull(); expect(denied.error).toMatchObject({ status: 422, code: 'mfa_totp_enroll_not_enabled' });
  expect(await authSnapshot(env)).toEqual(before); expect(nativeState(env)).toEqual(native);
  expect((await client.auth.getSession()).data.session).toEqual(session);
  expect((await client.auth.mfa.listFactors()).data?.all).toEqual([]);
  expect((await client.auth.getUser()).data.user?.id).toBe(owner.id);
  expect((await client.auth.signOut()).error).toBeNull();
});

it('L1-15/L1-18/AN03 genuine native MFA challenge is not an SDK/access/refresh session and preserves empty/good frames', async () => {
  const env = await negativeContext(true), state = await load(env), mfa = state.owners.find(owner => owner.label === 'mfa')!, plain = state.owners.find(owner => owner.label === 'plain')!;
  for (const good of [false, true]) {
    const key = `an-mfa-${randomUUID()}`, stored = new Map([['unrelated', 'keep']]);
    const client = sdk(env, { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } }, key);
    const events: string[] = []; let initial!: () => void; const initialized = new Promise<void>(yes => { initial = yes; });
    const subscription = client.auth.onAuthStateChange(event => { events.push(event); if (event === 'INITIAL_SESSION') initial(); }).data.subscription;
    try {
      await initialized;
      if (good) expect((await client.auth.signInWithPassword({ email: plain.email, password: plain.password })).data.user?.id).toBe(plain.id);
      const session = (await client.auth.getSession()).data.session, disk = [...stored], eventBefore = [...events], complete = nativeState(env), reference = await authSnapshot(env);
      const raw = await request(env, 'login', { email_or_username: mfa.email, password: mfa.password });
      expect(raw.status).toBe(403); expect(raw.redirected).toBe(false);
      const challenge = await raw.json(); expect(Object.keys(challenge)).toEqual(['mfa_token']); expect(challenge.mfa_token).toBeTypeOf('string');
      const deniedBearer = await fetch(`${env.trailUrl}/api/records/v1/todos`, { headers: { authorization: `Bearer ${challenge.mfa_token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      expect([401, 403]).toContain(deniedBearer.status); await deniedBearer.body?.cancel();
      const deniedRefresh = await request(env, 'refresh', { refresh_token: challenge.mfa_token }); expect(deniedRefresh.status).toBe(401); await deniedRefresh.body?.cancel();
      const result = await client.auth.signInWithPassword({ email: mfa.email, password: mfa.password });
      expect(result.data).toEqual({ user: null, session: null }); expect(result.error).toMatchObject({ name: 'AuthMfaUnsupportedError', status: 403 });
      const serialized = JSON.stringify(result);
      for (const secret of [challenge.mfa_token, mfa.totpUri!, mfa.password, mfa.email]) expect(serialized).not.toContain(secret);
      expect((await client.auth.getSession()).data.session).toEqual(session); expect([...stored]).toEqual(disk); expect(events).toEqual(eventBefore);
      expect(nativeState(env)).toEqual(complete); expect(await authSnapshot(env)).toEqual(reference);
      const rows = await client.from('todos').select('*');
      if (good) { expect(rows.error).toBeNull(); expect(rows.data?.map(row => row.id)).toEqual([plain.rowId]); }
      else { expect(rows.data).toBeNull(); expect(rows.error?.status).toBe(403); }
    } finally { subscription.unsubscribe(); }
  }
  expect(nativeState(env).sessions.some(row => row.user instanceof Uint8Array && Buffer.from(row.user).equals(Buffer.from(nativeUuid(mfa.id!), 'base64url')))).toBe(true); // Setup's independently completed real MFA session still exists.
});

it('L1-15/AN04 disabled native registration changes no complete state/mail/frame while existing password login/owner read succeeds', async () => {
  const env = await negativeContext(true), state = await load(env), plain = state.owners.find(owner => owner.label === 'plain')!;
  for (const good of [false, true]) {
    const key = `an-register-${randomUUID()}`, stored = new Map([['unrelated', 'keep']]);
    const client = sdk(env, { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } }, key);
    const events: string[] = []; let initial!: () => void; const initialized = new Promise<void>(yes => { initial = yes; });
    const subscription = client.auth.onAuthStateChange(event => { events.push(event); if (event === 'INITIAL_SESSION') initial(); }).data.subscription;
    try {
      await initialized;
      if (good) { const login = await client.auth.signInWithPassword({ email: plain.email, password: plain.password }); expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(plain.id); }
      const rejected = identity(env, good ? 'node-good' : 'node-empty'); state.rejected.push(rejected); await save(env, state);
      const before = nativeState(env), reference = await authSnapshot(env), session = (await client.auth.getSession()).data.session, disk = [...stored], eventBefore = [...events], mail = await mailCount(env, rejected.email);
      const raw = await request(env, 'register', { email: rejected.email, password: rejected.password, password_repeat: rejected.password });
      expect(raw.status).toBe(403); expect(raw.redirected).toBe(false); await raw.body?.cancel();
      const result = await client.auth.signUp({ email: rejected.email, password: rejected.password });
      expect(result.data).toEqual({ user: null, session: null }); expect(result.error?.status).toBe(403);
      expect(JSON.stringify(result)).not.toContain(rejected.password); expect(JSON.stringify(result)).not.toContain(rejected.email);
      expect(nativeState(env)).toEqual(before); expect(await authSnapshot(env)).toEqual(reference); expect(await mailCount(env, rejected.email)).toBe(mail); expect(mail).toBe(0);
      expect((await client.auth.getSession()).data.session).toEqual(session); expect([...stored]).toEqual(disk); expect(events).toEqual(eventBefore);
      const login = await client.auth.signInWithPassword({ email: plain.email, password: plain.password });
      expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(plain.id);
      const rows = await client.from('todos').select('*'); expect(rows.error).toBeNull(); expect(rows.data?.map(row => row.id)).toEqual([plain.rowId]);
      expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull(); expect(stored.has(key)).toBe(false); expect(stored.get('unrelated')).toBe('keep');
    } finally { subscription.unsubscribe(); }
  }
});
