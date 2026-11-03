import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createClient } from '../../src/index.js';

const origin = 'http://localhost:4000';
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function native(exp = Math.floor(Date.now() / 1000) + 600) {
  return { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: 'owned@example.test', iat: exp - 1200, exp })}.signature`, refresh_token: 'fixture-refresh', csrf_token: 'fixture-csrf' };
}
function setup(fetcher: typeof fetch, token = native()) {
  const data = new Map([['owned', JSON.stringify({ version: 1, tokens: token })], ['unrelated', 'keep']]);
  const client = createClient(origin, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: 'owned', storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } } }, global: { fetch: fetcher } });
  return { client, data };
}

it('L1-19/OGL01 default and explicit global send official JSON request and accept only complete genuine-shaped0359 receipt', async () => {
  for (const explicit of [false, true]) {
    let calls = 0; const token = native();
    const { client, data } = setup(async (input, init) => {
      calls++; expect(String(input)).toBe(`${origin}/api/auth/v1/logout`);
      expect(init?.method).toBe('GET'); expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('manual');
      expect([...new Headers(init?.headers)]).toEqual([['authorization', `Bearer ${token.auth_token}`], ['content-type', 'application/json']]);
      const bytes = new TextEncoder().encode('logged out');
      const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      if (explicit) Object.defineProperty(response, 'url', { value: `${origin}/api/auth/v1/logout` });
      return response;
    }, token);
    expect(await (explicit ? client.auth.signOut({ scope: 'global' }) : client.auth.signOut())).toEqual({ error: null });
    expect(calls).toBe(1); expect(data.has('owned')).toBe(false); expect(data.get('unrelated')).toBe('keep');
    expect(await client.auth.getSession()).toEqual({ data: { session: null }, error: null });
    expect(await client.auth.signOut()).toEqual({ error: null }); expect(calls).toBe(1); // Empty-client no-op is not a receipt.
  }
});

it('L1-19/OGL01 request-independent complete receipt200 succeeds under minimum invariant, not server detection', async () => {
  let calls = 0;
  const { client } = setup(async () => { calls++; return new Response('logged out', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); });
  expect(await client.auth.signOut()).toEqual({ error: null }); expect(calls).toBe(1);
});

it('L1-19/OGL04 captured expired JWT is not silently renewed; native401 remains observable after local clearing', async () => {
  const token = native(Math.floor(Date.now() / 1000) - 120); let calls = 0;
  const { client, data } = setup(async (input, init) => {
    calls++; expect(new URL(String(input)).pathname).toBe('/api/auth/v1/logout'); expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token.auth_token}`);
    return new Response('private-backend-detail', { status: 401 });
  }, token);
  const result = await client.auth.signOut(); expect(result.error?.status).toBe(401);
  expect(JSON.stringify(result)).not.toContain('private-backend-detail'); expect(calls).toBe(1); expect(data.has('owned')).toBe(false);
});

it('L1-27/OGL06 active fixture targets the approved official0359 minimum with exact release assets', async () => {
  const baseline = JSON.parse(await readFile('tests/fixtures/baseline.json', 'utf8'));
  expect(baseline.trailbase.version).toBe('0.35.9'); expect(baseline.trailbase.commit).toBe('a106ce6338f9831140c92ac16e051901ed92d576');
  expect(baseline.trailbase.assets['linux-x64']).toEqual({ name: 'trailbase_v0.35.9_x86_64_linux.zip', sha256: 'e24c05b2b04bb975c2ee880e285055e91c7548568dca1196371b44a5621c0541' });
  expect(baseline.trailbaseClient).toBe('0.14.3'); expect(baseline.supabaseClient).toBe('2.117.2'); expect(baseline.supabaseCli).toBe('2.119.0');
});

