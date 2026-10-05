import { expect, it } from 'vitest';
import { createClient } from '../../src/index.js';

const credentials = { email: 'placeholder@example.test', password: 'placeholder' };
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const native = {
  auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: credentials.email, iat: now, exp: now + 600 })}.signature`,
  refresh_token: 'synthetic-fixture-refresh',
  csrf_token: null,
};
const factory = (fetch: typeof globalThis.fetch) => createClient('http://localhost:4000', undefined, {
  trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
});
function restore(key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
  else Reflect.deleteProperty(Object.prototype, key);
}

it.each(['email', 'password'] as const)('L1-14/U14 L1-15/U15 inherited %s cannot supply required password credentials', async field => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, field);
  let calls = 0;
  const client = factory(async () => { calls++; return Response.json(native); });
  const input = { ...credentials };
  Reflect.deleteProperty(input, field);
  try {
    Object.defineProperty(Object.prototype, field, { value: credentials[field], configurable: true });
    expect(() => client.auth.signUp(input)).toThrow(TypeError);
    expect(() => client.auth.signInWithPassword(input)).toThrow(TypeError);
    await Promise.resolve();
    expect(calls).toBe(0);
    expect((await client.auth.getSession()).data.session).toBeNull();
  } finally { restore(field, descriptor); }
});

it.each(['auth_token', 'refresh_token'] as const)('L1-15/U15 inherited %s cannot supply a missing native login credential', async field => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, field);
  const malformed = { ...native };
  Reflect.deleteProperty(malformed, field);
  let calls = 0;
  const client = factory(async () => Response.json(++calls === 1 ? native : malformed));
  expect((await client.auth.signInWithPassword(credentials)).error).toBeNull();
  const before = await client.auth.getSession();
  try {
    Object.defineProperty(Object.prototype, field, { value: native[field], configurable: true });
    const result = await client.auth.signInWithPassword(credentials);
    expect(result.error).not.toBeNull();
    expect(result.data).toEqual({ user: null, session: null });
    expect(await client.auth.getSession()).toEqual(before);
    expect(calls).toBe(2);
  } finally { restore(field, descriptor); }
});
