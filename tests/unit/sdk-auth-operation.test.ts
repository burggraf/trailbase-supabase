import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuth, type AuthOptions, type AuthStorage } from '../../src/auth.js';
import { createClient } from '../../src/index.js';

const base = new URL('http://localhost:4000');
const recordPath = '/api/records/v1/todos';
const deferred = <T>() => Promise.withResolvers<T>();
function settlement(value: unknown) {
  let state: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  const done = Promise.resolve(value).then(() => { state = 'fulfilled'; }, error => { state = 'rejected'; return error as unknown; });
  return { get state() { return state; }, done };
}
function tokens(owner: 'a' | 'b', revision = 1, expires = Math.floor(Date.now() / 1000) + 600) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const sub = Buffer.from(owner === 'a' ? '12345678123442348234123456789abc' : '22345678123442348234123456789abc', 'hex').toString('base64url');
  return { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub, email: `${owner}@example.test`, iat: Math.floor(Date.now() / 1000) - 60, exp: expires, revision })}.signature`, refresh_token: `fixture-${owner}-${revision}`, csrf_token: `fixture-csrf-${revision}` };
}
function fixture(options: AuthOptions = { persistSession: false, autoRefreshToken: false }) {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  let revision = 0, latest = tokens('a');
  const control = { status: async (): Promise<Response> => Response.json(latest), record: async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => Response.json({ records: [] }), refresh: async (): Promise<Response> => { const next = tokens(latest.refresh_token.includes('-a-') ? 'a' : 'b', ++revision); latest = { ...next, refresh_token: latest.refresh_token }; return Response.json({ auth_token: latest.auth_token, csrf_token: latest.csrf_token }); } };
  const auth = createAuth(base, async (input, init) => {
    const path = new URL(String(input)).pathname; calls.push({ path, init });
    if (path.endsWith('/login')) {
      const body = JSON.parse(String(init?.body));
      if (body.password === 'wrong') return new Response('Rejected', { status: 401 });
      latest = tokens(body.email_or_username.startsWith('b') ? 'b' : 'a', ++revision); return Response.json(latest);
    }
    if (path.endsWith('/refresh')) return control.refresh();
    if (path.endsWith('/status')) return control.status();
    if (path.endsWith('/logout')) return new Response(null, { status: 200 });
    return control.record(input, init);
  }, options);
  const login = (owner: 'a' | 'b' = 'a', password = 'fixture-password') => auth.api.signInWithPassword({ email: `${owner}@example.test`, password });
  return { auth, calls, control, login, credential: () => latest.auth_token };
}
afterEach(() => vi.useRealTimers());

describe('AL01–AL08 internal captured record-operation lifetime; synthetic unit contracts, not real auth proof', () => {
  it('captures one bearer for multiple requests without exposing native credentials', async () => {
    const f = fixture(); expect((await f.login()).error).toBeNull(); const expected = f.credential(), lease = await f.auth.recordOperation();
    try {
      expect(Object.keys(lease).sort()).toEqual(['assertCurrent', 'dispose', 'fetch', 'signal']);
      await lease.fetch(recordPath, { headers: { authorization: 'Bearer other', accept: 'application/json' } });
      await lease.fetch(recordPath + '/owned/file/body');
      for (const call of f.calls.filter(call => call.path.startsWith('/api/records/'))) {
        const headers = new Headers(call.init?.headers); expect(headers.get('authorization')).toBe(`Bearer ${expected}`);
        expect(headers.has('refresh-token')).toBe(false); expect(headers.has('csrf-token')).toBe(false);
        expect(call.init?.credentials).toBe('omit'); expect(call.init?.redirect).toBe('error'); expect(call.init?.signal).toBeInstanceOf(AbortSignal);
      }
      lease.assertCurrent();
    } finally { lease.dispose(); }
  });
  it.each(['https://foreign.invalid/api/records/v1/todos', '//foreign.invalid/api/records/v1/todos', '/api/auth/v1/logout', '/api/records/v1/../../auth/v1/logout'])('rejects out-of-scope path %s before any dispatch', async path => {
    const f = fixture(), lease = await f.auth.recordOperation();
    try { await expect(lease.fetch(path)).rejects.toThrow(); expect(f.calls).toHaveLength(0); }
    finally { lease.dispose(); }
  });
  it('keeps explicit anonymous acquisition anonymous and retires it on login', async () => {
    const f = fixture(), lease = await f.auth.recordOperation();
    try {
      await lease.fetch(recordPath, { headers: { authorization: 'Bearer caller' } }); expect(new Headers(f.calls[0].init?.headers).has('authorization')).toBe(false);
      await f.login(); expect(lease.signal.aborted).toBe(true); expect(() => lease.assertCurrent()).toThrowError(expect.objectContaining({ name: 'AuthStaleOperationError' }));
      await expect(lease.fetch(recordPath)).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(1);
    } finally { lease.dispose(); }
  });
  it.each(['b', 'a'] as const)('successful %s replacement retires the previous lease, including a same-user new session', async owner => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation();
    try {
      await f.login(owner); expect(lease.signal.aborted).toBe(true); expect(() => lease.assertCurrent()).toThrow();
      await expect(lease.fetch(recordPath)).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0);
      const current = await f.auth.recordOperation(); try { await current.fetch(recordPath); expect(new Headers(f.calls.at(-1)?.init?.headers).get('authorization')).toBe(`Bearer ${f.credential()}`); } finally { current.dispose(); }
    } finally { lease.dispose(); }
  });
  it('A→B→A does not revive a retired operation', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation();
    try { await f.login('b'); await f.login('a'); expect(lease.signal.aborted).toBe(true); await expect(lease.fetch(recordPath)).rejects.toThrow(); }
    finally { lease.dispose(); }
  });
  it('failed password replacement preserves the authoritative A lease', async () => {
    const f = fixture(); await f.login(); const bearer = f.credential(), lease = await f.auth.recordOperation();
    try { expect((await f.login('b', 'wrong')).error?.status).toBe(401); expect(lease.signal.aborted).toBe(false); lease.assertCurrent(); await lease.fetch(recordPath); expect(new Headers(f.calls.at(-1)?.init?.headers).get('authorization')).toBe(`Bearer ${bearer}`); }
    finally { lease.dispose(); }
  });
  it('retires synchronously on logout before queued public auth notifications', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), events: string[] = [];
    const subscription = f.auth.api.onAuthStateChange(event => { events.push(event); }).data.subscription; await Promise.resolve(); events.length = 0;
    try { const logout = f.auth.api.signOut({ scope: 'local' }); expect(lease.signal.aborted).toBe(true); expect(events).toEqual([]); expect(() => lease.assertCurrent()).toThrow(); expect((await logout).error).toBeNull(); }
    finally { subscription.unsubscribe(); lease.dispose(); }
  });
  it('preparation captures owner before hydration and cannot adopt B after held storage', async () => {
    const held = deferred<string | null>(), started = deferred<void>(); let saved: string | null = null;
    const storage: AuthStorage = { getItem: () => { started.resolve(); return held.promise; }, setItem: (_key, value) => { saved = value; }, removeItem: () => { saved = null; } };
    const f = fixture({ storage, persistSession: true, autoRefreshToken: false });
    const pending = f.auth.recordOperation(), observed = pending.then(() => 'wrong-success', error => error.name); await started.promise;
    const logout = f.auth.api.signOut({ scope: 'local' }), replacement = f.login('b'); held.resolve(null);
    expect(await observed).toBe('AuthStaleOperationError'); await logout; expect((await replacement).error).toBeNull(); expect(saved).not.toBeNull(); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0);
  });
  it('initial healthy hydration may establish its original owner without an anonymous request', async () => {
    const a = tokens('a'), storage: AuthStorage = { getItem: async () => JSON.stringify({ version: 1, tokens: a }), setItem: () => {}, removeItem: () => {} };
    const f = fixture({ storage, autoRefreshToken: false }), lease = await f.auth.recordOperation();
    try { await lease.fetch(recordPath); expect(new Headers(f.calls.at(-1)?.init?.headers).get('authorization')).toBe(`Bearer ${a.auth_token}`); }
    finally { lease.dispose(); }
  });
  it('same-session renewal preserves owner but does not rebind an already acquired bearer', async () => {
    const f = fixture(); await f.login(); const bearer = f.credential(), lease = await f.auth.recordOperation();
    try { expect((await f.auth.api.refreshSession()).error).toBeNull(); expect(f.credential()).not.toBe(bearer); expect(lease.signal.aborted).toBe(false); await lease.fetch(recordPath); expect(new Headers(f.calls.at(-1)?.init?.headers).get('authorization')).toBe(`Bearer ${bearer}`); }
    finally { lease.dispose(); }
  });
  it('acquisition joins readiness renewal but cannot adopt a different committed owner', async () => {
    const f = fixture(); await f.login(); const held = deferred<Response>(), entered = deferred<void>();
    f.control.refresh = () => { entered.resolve(); return held.promise; };
    const renewal = f.auth.api.refreshSession(); await entered.promise;
    const pending = f.auth.recordOperation(), observed = pending.then(() => 'wrong-success', error => error.name);
    await f.login('b'); held.resolve(Response.json({ auth_token: tokens('a', 99).auth_token, csrf_token: 'fixture-csrf' }));
    expect((await renewal).error).not.toBeNull(); expect(await observed).toBe('AuthStaleOperationError'); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0);
  });
  it('same-owner refresh401 terminates leases after failed B advances generation, without changing cached public auth', async () => {
    const f = fixture(); await f.login(); const original = (await f.auth.api.getSession()).data.session!, lease = await f.auth.recordOperation(), held = deferred<Response>(), entered = deferred<void>();
    f.control.refresh = () => { entered.resolve(); return held.promise; }; const renewal = f.auth.api.refreshSession(); await entered.promise;
    try {
      expect((await f.login('b', 'wrong')).error?.status).toBe(401); expect(lease.signal.aborted).toBe(false);
      held.resolve(new Response('Rejected', { status: 401 })); expect((await renewal).error?.name).toBe('AuthStaleOperationError');
      expect((await f.auth.api.getSession()).data.session).toEqual(original); // Preserve existing public stale-result semantics.
      expect(lease.signal.aborted).toBe(true); expect(() => lease.assertCurrent()).toThrow();
      await expect(f.auth.recordOperation()).rejects.toHaveProperty('name', 'AuthStaleOperationError');
      await expect(lease.fetch(recordPath)).rejects.toThrow(); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0);
      expect((await f.login('a')).error).toBeNull(); const next = await f.auth.recordOperation(); try { next.assertCurrent(); } finally { next.dispose(); }
    } finally { held.resolve(new Response(null, { status: 401 })); await renewal; lease.dispose(); }
  });
  it('same-session status rotation cannot hide a native refresh401 from its still-current operation owner', async () => {
    const f = fixture(); await f.login(); const original = (await f.auth.api.getSession()).data.session!, lease = await f.auth.recordOperation();
    const statusHeld = deferred<Response>(), statusEntered = deferred<void>(), refreshHeld = deferred<Response>(), refreshEntered = deferred<void>();
    f.control.status = () => { statusEntered.resolve(); return statusHeld.promise; }; const status = f.auth.api.getUser(); await statusEntered.promise;
    f.control.refresh = () => { refreshEntered.resolve(); return refreshHeld.promise; }; const renewal = f.auth.api.refreshSession(); await refreshEntered.promise;
    try {
      const rotated = { ...tokens('a', 99), refresh_token: original.refresh_token }; statusHeld.resolve(Response.json(rotated)); expect((await status).error).toBeNull(); expect(lease.signal.aborted).toBe(false);
      refreshHeld.resolve(new Response('Rejected', { status: 401 })); expect((await renewal).error?.name).toBe('AuthStaleOperationError');
      expect((await f.auth.api.getSession()).data.session!.access_token).toBe(rotated.auth_token);
      expect(lease.signal.aborted).toBe(true); await expect(f.auth.recordOperation()).rejects.toHaveProperty('name', 'AuthStaleOperationError');
      await expect(lease.fetch(recordPath)).rejects.toThrow(); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0);
    } finally { statusHeld.resolve(Response.json({ ...tokens('a'), refresh_token: original.refresh_token })); refreshHeld.resolve(new Response(null, { status: 401 })); await Promise.all([status, renewal]); lease.dispose(); }
  });
  it.each([{ label: 'B', owners: ['b'] }, { label: 'B→new A', owners: ['b', 'a'] }] as const)('stale A401 never terminates a committed replacement owner $label', async ({ owners }) => {
    const f = fixture(); await f.login(); const old = await f.auth.recordOperation(), held = deferred<Response>(), entered = deferred<void>();
    f.control.refresh = () => { entered.resolve(); return held.promise; }; const renewal = f.auth.api.refreshSession(); await entered.promise;
    try {
      for (const owner of owners) expect((await f.login(owner)).error).toBeNull(); const current = await f.auth.recordOperation();
      try { held.resolve(new Response('Rejected', { status: 401 })); expect((await renewal).error?.name).toBe('AuthStaleOperationError'); expect(old.signal.aborted).toBe(true); expect(current.signal.aborted).toBe(false); current.assertCurrent(); }
      finally { current.dispose(); }
    } finally { held.resolve(new Response(null, { status: 401 })); await renewal; old.dispose(); }
  });
  it('terminal refresh401 retires existing operations, not just public notifications', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(); f.control.refresh = async () => new Response('Rejected', { status: 401 });
    try { expect((await f.auth.api.refreshSession()).error?.status).toBe(401); expect(lease.signal.aborted).toBe(true); await expect(lease.fetch(recordPath)).rejects.toHaveProperty('name', 'AuthStaleOperationError'); }
    finally { lease.dispose(); }
  });
  it('failed persistence with successful compensation preserves old operation ownership', async () => {
    let saved: string | null = null, failNext = false;
    const storage: AuthStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; if (failNext) { failNext = false; throw Error('private-write'); } }, removeItem: () => { saved = null; } };
    const f = fixture({ storage, autoRefreshToken: false }); await f.login(); const lease = await f.auth.recordOperation(), original = saved; failNext = true;
    try { expect((await f.login('b')).error?.name).toBe('AuthStorageWriteError'); expect(saved).toBe(original); expect(lease.signal.aborted).toBe(false); lease.assertCurrent(); await lease.fetch(recordPath); }
    finally { lease.dispose(); }
  });
  it('a storage restoration latch synchronously retires prior operations and blocks new ones', async () => {
    let saved: string | null = null, failing = false;
    const storage: AuthStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; if (failing) throw Error('private-storage'); }, removeItem: () => { saved = null; } };
    const f = fixture({ storage, autoRefreshToken: false }); await f.login(); const lease = await f.auth.recordOperation(); failing = true;
    try { expect((await f.login('b')).error?.name).toBe('AuthStorageRestoreError'); expect(lease.signal.aborted).toBe(true); await expect(f.auth.recordOperation()).rejects.toHaveProperty('name', 'AuthStorageRestoreError'); await expect(lease.fetch(recordPath)).rejects.toThrow(); }
    finally { lease.dispose(); }
  });
  it('rejects a late Fetch response after retirement and cancels only its owned body', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), held = deferred<Response>(), entered = deferred<void>(), cancel = vi.fn();
    f.control.record = () => { entered.resolve(); return held.promise; }; const pending = lease.fetch(recordPath), observed = pending.then(() => 'wrong-success', error => error.name); await entered.promise;
    try { await f.login('b'); held.resolve(new Response(new ReadableStream({ cancel }))); expect(await observed).toBe('AuthStaleOperationError'); expect(cancel).toHaveBeenCalledTimes(1); }
    finally { lease.dispose(); }
  });
  it('requires an explicit post-body assertion and prevents a cross-owner follow-up without replay', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation();
    try { const response = await lease.fetch(recordPath); await f.login('b'); await response.json(); expect(() => lease.assertCurrent()).toThrow(); await expect(lease.fetch(recordPath + '/owned/file/body')).rejects.toThrow(); expect(f.calls.filter(c => c.path.startsWith('/api/records/'))).toHaveLength(1); }
    finally { lease.dispose(); }
  });
  it('composes caller abort without retiring an independent operation', async () => {
    const f = fixture(); await f.login(); const first = await f.auth.recordOperation(), other = await f.auth.recordOperation(), caller = new AbortController();
    f.control.record = async (_input, init) => { expect(init?.signal?.aborted).toBe(true); throw new DOMException('Aborted', 'AbortError'); }; caller.abort();
    try { await expect(first.fetch(recordPath, { signal: caller.signal })).rejects.toThrow(); expect(first.signal.aborted).toBe(false); expect(other.signal.aborted).toBe(false); other.assertCurrent(); }
    finally { first.dispose(); other.dispose(); }
  });
  it('post-dispatch caller abort rejects an abort-ignoring late response and initiates cancellation without retiring a peer', async () => {
    const f = fixture(); await f.login(); const first = await f.auth.recordOperation(), other = await f.auth.recordOperation(), caller = new AbortController();
    const entered = deferred<AbortSignal>(), held = deferred<Response>(), finishCancel = deferred<void>(); let requests = 0, cancelSettled = false;
    const cancel = vi.fn(() => finishCancel.promise.then(() => { cancelSettled = true; }));
    f.control.record = async (_input, init) => { if (++requests === 1) { entered.resolve(init!.signal!); return held.promise; } return Response.json({ records: [] }); };
    const pending = first.fetch(recordPath, { signal: caller.signal }), observed = pending.then(() => 'wrong-success', error => error.name);
    try {
      const dispatchedSignal = await entered.promise; expect(dispatchedSignal.aborted).toBe(false); expect(requests).toBe(1);
      caller.abort(); expect(dispatchedSignal.aborted).toBe(true); expect(first.signal.aborted).toBe(false); other.assertCurrent();
      const healthy = await other.fetch(recordPath); expect(await healthy.json()).toEqual({ records: [] }); other.assertCurrent();
      held.resolve(new Response(new ReadableStream({ cancel })));
      expect(await observed).toBe('AbortError'); expect(cancel).toHaveBeenCalledTimes(1); expect(cancelSettled).toBe(false); // Current contract initiates, not awaits, late-body cancellation.
      expect(requests).toBe(2); expect(other.signal.aborted).toBe(false); other.assertCurrent();
    } finally { held.resolve(new Response(null)); finishCancel.resolve(); await observed; await finishCancel.promise; first.dispose(); other.dispose(); }
  });
  it.each(['replacement', 'expiry'] as const)('post-decode fencing rejects body/EOF held across captured-owner %s without delivery or follow-up', async retirement => {
    if (retirement === 'expiry') vi.useFakeTimers();
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), reading = deferred<void>(), eof = deferred<void>(), deliveries: unknown[] = [];
    let pulling = false, decoded = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"records":[')); },
      async pull(controller) { if (pulling) return; pulling = true; reading.resolve(); await eof.promise; controller.enqueue(new TextEncoder().encode('{"id":"synthetic-held"}]}')); controller.close(); },
    });
    f.control.record = async () => new Response(body);
    const response = await lease.fetch(recordPath);
    const pending = (async () => { const parsed: unknown = await response.json(); decoded = true; lease.assertCurrent(); deliveries.push(parsed); await lease.fetch(recordPath + '/owned/follow-up'); })();
    const observed = pending.then(() => 'wrong-success', error => error.name);
    let current: Awaited<ReturnType<typeof f.auth.recordOperation>> | undefined;
    try {
      await reading.promise; expect(decoded).toBe(false); lease.assertCurrent();
      if (retirement === 'replacement') expect((await f.login('b')).error).toBeNull(); else await vi.advanceTimersByTimeAsync(600000);
      expect(lease.signal.aborted).toBe(true); expect(decoded).toBe(false); eof.resolve();
      expect(await observed).toBe('AuthStaleOperationError'); expect(decoded).toBe(true); expect(deliveries).toEqual([]);
      await expect(lease.fetch(recordPath + '/owned/follow-up')).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(f.calls.filter(c => c.path.startsWith('/api/records/'))).toHaveLength(1);
      f.control.record = async () => Response.json({ records: [] }); current = await f.auth.recordOperation(); const healthy = await current.fetch(recordPath); expect(await healthy.json()).toEqual({ records: [] }); current.assertCurrent();
    } finally { eof.resolve(); await observed; lease.dispose(); current?.dispose(); }
  });
  it('owned-cleanup disposal seals synchronously and returns one reentrancy-stable receipt', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), peer = await f.auth.recordOperation(); let reentrant: unknown;
    lease.signal.addEventListener('abort', () => { reentrant = lease.dispose(); }, { once: true });
    try {
      const receipt = lease.dispose(); expect(lease.signal.aborted).toBe(true); expect(receipt).toBeInstanceOf(Promise); expect(reentrant).toBe(receipt); expect(lease.dispose()).toBe(receipt);
      await receipt; await expect(lease.fetch(recordPath)).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0); peer.assertCurrent();
    } finally { await Promise.resolve(lease.dispose()).catch(() => {}); await Promise.resolve(peer.dispose()).catch(() => {}); }
  });
  it('owned-cleanup receipt waits for abort-ignoring fetch and its late pending body cancellation', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), entered = deferred<void>(), held = deferred<Response>(), cancelStarted = deferred<void>(), finishCancel = deferred<void>(); let reentrant: unknown;
    f.control.record = () => { entered.resolve(); return held.promise; }; const pending = lease.fetch(recordPath), observed = pending.then(() => 'wrong-success', e => e.name); await entered.promise;
    const receipt = lease.dispose(), closing = settlement(receipt);
    try {
      expect(receipt).toBeInstanceOf(Promise); await Promise.resolve(); expect(closing.state).toBe('pending');
      held.resolve(new Response(new ReadableStream({ cancel() { reentrant = lease.dispose(); cancelStarted.resolve(); return finishCancel.promise; } })));
      expect(await observed).toBe('AuthStaleOperationError'); await cancelStarted.promise; expect(reentrant).toBe(receipt); expect(closing.state).toBe('pending');
      finishCancel.resolve(); await receipt; expect(closing.state).toBe('fulfilled'); expect(lease.dispose()).toBe(receipt);
    } finally { held.resolve(new Response(null)); finishCancel.resolve(); await observed; await closing.done; await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it('owned-cleanup drains all late bodies despite one failure and keeps one sanitized sticky rejection', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), entered = deferred<void>(), held = [deferred<Response>(), deferred<Response>()], secondCancel = deferred<void>(), finishSecond = deferred<void>(); let calls = 0;
    f.control.record = () => { const index = calls++; if (calls === 2) entered.resolve(); return held[index].promise; };
    const requests = [lease.fetch(recordPath), lease.fetch(recordPath)], observed = requests.map(p => p.then(() => 'wrong-success', e => e.name)); await entered.promise;
    const receipt = lease.dispose(), closing = settlement(receipt), cancel = vi.fn(() => { throw Error('SYNTHETIC_PRIVATE_CANCEL'); });
    try {
      expect(receipt).toBeInstanceOf(Promise); held[0].resolve(new Response(new ReadableStream({ cancel })));
      held[1].resolve(new Response(new ReadableStream({ cancel() { secondCancel.resolve(); return finishSecond.promise; } })));
      expect(await Promise.all(observed)).toEqual(['AuthStaleOperationError', 'AuthStaleOperationError']); await secondCancel.promise; expect(cancel).toHaveBeenCalledTimes(1); expect(closing.state).toBe('pending');
      finishSecond.resolve(); const error = await closing.done; expect(error).toMatchObject({ name: 'AuthOperationCleanupError', message: 'Record operation cleanup could not be confirmed' }); expect(error).not.toHaveProperty('cause'); expect(String(error)).not.toContain('SYNTHETIC_PRIVATE');
      expect(lease.dispose()).toBe(receipt); await expect(Promise.resolve(lease.dispose())).rejects.toBe(error);
    } finally { for (const h of held) h.resolve(new Response(null)); finishSecond.resolve(); await Promise.all(observed); await closing.done; await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it.each(['reject', 'throw', 'unconfirmed', 'locked', 'getter'] as const)('owned-cleanup retains %s cancellation failure that precedes disposal without changing caller AbortError', async mode => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), caller = new AbortController(), entered = deferred<void>(), held = deferred<Response>(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    f.control.record = () => { entered.resolve(); return held.promise; }; const pending = lease.fetch(recordPath, { signal: caller.signal }), observed = pending.then(() => 'wrong-success', e => e.name); await entered.promise;
    const response = new Response(new ReadableStream<Uint8Array>()), secret = Error('SYNTHETIC_PRIVATE_CANCEL');
    if (mode === 'locked') reader = response.body!.getReader();
    else if (mode === 'getter') Object.defineProperty(response, 'body', { get() { throw secret; } });
    else Object.defineProperty(response, 'body', { value: { cancel() { if (mode === 'throw') throw secret; if (mode === 'reject') return Promise.reject(secret); return undefined; } } });
    try {
      caller.abort(); held.resolve(response); expect(await observed).toBe('AbortError'); expect(lease.signal.aborted).toBe(false);
      const receipt = lease.dispose(), closing = settlement(receipt); expect(receipt).toBeInstanceOf(Promise); const error = await closing.done;
      expect(error).toMatchObject({ name: 'AuthOperationCleanupError', message: 'Record operation cleanup could not be confirmed' }); expect(String(error)).not.toContain('SYNTHETIC_PRIVATE'); expect(error).not.toHaveProperty('cause'); await expect(Promise.resolve(lease.dispose())).rejects.toBe(error);
    } finally { held.resolve(new Response(null)); await observed; reader?.releaseLock(); await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it('owned-cleanup does not cancel a handed-off body or acknowledge its consumer-owned reader cleanup', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), finishCancel = deferred<void>(), cancel = vi.fn(() => finishCancel.promise);
    f.control.record = async () => new Response(new ReadableStream({ cancel })); const response = await lease.fetch(recordPath), reader = response.body!.getReader();
    try {
      const receipt = lease.dispose(); expect(receipt).toBeInstanceOf(Promise); await receipt; expect(cancel).not.toHaveBeenCalled(); expect(response.body!.locked).toBe(true);
      const consumer = settlement(reader.cancel()); await Promise.resolve(); expect(cancel).toHaveBeenCalledTimes(1); expect(consumer.state).toBe('pending'); finishCancel.resolve(); await consumer.done; reader.releaseLock(); expect(response.body!.locked).toBe(false);
    } finally { finishCancel.resolve(); try { await reader.cancel(); } catch {} reader.releaseLock(); await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it('owned-cleanup remains pending for a hung fetch and a consumer timeout never retroactively becomes ok', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), held = deferred<Response>(), entered = deferred<void>(); f.control.record = () => { entered.resolve(); return held.promise; };
    const pending = lease.fetch(recordPath), observed = pending.then(() => 'wrong-success', e => e.name); await entered.promise;
    const receipt = lease.dispose(), closing = settlement(receipt), bounded = Promise.race([Promise.resolve(receipt).then(() => 'ok', () => 'error'), new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 1000))]);
    try { expect(receipt).toBeInstanceOf(Promise); await vi.advanceTimersByTimeAsync(1000); expect(await bounded).toBe('timeout'); expect(closing.state).toBe('pending'); held.resolve(new Response(null)); expect(await observed).toBe('AuthStaleOperationError'); await receipt; expect(await bounded).toBe('timeout'); }
    finally { held.resolve(new Response(null)); await observed; await closing.done; await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it.each([false, true])('owned-cleanup treats primary transport rejection as settled work, not cleanup failure (retired=%s)', async retired => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), entered = deferred<void>(), failure = deferred<Response>(), primary = Error('Synthetic primary transport failure');
    f.control.record = () => { entered.resolve(); return failure.promise; }; const pending = lease.fetch(recordPath), observed = pending.then(() => undefined, error => error); await entered.promise;
    try {
      const receipt = retired ? lease.dispose() : undefined; failure.reject(primary); const error = await observed;
      if (retired) expect(error).toHaveProperty('name', 'AuthStaleOperationError'); else expect(error).toBe(primary);
      const done = lease.dispose(); expect(done).toBeInstanceOf(Promise); if (retired) expect(done).toBe(receipt); await done;
    } finally { failure.reject(primary); await observed; await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it('owned-cleanup joins successful cancellation already pending before disposal begins', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), caller = new AbortController(), entered = deferred<void>(), held = deferred<Response>(), cancelEntered = deferred<void>(), finishCancel = deferred<void>();
    f.control.record = () => { entered.resolve(); return held.promise; }; const fetching = lease.fetch(recordPath, { signal: caller.signal }), observed = fetching.then(() => 'wrong-success', e => e.name); await entered.promise;
    try {
      caller.abort(); held.resolve(new Response(new ReadableStream({ cancel() { cancelEntered.resolve(); return finishCancel.promise; } }))); await cancelEntered.promise;
      expect(await observed).toBe('AbortError'); expect(lease.signal.aborted).toBe(false);
      const receipt = lease.dispose(), closing = settlement(receipt); expect(receipt).toBeInstanceOf(Promise); await Promise.resolve(); expect(closing.state).toBe('pending');
      finishCancel.resolve(); await receipt; expect(closing.state).toBe('fulfilled'); expect(lease.dispose()).toBe(receipt);
    } finally { held.resolve(new Response(null)); finishCancel.resolve(); await observed; await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it('owned-cleanup failure cannot finish disposal while another accepted fetch is undelivered', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), held = [deferred<Response>(), deferred<Response>()], entered = deferred<void>(), lateCancelEntered = deferred<void>(), finishLateCancel = deferred<void>(); let requests = 0;
    f.control.record = () => { const index = requests++; if (requests === 2) entered.resolve(); return held[index].promise; };
    const observed = [lease.fetch(recordPath), lease.fetch(recordPath)].map(p => p.then(() => 'wrong-success', e => e.name)); await entered.promise;
    const receipt = lease.dispose(), closing = settlement(receipt), cancel = vi.fn(() => Promise.reject(Error('Synthetic failed cancellation')));
    try {
      held[0].resolve(new Response(new ReadableStream({ cancel }))); expect(await observed[0]).toBe('AuthStaleOperationError');
      await new Promise<void>(resolve => setImmediate(resolve)); // Fence the rejection jobs, not a timer/transport poll.
      expect(cancel).toHaveBeenCalledTimes(1); expect(closing.state).toBe('pending'); expect(requests).toBe(2);
      held[1].resolve(new Response(new ReadableStream({ cancel() { lateCancelEntered.resolve(); return finishLateCancel.promise; } })));
      expect(await observed[1]).toBe('AuthStaleOperationError'); await lateCancelEntered.promise; expect(closing.state).toBe('pending');
      finishLateCancel.resolve(); const error = await closing.done; expect(error).toHaveProperty('name', 'AuthOperationCleanupError'); expect(lease.dispose()).toBe(receipt); await expect(receipt).rejects.toBe(error);
    } finally { for (const h of held) h.resolve(new Response(null)); finishLateCancel.resolve(); await Promise.all(observed); await closing.done; await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it('owned-cleanup seals against request-getter reentrancy without dispatch', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(); let receipt: unknown;
    try { await expect(lease.fetch(recordPath, { get method() { receipt = lease.dispose(); return 'GET'; } })).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(receipt).toBeInstanceOf(Promise); expect(lease.dispose()).toBe(receipt); await receipt; expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0); }
    finally { await Promise.resolve(lease.dispose()).catch(() => {}); }
  });
  it('disposes idempotently, clears its timer and leaves another operation active', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.login(); const first = await f.auth.recordOperation(), other = await f.auth.recordOperation();
    expect(vi.getTimerCount()).toBe(2); first.dispose(); first.dispose(); expect(first.signal.aborted).toBe(true); expect(other.signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(1); other.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('locally expires captured credentials without refresh/replay and releases timer resources', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(), calls = f.calls.length;
    try { await vi.advanceTimersByTimeAsync(600000); expect(lease.signal.aborted).toBe(true); expect(() => lease.assertCurrent()).toThrow(); await expect(lease.fetch(recordPath)).rejects.toThrow(); expect(f.calls).toHaveLength(calls); expect(vi.getTimerCount()).toBe(0); }
    finally { lease.dispose(); }
  });
  it('does not dispatch after request-option getters synchronously retire the operation', async () => {
    const f = fixture(); await f.login(); const lease = await f.auth.recordOperation(); let logout: ReturnType<typeof f.auth.api.signOut> | undefined;
    try {
      await expect(lease.fetch(recordPath, { get method() { logout = f.auth.api.signOut({ scope: 'local' }); return 'GET'; } })).rejects.toHaveProperty('name', 'AuthStaleOperationError');
      expect(f.calls.filter(call => call.path === recordPath)).toHaveLength(0);
    } finally { lease.dispose(); await logout; }
  });
  it.each([301, 302, 303, 307, 308])('rejects an unfollowed redirect response %s from a custom Fetch and cancels its body', async status => {
    const f = fixture(), lease = await f.auth.recordOperation(), cancel = vi.fn();
    f.control.record = async () => new Response(new ReadableStream({ cancel }), { status, headers: { location: 'https://foreign.invalid/private' } });
    try { await expect(lease.fetch(recordPath)).rejects.toThrow(TypeError); expect(cancel).toHaveBeenCalledTimes(1); expect(f.calls.filter(call => call.path === recordPath)).toHaveLength(1); }
    finally { lease.dispose(); }
  });
  it('preserves A after the existing identity guard rejects a synthetic foreign-user renewal', async () => {
    const f = fixture(); await f.login(); const bearer = f.credential(), lease = await f.auth.recordOperation(); f.control.refresh = async () => Response.json({ auth_token: tokens('b', 99).auth_token, csrf_token: 'fixture-csrf' });
    try { expect((await f.auth.api.refreshSession()).error?.name).toBe('AuthRefreshIdentityError'); expect(lease.signal.aborted).toBe(false); lease.assertCurrent(); await lease.fetch(recordPath); expect(new Headers(f.calls.at(-1)?.init?.headers).get('authorization')).toBe(`Bearer ${bearer}`); }
    finally { lease.dispose(); }
  });
  it('preserves A after the existing credential guard rejects a synthetic different-refresh-session status', async () => {
    const f = fixture(); await f.login(); const bearer = f.credential(), lease = await f.auth.recordOperation(); f.control.status = async () => Response.json(tokens('a', 99));
    try { expect((await f.auth.api.getUser()).error?.name).toBe('AuthInvalidPayloadError'); expect(lease.signal.aborted).toBe(false); lease.assertCurrent(); await lease.fetch(recordPath); expect(new Headers(f.calls.at(-1)?.init?.headers).get('authorization')).toBe(`Bearer ${bearer}`); }
    finally { lease.dispose(); }
  });
  it('keeps a consistency latch observable after logout removes its owned key; cleanup must not fabricate success', async () => {
    let saved: string | null = null, failing = false;
    const storage: AuthStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; if (failing) throw Error('private-storage'); }, removeItem: () => { saved = null; } };
    const f = fixture({ storage, autoRefreshToken: false }); await f.login(); const lease = await f.auth.recordOperation(); failing = true;
    try {
      expect((await f.login('b')).error?.name).toBe('AuthStorageRestoreError'); expect(lease.signal.aborted).toBe(true);
      expect((await f.auth.api.signOut({ scope: 'local' })).error?.name).toBe('AuthStorageRestoreError'); expect(saved).toBeNull();
      expect(f.calls.filter(call => call.path.endsWith('/logout'))).toHaveLength(1);
      await expect(f.auth.recordOperation()).rejects.toHaveProperty('name', 'AuthStorageRestoreError');
    } finally { lease.dispose(); }
  });
  it('retirement callbacks acquire the already committed B owner, never the retired A owner', async () => {
    const f = fixture(); await f.login(); const old = await f.auth.recordOperation(); let preparing: ReturnType<typeof f.auth.recordOperation> | undefined;
    old.signal.addEventListener('abort', () => { preparing = f.auth.recordOperation(); }, { once: true });
    try {
      expect((await f.login('b')).error).toBeNull(); expect(preparing).toBeDefined(); const current = await preparing!;
      try { current.assertCurrent(); await current.fetch(recordPath); expect(new Headers(f.calls.at(-1)?.init?.headers).get('authorization')).toBe(`Bearer ${f.credential()}`); }
      finally { current.dispose(); }
    } finally { old.dispose(); }
  });
  it('synchronous retirement-callback logout cannot resurrect the just-replaced session', async () => {
    const f = fixture(); await f.login(); const old = await f.auth.recordOperation(); let logout: ReturnType<typeof f.auth.api.signOut> | undefined;
    old.signal.addEventListener('abort', () => { logout = f.auth.api.signOut({ scope: 'local' }); }, { once: true });
    try {
      expect((await f.login('b')).error?.name).toBe('AuthStaleOperationError'); expect(logout).toBeDefined(); expect((await logout!).error).toBeNull();
      expect((await f.auth.api.getSession()).data.session).toBeNull(); expect(old.signal.aborted).toBe(true); await expect(old.fetch(recordPath)).rejects.toHaveProperty('name', 'AuthStaleOperationError'); expect(f.calls.filter(c => c.path === recordPath)).toHaveLength(0);
    } finally { old.dispose(); }
  });
  it('keeps the primitive absent from current public client/auth entrypoints', () => {
    const client = createClient(base.href, undefined, { auth: { persistSession: false, autoRefreshToken: false }, trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } } });
    expect(client).not.toHaveProperty('recordOperation'); expect(client.auth).not.toHaveProperty('recordOperation');
  });
});
