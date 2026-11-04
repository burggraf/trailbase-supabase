import { expect } from 'vitest';
import { createAuth } from '../../src/auth.js';
import { context, confirmEmail, deadline } from '../phase-a/helpers.js';
import { nativeState, deleteNativeOwner, identity } from '../auth-negative/helpers.js';
import { authOperationWithCleanup } from '../proofs/auth-operation-diagnostics.js';

export async function realRecordOperationExpiry() {
  const env = await context(); if (env.nativeAuthProfile !== 'short-native-auth') throw new Error('AL genuine short-native-auth fixture required');
  const before = nativeState(env), owner = identity(env, 'al-expiry');
  let refreshes = 0, records = 0, bearer: string | null = null;
  const auth = createAuth(new URL(env.trailUrl), (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/refresh')) refreshes++;
    if (path.startsWith('/api/records/')) { records++; bearer = new Headers(init?.headers).get('authorization'); }
    return fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
  }, { persistSession: false, autoRefreshToken: false });
  const leases: Awaited<ReturnType<typeof auth.recordOperation>>[] = [];
  const acquire = async () => { const lease = await auth.recordOperation(); leases.push(lease); return lease; };
  await authOperationWithCleanup(env, 'expiry', async () => {
    expect((await auth.api.signUp({ email: owner.email, password: owner.password })).error).toBeNull(); await confirmEmail(env, owner.email);
    const login = await auth.api.signInWithPassword({ email: owner.email, password: owner.password }); expect(login.error).toBeNull(); owner.id = login.data.user!.id;
    const session = login.data.session!; expect(session.expires_in).toBe(3);
    const lease = await acquire(), response = await lease.fetch('/api/records/v1/todos');
    expect(response.status).toBe(200); expect((await response.json()).records).toEqual([]); lease.assertCurrent(); expect(bearer).toBe(`Bearer ${session.access_token}`);
    const snapshot = nativeState(env), oldRecords = records, oldRefreshes = refreshes;
    // Real elapsed time and the genuinely issued JWT deadline, not a rewritten JWT or fake timer.
    if (!lease.signal.aborted) await deadline(new Promise<void>(resolve => lease.signal.addEventListener('abort', () => resolve(), { once: true })), 10000, 'AL captured credential expiry');
    expect(Date.now() / 1000).toBeGreaterThanOrEqual(session.expires_at); expect(lease.signal.aborted).toBe(true);
    await expect(lease.fetch('/api/records/v1/todos')).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(records).toBe(oldRecords); expect(refreshes).toBe(oldRefreshes);
    // Local expiry is not evidence of native denial: observe genuine server rejection independently.
    let denied = false; const limit = Date.now() + 80000;
    while (Date.now() < limit) {
      const probe = await fetch(`${env.trailUrl}/api/records/v1/todos`, { headers: { authorization: `Bearer ${session.access_token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000) });
      const status = probe.status; await probe.body?.cancel();
      if (status === 401 || status === 403) { denied = true; break; }
      expect(status).toBe(200); await new Promise(resolve => setTimeout(resolve, 250));
    }
    expect(denied, 'AL assertion: genuine unrenewed native access eventually denied').toBe(true); expect(nativeState(env)).toEqual(snapshot);
    const renewed = await acquire(); expect(refreshes).toBe(oldRefreshes + 1); expect(lease.signal.aborted).toBe(true);
    const healthy = await renewed.fetch('/api/records/v1/todos'); expect(healthy.status).toBe(200); expect((await healthy.json()).records).toEqual([]); renewed.assertCurrent();
    const current = (await auth.api.getSession()).data.session!; expect(current.refresh_token).toBe(session.refresh_token); expect(current.access_token).not.toBe(session.access_token);
    // Revoke only the genuine owned native refresh session independently, then prove terminal401 retirement.
    const revoked = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: current.refresh_token }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    expect(revoked.status).toBe(200); await revoked.body?.cancel();
    expect((await auth.api.refreshSession()).error?.status).toBe(401); expect(renewed.signal.aborted).toBe(true);
    await expect(renewed.fetch('/api/records/v1/todos')).rejects.toHaveProperty('name', 'AuthStaleOperationError');
    const rejected = nativeState(env); expect(rejected.users).toEqual(snapshot.users); expect(rejected.todos).toEqual(snapshot.todos); expect(rejected.audit).toEqual(snapshot.audit);
    expect(rejected.sessions).toEqual(snapshot.sessions.filter(row => row.refresh_token !== current.refresh_token));
  }, [
    async () => {
      const outcomes = await deadline(Promise.allSettled(leases.map(lease => lease.dispose()))), failures = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'AL owned operation cleanup failed');
    },
    async () => { await deleteNativeOwner(env, owner); },
    async () => { expect(nativeState(env)).toEqual(before); },
  ]);
}
