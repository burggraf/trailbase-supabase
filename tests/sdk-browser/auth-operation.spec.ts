import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmedTrailUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { nativeState, deleteNativeOwner } from '../auth-negative/helpers.js';
import { cleanupOwnedRows, withCleanup } from './cleanup.js';
import { authOperationWithCleanup } from '../proofs/auth-operation-diagnostics.js';

declare global { interface Window {
  authOperationChecks?: { label: string; passed: boolean; error?: unknown }[];
  authOperationProof?: {
    arm(): Promise<void>; held(): boolean; replace(): Promise<void>; settle(): Promise<string>;
    check(): Promise<string[]>; cleanup(): Promise<void>;
  };
} }

test('L1-16/18/19/24/S07/S08/AL02–AL07 installed internal auth operation fences genuine ownership, storage and delivery', async ({ page }) => {
  const env = await context(), before = nativeState(env), ids = [randomUUID(), randomUUID()];
  const owners: { label: string; email: string; password: string; id: string }[] = [], clients: Awaited<ReturnType<typeof confirmedTrailUser>>['client'][] = [];
  const errors: string[] = []; let scenarioComplete = false;
  page.on('pageerror', () => errors.push('unhandled-browser-error'));
  await authOperationWithCleanup(env, test.info().project.name, async () => {
    for (const [index, label] of ['al-browser-a', 'al-browser-b'].entries()) {
      const user = await confirmedTrailUser(env, label); owners.push({ label, email: user.email, password: user.password, id: canonicalUuid(user.user.id) }); clients.push(user.client);
      await user.client.records('todos').create({ id: nativeUuid(ids[index]), user_id: nativeUuid(owners[index].id), title: `AL-${ids[index]}`, completed: 0 });
    }
    const setup = nativeState(env);
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    await page.evaluate(async ({ base, owners, nativeIds, key }) => {
      const { createAuth }: typeof import('../../src/auth.js') = await import(`${base}/sdk-data/auth.js`);
      const { createClient }: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const checks: { label: string; passed: boolean; error?: unknown }[] = []; window.authOperationChecks = checks;
      const check = (condition: unknown, label: string, error?: unknown) => { checks.push({ label, passed: !!condition, ...(!condition && error !== undefined ? { error } : {}) }); if (!condition) throw new Error(`AL assertion: ${label}`); };
      const bounded = async <T,>(work: PromiseLike<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AL genuine operation deadline')), 10000); })]); }
        finally { clearTimeout(timer); }
      };
      let mode: 'normal' | 'fail-once' | 'fail-always' | 'hold-write' = 'normal', hold = false, isHeld = false, latched = false, release = () => {};
      let holdRefresh = false, releaseRefresh = () => {}, markRefresh = () => {}, releaseWrite = () => {}, markWrite = () => {};
      const pendingOperations: Promise<unknown>[] = [];
      const recordCalls: { method: string; bearer: string | null }[] = [];
      const auth = createAuth(new URL(base), async (input, init) => {
        const record = new URL(String(input)).pathname.startsWith('/api/records/');
        if (record) recordCalls.push({ method: init?.method ?? 'GET', bearer: new Headers(init?.headers).get('authorization') });
        const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
        if (hold && record && init?.method === 'PATCH') {
          hold = false; check(response.status === 200, 'held genuine PATCH accepted');
          await bounded(new Promise<void>(resolve => { release = resolve; isHeld = true; }));
        }
        if (holdRefresh && new URL(String(input)).pathname.endsWith('/refresh')) {
          holdRefresh = false; check(response.status === 200, 'held genuine refresh accepted'); markRefresh();
          await bounded(new Promise<void>(resolve => { releaseRefresh = resolve; }));
        }
        return response; // Original actual response. No successful body/status is fabricated.
      }, { persistSession: true, autoRefreshToken: false, storageKey: key, storage: {
        getItem: k => localStorage.getItem(k), removeItem: k => localStorage.removeItem(k),
        setItem: (k, value) => { localStorage.setItem(k, value); if (mode === 'fail-once') { mode = 'normal'; throw new Error('Injected after-write storage rejection'); } if (mode === 'fail-always') throw new Error('Injected storage consistency failure'); if (mode === 'hold-write') { mode = 'normal'; markWrite(); return new Promise<void>(resolve => { releaseWrite = resolve; }); } },
      } });
      const login = async (index: number, password = owners[index].password) => auth.api.signInWithPassword({ email: owners[index].email, password });
      const firstLogin = await login(0); check(!firstLogin.error, 'ordinary A password login', firstLogin.error);
      const leases: Awaited<ReturnType<typeof auth.recordOperation>>[] = [];
      const acquire = async () => { const lease = await auth.recordOperation(); leases.push(lease); return lease; };
      const first = await acquire(), path = '/api/records/v1/todos'; let observed = Promise.resolve('not-started');
      let hydrationAuth: ReturnType<typeof createAuth> | undefined, releaseHydration = () => {};
      window.authOperationProof = {
        async arm() { hold = true; observed = first.fetch(`${path}/${encodeURIComponent(nativeIds[0])}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: 1 }) }).then(() => 'wrong-success', error => error.name); },
        held: () => isHeld,
        async replace() { check(!(await login(1)).error, 'ordinary B replacement'); check(first.signal.aborted, 'A retired after genuine B commit'); },
        async settle() {
          const count = recordCalls.length; release(); const result = await bounded(observed);
          let followup = ''; try { await first.fetch(path); } catch (error) { followup = (error as Error).name; }
          check(followup === 'AuthStaleOperationError' && recordCalls.length === count, 'no retired follow-up dispatch'); return result;
        },
        async check() {
          const results: string[] = [], current = await acquire(), b = (await auth.api.getSession()).data.session!;
          const patch = await current.fetch(`${path}/${encodeURIComponent(nativeIds[1])}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completed: 1 }) });
          check(patch.status === 200, 'healthy independent B write'); await patch.body?.cancel(); current.assertCurrent();
          const read = await current.fetch(path); check(read.status === 200, 'healthy B read'); const rows = await read.json(); current.assertCurrent();
          check(rows.records.length === 1 && rows.records[0].id === nativeIds[1] && rows.records[0].completed === 1, 'B only sees its own completed row'); results.push('healthy-B');
          check((await login(0, 'Incorrect-password')).error?.status === 401, 'genuine failed replacement'); current.assertCurrent(); results.push('failed-login-preserves-B');
          const claims = JSON.parse(atob(b.access_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
          check(Number.isSafeInteger(claims.iat) && claims.iat <= Math.floor(Date.now() / 1000), 'genuine issued timestamp');
          const untilNextSecond = (claims.iat + 1) * 1000 - Date.now(); if (untilNextSecond > 0) await new Promise(resolve => setTimeout(resolve, untilNextSecond + 10));
          const refreshed = await auth.api.refreshSession(); check(!refreshed.error && refreshed.data.session!.access_token !== b.access_token, 'genuine discriminating same-session renewal', refreshed.error); current.assertCurrent();
          const afterRefresh = await current.fetch(path); await afterRefresh.json(); current.assertCurrent();
          check(recordCalls.at(-1)?.bearer === `Bearer ${b.access_token}`, 'exact captured bearer after renewal'); results.push('refresh-preserves-captured-bearer');
          const savedBody = await (await current.fetch(path)).json(); check(savedBody.records[0].id === nativeIds[1], 'genuine decoded B body');
          check(!(await login(1)).error, 'same-user new password session');
          let stale = ''; try { current.assertCurrent(); } catch (error) { stale = (error as Error).name; }
          check(stale === 'AuthStaleOperationError', 'post-body assertion fences same-user replacement'); results.push('post-body-same-user-retirement');
          check(!(await login(0)).error, 'fresh A for persistence controls'); check(first.signal.aborted, 'A to B to A never revives the first lease'); const a = await acquire(), disk = localStorage.getItem(key);
          mode = 'fail-once'; check((await login(1)).error?.name === 'AuthStorageWriteError', 'real B credentials rejected by synthetic storage failure');
          a.assertCurrent(); check(localStorage.getItem(key) === disk, 'exact genuine A persistence compensation'); results.push('compensation-preserves-A');
          const refreshEntered = new Promise<void>(resolve => { markRefresh = resolve; }); holdRefresh = true;
          const renewal = auth.api.refreshSession(); pendingOperations.push(renewal); await bounded(refreshEntered);
          const preparing = auth.recordOperation().then(async value => { await value.dispose(); return 'wrong-success'; }, error => error.name); pendingOperations.push(preparing);
          check(!(await login(1)).error, 'B replaces A during genuine held refresh'); releaseRefresh();
          check((await renewal).error?.name === 'AuthStaleOperationError' && await bounded(preparing) === 'AuthStaleOperationError', 'preparation never adopts B across renewal'); results.push('held-refresh-capture-rejects-B');
          const writeEntered = new Promise<void>(resolve => { markWrite = resolve; }); mode = 'hold-write';
          const writing = login(0); pendingOperations.push(writing); await bounded(writeEntered);
          const waitingWrite = auth.recordOperation().then(async value => { await value.dispose(); return 'wrong-success'; }, error => error.name); pendingOperations.push(waitingWrite);
          const retiring = auth.api.signOut({ scope: 'local' }); pendingOperations.push(retiring); releaseWrite();
          check((await writing).error?.name === 'AuthStaleOperationError' && !(await retiring).error && await bounded(waitingWrite) === 'AuthStaleOperationError', 'held persistence cannot acquire anonymous or replacement state'); results.push('held-write-logout-retires-preparation');
          const hydrationKey = `${key}-hydrate`; localStorage.setItem(hydrationKey, disk!);
          let resume = (_value: string | null) => {}, started = () => {};
          const entered = new Promise<void>(resolve => { started = resolve; }), heldStorage = new Promise<string | null>(resolve => { resume = resolve; });
          releaseHydration = () => resume(disk);
          hydrationAuth = createAuth(new URL(base), (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }), { autoRefreshToken: false, storageKey: hydrationKey, storage: { getItem: () => { started(); return heldStorage; }, setItem: (k, value) => localStorage.setItem(k, value), removeItem: k => localStorage.removeItem(k) } });
          const waiting = hydrationAuth.recordOperation().then(async value => { await value.dispose(); return 'wrong-success'; }, error => error.name); await entered;
          const signedOut = hydrationAuth.api.signOut({ scope: 'local' }), replacing = hydrationAuth.api.signInWithPassword({ email: owners[1].email, password: owners[1].password });
          resume(disk); check(await bounded(waiting) === 'AuthStaleOperationError', 'held hydration cannot acquire B'); check(!(await signedOut).error && !(await replacing).error, 'healthy replacement after hydration retirement'); results.push('hydration-capture-rejects-replacement');
          check(!(await login(0)).error, 'fresh authoritative A before consistency failure'); const latchLease = await acquire(); check(!latchLease.signal.aborted, 'latch control starts current');
          mode = 'fail-always'; check((await login(1)).error?.name === 'AuthStorageRestoreError', 'real replacement reaches failed synthetic compensation'); latched = true;
          check(latchLease.signal.aborted, 'consistency latch retires A'); let blocked = ''; try { const value = await auth.recordOperation(); await value.dispose(); } catch (error) { blocked = (error as Error).name; }
          check(blocked === 'AuthStorageRestoreError', 'consistency latch blocks new acquisition'); mode = 'normal'; results.push('storage-latch-retires-A');
          const publicClient = createClient(base, undefined, { auth: { persistSession: false, autoRefreshToken: false }, trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } } });
          check(!('recordOperation' in publicClient) && !('recordOperation' in publicClient.auth), 'no public method added'); results.push('public-API-unchanged');
          return results;
        },
        async cleanup() {
          release(); releaseRefresh(); releaseWrite(); releaseHydration(); const failures: unknown[] = [];
          for (const cleanup of [
            async () => {
              const outcomes = await bounded(Promise.allSettled([observed, ...pendingOperations, ...leases.map(lease => lease.dispose())]));
              const rejected = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
              if (rejected.length) throw new AggregateError(rejected, 'AL owned operation cleanup failed');
            },
            async () => {
              mode = 'normal'; const result = await auth.api.signOut({ scope: 'local' });
              check(latched ? result.error?.name === 'AuthStorageRestoreError' && result.error.details === 'primary=AuthStorageWriteError; restoration=AuthStorageRestoreError' : !result.error, 'primary local cleanup preserves the existing latch and exposes remote failures', result.error);
              check(localStorage.getItem(key) === null, 'owned local key removed without healing the latch');
            },
            async () => { if (hydrationAuth) check(!(await hydrationAuth.api.signOut({ scope: 'local' })).error, 'hydration client local cleanup'); },
            async () => { localStorage.removeItem(key); },
            async () => { localStorage.removeItem(`${key}-hydrate`); },
          ]) { try { await cleanup(); } catch (error) { failures.push(error); } }
          if (failures.length) throw new AggregateError(failures, 'AL browser operation cleanup failures');
        },
      };
    }, { base: env.trailUrl, owners, nativeIds: ids.map(nativeUuid), key: `al-${env.id}-${randomUUID()}` });
    await page.evaluate(() => window.authOperationProof!.arm());
    await expect.poll(() => page.evaluate(() => window.authOperationProof!.held())).toBe(true);
    const accepted = nativeState(env);
    expect(accepted.users).toEqual(setup.users); expect(accepted.audit.slice(0, setup.audit.length)).toEqual(setup.audit);
    expect(accepted.todos).toEqual(setup.todos.map(row => Buffer.from(row.id as Uint8Array).equals(Buffer.from(nativeUuid(ids[0]), 'base64url')) ? { ...row, completed: 1n } : row));
    await page.evaluate(() => window.authOperationProof!.replace());
    expect(await page.evaluate(() => window.authOperationProof!.settle())).toBe('AuthStaleOperationError');
    expect(nativeState(env).todos).toEqual(accepted.todos); expect(nativeState(env).audit).toEqual(accepted.audit);
    expect(await page.evaluate(() => window.authOperationProof!.check())).toEqual(['healthy-B', 'failed-login-preserves-B', 'refresh-preserves-captured-bearer', 'post-body-same-user-retirement', 'compensation-preserves-A', 'held-refresh-capture-rejects-B', 'held-write-logout-retires-preparation', 'hydration-capture-rejects-replacement', 'storage-latch-retires-A', 'public-API-unchanged']);
    expect(errors).toEqual([]); scenarioComplete = true;
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(async () => { await window.authOperationProof?.cleanup(); }); },
    async () => { if (!page.isClosed()) await page.close(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
    ...[0, 1].map(index => async () => {
      if (!owners[index]) return;
      await withCleanup(async () => { await cleanupOwnedRows(clients[index].records('todos'), nativeUuid(owners[index].id), [nativeUuid(ids[index])]); }, [async () => { await deleteNativeOwner(env, owners[index]); }]);
    }),
    async () => {
      const after = nativeState(env); expect(after.users).toEqual(before.users); expect(after.sessions).toEqual(before.sessions); expect(after.todos).toEqual(before.todos);
      expect(after.audit.slice(0, before.audit.length)).toEqual(before.audit); const additions = after.audit.slice(before.audit.length); if (scenarioComplete) expect(additions).toHaveLength(6);
      expect(additions.every(row => ids.some(id => Buffer.from(row.todo_id as Uint8Array).equals(Buffer.from(nativeUuid(id), 'base64url'))))).toBe(true);
      for (const [index, id] of ids.entries()) {
        const own = additions.filter(row => Buffer.from(row.todo_id as Uint8Array).equals(Buffer.from(nativeUuid(id), 'base64url')));
        for (const row of own) expect(Buffer.from(row.user_id as Uint8Array)).toEqual(Buffer.from(nativeUuid(owners[index].id), 'base64url'));
        if (scenarioComplete) expect(own.map(row => row.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
        else expect(['', 'INSERT,DELETE', 'INSERT,UPDATE,DELETE']).toContain(own.map(row => row.operation).join(','));
      }
    },
  ], async () => page.isClosed() ? { pageClosed: true } : page.evaluate(() => ({ checks: window.authOperationChecks ?? [], scope: 'private test-only reach and failed normalized auth errors; never publish raw diagnostics' })));
});
