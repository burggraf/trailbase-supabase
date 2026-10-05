import { expect, it } from 'vitest';
import { createClient, type AuthStorage } from '../../src/index.js';
const trailbase = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
it('L1-16/U16 default browser storage keys are stable origin-namespaced; invalid methods/keys fail before effects', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'); const keys: string[] = [];
  const storage: AuthStorage = { getItem: key => { keys.push(key); return null; }, setItem: () => {}, removeItem: () => {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try {
    for (const origin of ['http://localhost:4000', 'http://localhost:4000', 'http://localhost:4001']) {
      const sdk = createClient(origin, undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false } });
      expect((await sdk.auth.getSession()).error).toBeNull();
    }
    expect(keys).toEqual(['trailbase-supabase.auth:http://localhost:4000', 'trailbase-supabase.auth:http://localhost:4000', 'trailbase-supabase.auth:http://localhost:4001']);
    for (const storageKey of ['', '   ', 'invalid\nkey']) expect(() => createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storageKey } })).toThrow(TypeError);
    expect(() => createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false, storage: {} as AuthStorage } })).toThrow(TypeError);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});
it('L1-16/U16 unavailable browser storage returns a sanitized named envelope and no anonymous data request', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'); let calls = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('private-browser-storage-failure'); } } });
  try {
    const sdk = createClient('http://localhost:4000', undefined, { trailbase, auth: { persistSession: true, autoRefreshToken: false }, global: { fetch: async () => { calls++; return Response.json({}); } } });
    expect((await sdk.auth.getSession()).error?.name).toBe('AuthStorageUnavailableError');
    const result = await sdk.from('todos').select(); expect(result.error?.name).toBe('AuthStorageUnavailableError'); expect(result.error?.message).not.toContain('private-browser'); expect(calls).toBe(0);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});