it('L1-19/OGL01 unexpected status MIME body redirect and origin cannot acknowledge; errors never echo response secrets', async () => {
  for (const variant of ['401', '403', '500', '204', 'redirect', 'opaque', 'followed', 'foreign', 'json', 'malformed-mime', 'missing-body', 'empty', 'prefix', 'extra', 'large', 'wrong'] as const) {
    let calls = 0;
    const { client, data } = setup(async () => {
      calls++;
      if (/^\d+$/.test(variant)) return new Response(null, { status: Number(variant) });
      if (variant === 'missing-body') return new Response(null, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const body = variant === 'empty' ? '' : variant === 'prefix' ? 'logged' : variant === 'extra' ? 'logged out\n' : variant === 'large' ? 'logged out' + 'private-secret'.repeat(1000) : variant === 'wrong' ? 'private-secret' : 'logged out';
      const response = new Response(body, { status: variant === 'redirect' ? 303 : 200, headers: { 'content-type': variant === 'json' ? 'application/json' : variant === 'malformed-mime' ? 't e x t/p l a i n; charset=u t f-8' : 'text/plain; charset=utf-8' } });
      if (variant === 'opaque') Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
      if (variant === 'followed') Object.defineProperty(response, 'redirected', { value: true });
      if (variant === 'foreign') Object.defineProperty(response, 'url', { value: 'https://foreign.invalid/api/auth/v1/logout' });
      return response;
    });
    const result = await client.auth.signOut(); expect(result.error).not.toBeNull();
    if (/^\d+$/.test(variant)) expect(result.error?.status).toBe(Number(variant));
    else expect(result.error?.name).toBe('AuthGlobalSignOutUnconfirmedError');
    expect(JSON.stringify(result)).not.toContain('private-secret'); expect(calls).toBe(1); expect(data.has('owned')).toBe(false); expect(data.get('unrelated')).toBe('keep');
  }
});

it('L1-19/OGL05 failed receipt-reader acquisition cannot expose transport error details', async () => {
  const response = new Response('logged out', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  vi.spyOn(response.body!, 'getReader').mockImplementation(() => { throw Error('private-reader-secret'); });
  const { client } = setup(async () => response);
  const result = await client.auth.signOut(); expect(result.error?.name).toBe('AuthGlobalSignOutUnconfirmedError'); expect(JSON.stringify(result)).not.toContain('private-reader-secret');
});

it('L1-19/OGL05 failed request stays sanitized with no retry or local fallback', async () => {
  let calls = 0;
  const { client, data } = setup(async () => { calls++; throw Error('private-request-secret'); });
  const result = await client.auth.signOut(); expect(result.error?.name).toBe('AuthSignOutRequestError');
  expect(JSON.stringify(result)).not.toContain('private-request-secret'); expect(calls).toBe(1); expect(data.has('owned')).toBe(false);
});

it('L1-19/OGL01 complete prefix is not success until EOF and receipt reader lock is released', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>, reads = 0, entered!: () => void;
  const waiting = new Promise<void>(yes => { entered = yes; });
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('logged out')); } }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const getReader = response.body!.getReader.bind(response.body!);
  vi.spyOn(response.body!, 'getReader').mockImplementation(() => {
    const reader = getReader(), read = reader.read.bind(reader);
    vi.spyOn(reader, 'read').mockImplementation(() => { if (++reads === 2) entered(); return read(); });
    return reader;
  });
  const { client } = setup(async () => response); let settled = false;
  const result = client.auth.signOut(); void result.then(() => { settled = true; });
  await waiting; expect(settled).toBe(false); stream.close(); expect(await result).toEqual({ error: null }); expect(response.body!.locked).toBe(false);
});

it('L1-19/OGL02 held global receipt shares one flight and cannot clear a newer committed password login', async () => {
  let release!: (value: Response) => void, enter!: () => void, requests = 0;
  const held = new Promise<Response>(yes => { release = yes; }), entered = new Promise<void>(yes => { enter = yes; });
  const next = { ...native(), refresh_token: 'new-owner-refresh' };
  const { client, data } = setup(async input => {
    if (new URL(String(input)).pathname.endsWith('/logout')) { requests++; enter(); return held; }
    return Response.json(next);
  });
  await client.auth.getSession();
  const first = client.auth.signOut(), second = client.auth.signOut({ scope: 'global' }); expect(second).toBe(first); await entered;
  expect((await client.auth.signOut({ scope: 'local' })).error?.name).toBe('AuthSignOutInProgressError');
  expect((await client.auth.signInWithPassword({ email: 'owned@example.test', password: 'Fixture-password' })).error).toBeNull();
  release(new Response('logged out', { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  expect(await first).toEqual({ error: null }); expect(requests).toBe(1);
  expect((await client.auth.getSession()).data.session?.refresh_token).toBe('new-owner-refresh'); expect(JSON.parse(data.get('owned')!).tokens.refresh_token).toBe('new-owner-refresh');
});

it('L1-19/OGL05 missing response deadline aborts owned transport and clears timer without replay', async () => {
  vi.useFakeTimers();
  try {
    let enter!: () => void, signal: AbortSignal | null | undefined, calls = 0;
    const entered = new Promise<void>(yes => { enter = yes; });
    const { client, data } = setup(async (_input, init) => { calls++; signal = init?.signal; enter(); return new Promise<Response>(() => {}); });
    const result = client.auth.signOut(); await entered; await vi.advanceTimersByTimeAsync(10000);
    expect((await result).error?.name).toBe('AuthSignOutRequestError'); expect(signal?.aborted).toBe(true); expect(calls).toBe(1); expect(data.has('owned')).toBe(false); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('L1-19/OGL05 receipt deadline releases pending reader even if cancellation rejects or never settles', async () => {
  vi.useFakeTimers();
  try {
    for (const hangs of [false, true]) {
      let enter!: () => void, cancels = 0;
      const entered = new Promise<void>(yes => { enter = yes; });
      const response = new Response(new ReadableStream<Uint8Array>({ pull() { enter(); }, cancel() { cancels++; return hangs ? new Promise<void>(() => {}) : Promise.reject(Error('private-cancel-secret')); } }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const { client, data } = setup(async () => response); const result = client.auth.signOut();
      await entered; await vi.advanceTimersByTimeAsync(10000);
      const ended = await result; expect(ended.error?.name).toBe('AuthGlobalSignOutUnconfirmedError'); expect(JSON.stringify(ended)).not.toContain('private-cancel-secret');
      expect(cancels).toBe(1); expect(response.body!.locked).toBe(false); expect(data.has('owned')).toBe(false); expect(vi.getTimerCount()).toBe(0);
    }
  } finally { vi.useRealTimers(); }
});
