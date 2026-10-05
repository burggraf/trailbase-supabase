import { expect, it } from 'vitest';
import { createClient } from '../../src/index.js';
const trailbase = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
it('L1-16/P16 64 distinct stored native credentials reconstruct only genuine session fields', async () => {
  const now = Math.floor(Date.now() / 1000); const ids = new Set<string>();
  for (let index = 0; index < 64; index++) {
    const id = `12345678-1234-4234-8234-${index.toString(16).padStart(12, '0')}`; ids.add(id);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const tokens = { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url'), email: `vector-${index}@example.test`, iat: now - 120, exp: now + 600 })}.signature`, refresh_token: `refresh-vector-${index}`, csrf_token: index % 2 ? null : `csrf-vector-${index}` };
    const raw = JSON.stringify({ version: 1, tokens }); let reads = 0;
    const sdk = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storage: { getItem: () => { reads++; return raw; }, setItem: () => { throw new Error('No redundant write'); }, removeItem: () => { throw new Error('No deletion'); } } } });
    const session = (await sdk.auth.getSession()).data.session;
    expect(session).toEqual({ access_token: tokens.auth_token, refresh_token: tokens.refresh_token, token_type: 'bearer', expires_at: now + 600, expires_in: 720, user: { id, email: `vector-${index}@example.test` } }); expect(reads).toBe(1);
  }
  expect(ids.size).toBe(64);
});
it('L1-16/S08 stale initial write removal rejection is observable and latched without deleting unrelated data', async () => {
  const now = Math.floor(Date.now() / 1000), encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const tokens = { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: null, iat: now, exp: now + 600 })}.signature`, refresh_token: 'fixture-refresh', csrf_token: null };
  let release!: () => void, started!: () => void; const held = new Promise<void>(yes => { release = yes; }), ready = new Promise<void>(yes => { started = yes; });
  const data = new Map([['unrelated', 'keep']]); let calls = 0; const key = 'owned';
  const sdk = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storageKey: key, storage: { getItem: k => data.get(k) ?? null, setItem: async (k, value) => { data.set(k, value); started(); await held; }, removeItem: () => { throw new Error('private-removal-error'); } } }, global: { fetch: async () => ++calls === 1 ? Response.json(tokens) : new Response('Rejected', { status: 401 }) } });
  const credentials = { email: 'placeholder', password: 'placeholder' }; const first = sdk.auth.signInWithPassword(credentials); await ready; const second = sdk.auth.signInWithPassword(credentials); release();
  expect((await first).error?.name).toBe('AuthStorageRestoreError'); expect((await second).error?.name).toBe('AuthStorageRestoreError'); expect((await sdk.auth.getSession()).data.session).toBeNull(); expect(data.get('unrelated')).toBe('keep'); expect(data.has(key)).toBe(true); expect(calls).toBe(2);
});
