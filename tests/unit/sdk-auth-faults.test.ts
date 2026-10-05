import { expect, it } from 'vitest';
import { createClient } from '../../src/index.js';
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const credentials = { email: 'placeholder@example.test', password: 'placeholder' };
const factory = (fetch: typeof globalThis.fetch) => createClient('http://localhost:4000', undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch } });
it('L1-14/U14 L1-15/U15 HTTP/network/redirect/malformed JSON faults are observable and never retried', async () => {
  for (const action of [async () => { throw new Error('Transport unavailable'); }, async () => new Response(null, { status: 302, headers: { location: '/' } }), async () => new Response('{broken', { status: 200 })]) {
    let calls = 0; const sdk = factory(async () => { calls++; return action(); });
    const result = await sdk.auth.signInWithPassword(credentials); expect(result.error).not.toBeNull(); expect(result.data.session).toBeNull(); expect((await sdk.auth.getSession()).data.session).toBeNull(); expect(calls).toBe(1);
  }
  const sdk = factory(async () => new Response('SMTP unavailable', { status: 500 }));
  const result = await sdk.auth.signUp(credentials); expect(result.error?.status).toBe(500); expect(result.error?.message).toContain('SMTP unavailable'); expect(result.data).toEqual({ user: null, session: null });
});
it('L1-15/U15 malformed response/JWT JSON errors never expose payload fragments or replace a good session', async () => {
  const marker = 'private-refresh-synthetic';
  const encode = (input: unknown) => Buffer.from(JSON.stringify(input)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: credentials.email, iat: now, exp: now + 600 };
  const good = { auth_token: `${encode({ alg: 'EdDSA' })}.${encode(claims)}.signature`, refresh_token: 'fixture-refresh', csrf_token: null };
  const malformed = Buffer.from(marker).toString('base64url');
  for (const response of [
    () => new Response(marker, { status: 200 }),
    () => Response.json({ ...good, auth_token: `${malformed}.${encode(claims)}.signature` }),
    () => Response.json({ ...good, auth_token: `${encode({ alg: 'EdDSA' })}.${malformed}.signature` }),
  ]) {
    let calls = 0;
    const sdk = factory(async () => ++calls === 1 ? Response.json(good) : response());
    expect((await sdk.auth.signInWithPassword(credentials)).error).toBeNull();
    const before = await sdk.auth.getSession();
    const result = await sdk.auth.signInWithPassword(credentials);
    expect(result.error?.name).toBe('AuthInvalidPayloadError');
    expect(result.error?.message).not.toContain(marker.slice(0, 8));
    expect(result.data).toEqual({ user: null, session: null });
    expect(await sdk.auth.getSession()).toEqual(before);
    expect(calls).toBe(2);
  }
});
it('L1-16/U16 disabled background refresh still performs expired preflight, failure never becomes anonymous', async () => {
  const original = Date.now; const timestamp = original();
  const now = Math.floor(timestamp / 1000); const payload = { sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: null, iat: now, exp: now + 60 };
  const encode = (input: unknown) => Buffer.from(JSON.stringify(input)).toString('base64url'); const token = `${encode({ alg: 'EdDSA' })}.${encode(payload)}.signature`;
  let calls = 0; const sdk = factory(async input => { calls++; return new URL(String(input)).pathname.endsWith('/login') ? Response.json({ auth_token: token, refresh_token: 'fixture-refresh', csrf_token: null }) : new Response('Unavailable', { status: 503 }); });
  try {
    expect((await sdk.auth.signInWithPassword(credentials)).error).toBeNull();
    Date.now = () => timestamp + 120000;
    expect((await sdk.from('todos').select()).error?.status).toBe(503); expect(calls).toBe(2);
    expect((await sdk.auth.getSession()).error?.status).toBe(503); expect(calls).toBe(3);
  } finally { Date.now = original; }
});
