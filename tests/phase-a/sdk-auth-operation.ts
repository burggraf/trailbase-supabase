import { expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAuth } from '../../src/auth.js';
import { context, confirmEmail, deadline, nativeUuid } from './helpers.js';
import { nativeState, deleteNativeOwner, identity, type Owner } from '../auth-negative/helpers.js';
import { authOperationWithCleanup } from '../proofs/auth-operation-diagnostics.js';
import { withCleanup } from '../sdk-browser/cleanup.js';

// This imports the existing internal auth module, not a new public SDK or test-only runtime seam.
export async function realRecordOperationContract() {
  const env = await context(), before = nativeState(env), ids = [randomUUID(), randomUUID()];
  const owners: Owner[] = ['a', 'b'].map(label => ({ ...identity(env, `al-${label}`), rowId: ids[label === 'a' ? 0 : 1] }));
  const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const responseGate = () => ({ arrived: Promise.withResolvers<number>(), release: Promise.withResolvers<void>() });
  let refreshGate: ReturnType<typeof responseGate> | undefined, statusGate: ReturnType<typeof responseGate> | undefined;
  let hold = false, loseLogout = false, scenarioComplete = false, recordCalls = 0, capturedBearer: string | null = null;
  const auth = createAuth(new URL(env.trailUrl), async (input, init) => {
    const url = new URL(String(input)), isRecord = url.pathname.startsWith('/api/records/');
    if (isRecord) { recordCalls++; capturedBearer = new Headers(init?.headers).get('authorization'); }
    const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
    const gate = url.pathname.endsWith('/refresh') ? refreshGate : url.pathname.endsWith('/status') ? statusGate : undefined;
    if (gate) { gate.arrived.resolve(response.status); await deadline(gate.release.promise); } // Original genuine response, never rewritten.
    if (loseLogout && url.pathname.endsWith('/logout')) { expect(response.status).toBe(200); await response.body?.cancel(); throw new TypeError('Injected loss after genuine native logout response'); }
    if (hold && isRecord && init?.method === 'PATCH') {
      hold = false; expect(response.status).toBe(200); held.resolve();
      await deadline(release.promise); // Hold the original response only after the actual backend has executed.
    }
    return response;
  }, { persistSession: false, autoRefreshToken: false });
  const leases: Awaited<ReturnType<typeof auth.recordOperation>>[] = [];
  const acquire = async () => { const lease = await auth.recordOperation(); leases.push(lease); return lease; };
  const login = (owner: Owner, password = owner.password) => auth.api.signInWithPassword({ email: owner.email, password });
  const rowsPath = '/api/records/v1/todos';
  await authOperationWithCleanup(env, 'native', async () => {
    for (const owner of owners) {
      expect((await auth.api.signUp({ email: owner.email, password: owner.password })).error).toBeNull();
      await confirmEmail(env, owner.email); const signed = await login(owner); expect(signed.error).toBeNull(); owner.id = signed.data.user!.id;
      const lease = await acquire(), response = await lease.fetch(rowsPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: nativeUuid(owner.rowId!), user_id: nativeUuid(owner.id), title: `AL-${owner.rowId}`, completed: 0 }) });
      expect(response.status).toBe(200); expect((await response.json()).ids).toEqual([nativeUuid(owner.rowId!)]); lease.assertCurrent(); await lease.dispose();
    }
    const a = await login(owners[0]); expect(a.error).toBeNull();
    const first = await acquire(), afterSetup = nativeState(env), oldCalls = recordCalls;
    hold = true;
    const pending = first.fetch(`${rowsPath}/${encodeURIComponent(nativeUuid(ids[0]))}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: 1 }) });
    const observed = pending.then(() => 'wrong-success', error => error.name);
    await deadline(held.promise); expect(capturedBearer).toBe(`Bearer ${a.data.session!.access_token}`);
    const committed = nativeState(env), ownA = Buffer.from(nativeUuid(owners[0].id!), 'base64url');
    expect(committed.users).toEqual(afterSetup.users); expect(committed.sessions).toEqual(afterSetup.sessions);
    expect(committed.todos).toEqual(afterSetup.todos.map(row => Buffer.from(row.id as Uint8Array).equals(Buffer.from(nativeUuid(ids[0]), 'base64url')) ? { ...row, completed: 1n } : row));
    expect(committed.audit.slice(0, afterSetup.audit.length)).toEqual(afterSetup.audit);
    expect(committed.audit.slice(afterSetup.audit.length).map(row => ({ todo_id: Buffer.from(row.todo_id as Uint8Array), user_id: Buffer.from(row.user_id as Uint8Array), operation: row.operation }))).toEqual([{ todo_id: Buffer.from(nativeUuid(ids[0]), 'base64url'), user_id: ownA, operation: 'UPDATE' }]);
    const b = await login(owners[1]); expect(b.error).toBeNull(); expect(first.signal.aborted).toBe(true);
    const afterB = nativeState(env);
    expect(afterB.users).toEqual(committed.users); expect(afterB.todos).toEqual(committed.todos); expect(afterB.audit).toEqual(committed.audit);
    expect(afterB.sessions.filter(row => row.refresh_token !== b.data.session!.refresh_token)).toEqual(committed.sessions);
    expect(afterB.sessions.filter(row => row.refresh_token === b.data.session!.refresh_token)).toHaveLength(1);
    release.resolve(); expect(await deadline(observed)).toBe('AuthStaleOperationError');
    await expect(first.fetch(rowsPath)).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(recordCalls - oldCalls).toBe(1);
    expect(nativeState(env)).toEqual(afterB); // The accepted A write is neither rolled back nor replayed after replacement.

    const current = await acquire();
    const controlResponse = await current.fetch(`${rowsPath}/${encodeURIComponent(nativeUuid(ids[1]))}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: 1 }) });
    expect(controlResponse.status).toBe(200); await controlResponse.body?.cancel(); current.assertCurrent();
    const response = await current.fetch(`${rowsPath}?filter[id]=${encodeURIComponent(nativeUuid(ids[1]))}`);
    expect(response.status).toBe(200); const body = await response.json(); current.assertCurrent(); expect(body.records).toHaveLength(1); expect(body.records[0].user_id).toBe(nativeUuid(owners[1].id!)); expect(body.records[0].completed).toBe(1);
    const beforeFailed = nativeState(env); expect((await login(owners[0], 'Incorrect-password')).error?.status).toBe(401);
    current.assertCurrent(); expect(current.signal.aborted).toBe(false); expect(nativeState(env)).toEqual(beforeFailed);
    const beforeRefresh = (await auth.api.getSession()).data.session!, iat = JSON.parse(Buffer.from(beforeRefresh.access_token.split('.')[1], 'base64url').toString('utf8')).iat;
    expect(Number.isSafeInteger(iat)).toBe(true); expect(iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    const remaining = (iat + 1) * 1000 - Date.now(); if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining + 10));
    const refreshed = await auth.api.refreshSession(); expect(refreshed.error).toBeNull(); expect(refreshed.data.session!.access_token).not.toBe(beforeRefresh.access_token);
    current.assertCurrent(); expect(current.signal.aborted).toBe(false);
    const fixed = await current.fetch(rowsPath); expect(fixed.status).toBe(200); await fixed.json(); current.assertCurrent(); expect(capturedBearer).toBe(`Bearer ${b.data.session!.access_token}`);
    expect((await auth.api.getSession()).data.session!.refresh_token).toBe(beforeRefresh.refresh_token);
    expect(nativeState(env)).toEqual(beforeFailed);

    // Real parsed bytes can finish after replacement; only the explicit post-body assertion prevents stale delivery.
    const originalJson = await (await current.fetch(`${rowsPath}?filter[id]=${encodeURIComponent(nativeUuid(ids[1]))}`)).json();
    expect(originalJson.records).toHaveLength(1);
    const sameUser = await login(owners[1]); expect(sameUser.error).toBeNull(); expect(sameUser.data.session!.refresh_token).not.toBe(beforeRefresh.refresh_token);
    expect(() => current.assertCurrent()).toThrowError(expect.objectContaining({ name: 'AuthStaleOperationError' }));
    const last = await acquire(), events: string[] = [];
    const sub = auth.api.onAuthStateChange(event => { events.push(event); }).data.subscription;
    try {
      await Promise.resolve(); events.length = 0; const prior = nativeState(env); loseLogout = true; const logout = auth.api.signOut({ scope: 'local' });
      expect(last.signal.aborted).toBe(true); expect(events).toEqual([]); expect(() => last.assertCurrent()).toThrow();
      expect((await logout).error?.name).toBe('AuthSignOutRequestError'); const afterLogout = nativeState(env);
      expect(afterLogout.users).toEqual(prior.users); expect(afterLogout.todos).toEqual(prior.todos); expect(afterLogout.audit).toEqual(prior.audit);
      expect(afterLogout.sessions).toEqual(prior.sessions.filter(row => row.refresh_token !== sameUser.data.session!.refresh_token));
      const remote = await fetch(`${env.trailUrl}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: sameUser.data.session!.refresh_token }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      expect(remote.status).toBe(401); await remote.body?.cancel();
    } finally { sub.unsubscribe(); }

    // Exercise the new same-owner401 fence and both replacement-owner negatives
    // with genuine native responses and DB postconditions, not synthetic401s.
    loseLogout = false;
    for (const mode of ['failed-b', 'status', 'b', 'b-a'] as const) {
      const signed = await login(owners[0]); expect(signed.error).toBeNull(); const session = signed.data.session!, old = await acquire();
      expect(session.expires_at - Date.now() / 1000).toBeGreaterThan(120); // Expiry must not explain retirement.
      const events: string[] = [], subscription = auth.api.onAuthStateChange(event => { events.push(event); }).data.subscription;
      let renewal: ReturnType<typeof auth.api.refreshSession> | undefined, status: ReturnType<typeof auth.api.getUser> | undefined;
      await withCleanup(async () => {
        if (mode === 'status') { statusGate = responseGate(); status = auth.api.getUser(); expect(await deadline(statusGate.arrived.promise)).toBe(200); }
        const beforeRevoke = nativeState(env); expect(beforeRevoke.sessions.filter(row => row.refresh_token === session.refresh_token)).toHaveLength(1);
        const revoked = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
        expect(revoked.status).toBe(200); await revoked.body?.cancel(); const rejected = nativeState(env);
        expect(rejected).toEqual({ ...beforeRevoke, sessions: beforeRevoke.sessions.filter(row => row.refresh_token !== session.refresh_token) });
        refreshGate = responseGate(); renewal = auth.api.refreshSession(); expect(await deadline(refreshGate.arrived.promise)).toBe(401);
        let expectedSession = session;
        if (mode === 'failed-b') { expect((await login(owners[1], 'Incorrect-password')).error?.status).toBe(401); expect(nativeState(env)).toEqual(rejected); }
        else if (mode === 'status') { statusGate!.release.resolve(); expect((await status!).error).toBeNull(); expect(nativeState(env)).toEqual(rejected); }
        else {
          const replacement = await login(owners[1]); expect(replacement.error).toBeNull(); expectedSession = replacement.data.session!;
          if (mode === 'b-a') { const nextA = await login(owners[0]); expect(nextA.error).toBeNull(); expectedSession = nextA.data.session!; expect(expectedSession.refresh_token).not.toBe(session.refresh_token); }
        }
        const sameOwner = mode === 'failed-b' || mode === 'status'; expect(old.signal.aborted).toBe(!sameOwner);
        const fresh = sameOwner ? undefined : await acquire(), priorResponse = nativeState(env), callsBefore = recordCalls;
        await Promise.resolve(); const priorEvents = [...events]; refreshGate.release.resolve();
        expect((await renewal).error?.name).toBe('AuthStaleOperationError'); expect(events).toEqual(priorEvents); expect(nativeState(env)).toEqual(priorResponse);
        expect(old.signal.aborted, `AL assertion: genuine401 retires old lease ${mode}`).toBe(true); expect(() => old.assertCurrent()).toThrow();
        await expect(old.fetch(rowsPath)).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(recordCalls).toBe(callsBefore);
        const cached = (await auth.api.getSession()).data.session!;
        if (mode === 'status') { expect(cached.user).toEqual(session.user); expect(cached.refresh_token).toBe(session.refresh_token); }
        else expect(cached).toEqual(expectedSession); // Preserve existing public stale-result semantics.
        if (sameOwner) await expect(acquire()).rejects.toHaveProperty('name', 'AuthStaleOperationError');
        else {
          fresh!.assertCurrent(); expect(fresh!.signal.aborted).toBe(false); const healthy = await fresh!.fetch(rowsPath);
          expect(healthy.status).toBe(200); const body = await healthy.json(); fresh!.assertCurrent(); const currentOwner = owners[mode === 'b' ? 1 : 0];
          expect(body.records).toHaveLength(1); expect(body.records[0]).toMatchObject({ id: nativeUuid(currentOwner.rowId!), user_id: nativeUuid(currentOwner.id!), title: `AL-${currentOwner.rowId}`, completed: 1 });
          expect(capturedBearer).toBe(`Bearer ${expectedSession.access_token}`); expect(nativeState(env)).toEqual(priorResponse);
        }
      }, [
        async () => { refreshGate?.release.resolve(); statusGate?.release.resolve(); await Promise.all([renewal, status]); refreshGate = undefined; statusGate = undefined; },
        async () => { subscription.unsubscribe(); },
      ]);
    }
    scenarioComplete = true;
  }, [
    async () => {
      release.resolve(); refreshGate?.release.resolve(); statusGate?.release.resolve();
      const outcomes = await deadline(Promise.allSettled(leases.map(lease => lease.dispose()))), failures = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'AL owned operation cleanup failed');
    },
    ...owners.map(owner => async () => { await deleteNativeOwner(env, owner); }),
    async () => {
      const after = nativeState(env); expect(after.users).toEqual(before.users); expect(after.sessions).toEqual(before.sessions); expect(after.todos).toEqual(before.todos);
      expect(after.audit.slice(0, before.audit.length)).toEqual(before.audit);
      const additions = after.audit.slice(before.audit.length); if (scenarioComplete) expect(additions).toHaveLength(6);
      expect(additions.every(row => ids.some(id => Buffer.from(row.todo_id as Uint8Array).equals(Buffer.from(nativeUuid(id), 'base64url'))))).toBe(true);
      for (const index of [0, 1]) {
        const own = additions.filter(row => Buffer.from(row.todo_id as Uint8Array).equals(Buffer.from(nativeUuid(ids[index]), 'base64url')));
        for (const row of own) expect(Buffer.from(row.user_id as Uint8Array)).toEqual(Buffer.from(nativeUuid(owners[index].id!), 'base64url'));
        if (scenarioComplete) expect(own.map(row => row.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
        else expect(['', 'INSERT,DELETE', 'INSERT,UPDATE,DELETE']).toContain(own.map(row => row.operation).join(','));
      }
    },
  ]);
}
