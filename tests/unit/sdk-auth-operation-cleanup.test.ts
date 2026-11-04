import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { nativeUuid, type Context } from '../phase-a/helpers.js';
import { deleteNativeOwner, ordinaryLogin, nativeState, type Owner } from '../auth-negative/helpers.js';

// Actual installed JS0143 + real isolated SQLite, but all HTTP/JWTs below are synthetic.
// This characterizes a fixture-cleanup mechanism; it is not native server proof.
const fixtures: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const cleanup of fixtures.splice(0)) await cleanup(); });
async function fixture(ttl = 3, denyCleanupLogin = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'al-cleanup-unit-')); await mkdir(resolve(directory, 'traildepot/data'), { recursive: true });
  const main = new DatabaseSync(resolve(directory, 'traildepot/data/main.db')), sessions = new DatabaseSync(resolve(directory, 'traildepot/data/session.db'));
  fixtures.push(async () => { main.close(); sessions.close(); await rm(directory, { recursive: true }); });
  const owner: Owner = { label: 'unit', id: '12345678-1234-4234-8234-123456789abc', email: 'owned@example.test', password: 'unit-password' }, own = Buffer.from(nativeUuid(owner.id!), 'base64url'), foreign = Buffer.from('22345678123442348234123456789abc', 'hex');
  main.exec('CREATE TABLE _user(id BLOB,email TEXT,unverified_email TEXT,marker INTEGER); CREATE TABLE todos(id BLOB,user_id BLOB,title TEXT); CREATE TABLE todo_audit(audit_key INTEGER,todo_id BLOB,user_id BLOB,operation TEXT);');
  main.prepare('INSERT INTO _user VALUES(?,?,NULL,?)').run(own, owner.email, 1n); main.prepare('INSERT INTO _user VALUES(?,?,NULL,?)').run(foreign, 'foreign@example.test', 9223372036854775807n);
  main.prepare('INSERT INTO todos VALUES(?,?,?)').run(foreign, foreign, 'synthetic foreign row'); main.prepare('INSERT INTO todo_audit VALUES(?,?,?,?)').run(9223372036854775807n, foreign, foreign, 'INSERT');
  sessions.exec('CREATE TABLE _session(user BLOB,refresh_token TEXT,expires INTEGER);'); sessions.prepare('INSERT INTO _session VALUES(?,?,?)').run(foreign, 'synthetic-foreign-refresh', 9223372036854775807n);
  const env = { id: 'unit', project: 'unit', directory, origins: ['http://127.0.0.1:4000'], trailUrl: 'http://127.0.0.1:4000', supabaseUrl: 'http://127.0.0.1:4001', mailUrl: 'http://127.0.0.1:4002', anonKey: 'unit-placeholder', authVariant: 'stock', nativeServerProfile: 'default', nativeAuthProfile: ttl === 3 ? 'short-native-auth' : 'default' } satisfies Context;
  const before = nativeState(env), calls: { path: string; authenticated: boolean; liveRefresh: boolean }[] = [], issued = new Set<string>(); let logins = 0, revoked = false;
  const token = () => { const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url'); const value = `${encode({ alg: 'EdDSA' })}.${encode({ sub: nativeUuid(owner.id!), email: owner.email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttl, revision: issued.size })}.synthetic`; issued.add(`Bearer ${value}`); return value; };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); expect(url.origin).toBe(env.trailUrl); const headers = new Headers(init?.headers), authenticated = issued.has(headers.get('authorization') ?? ''), refresh = headers.get('refresh-token');
    const liveRefresh = !!refresh && !!sessions.prepare('SELECT 1 FROM _session WHERE refresh_token=?').get(refresh); calls.push({ path: `${init?.method ?? 'GET'} ${url.pathname}`, authenticated, liveRefresh });
    const response = (body: string | null, status = 200, contentType = 'application/json') => { const result = new Response(body, { status, headers: { 'content-type': contentType } }); Object.defineProperty(result, 'url', { value: url.href }); return result; };
    if (url.pathname.endsWith('/login') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); expect(body.email_or_username).toBe(owner.email); expect(body.password).toBe(owner.password);
      if (revoked && denyCleanupLogin) return response('Rejected', 401);
      const refresh_token = `synthetic-owned-${++logins}`; sessions.prepare('INSERT INTO _session VALUES(?,?,?)').run(own, refresh_token, 123456789n);
      return response(JSON.stringify({ auth_token: token(), refresh_token, csrf_token: 'synthetic-csrf' }));
    }
    if (url.pathname.endsWith('/refresh') && init?.method === 'POST') {
      const refresh = JSON.parse(String(init.body)).refresh_token;
      return sessions.prepare('SELECT 1 FROM _session WHERE refresh_token=?').get(refresh) ? response(JSON.stringify({ auth_token: token(), csrf_token: 'synthetic-csrf' })) : response('Rejected', 401);
    }
    if (url.pathname.endsWith('/logout') && (init?.method ?? 'GET') === 'GET') {
      expect(authenticated).toBe(true); revoked = true; sessions.prepare('DELETE FROM _session WHERE user=?').run(own); return response('logged out', 200, 'text/plain; charset=utf-8');
    }
    if (url.pathname.endsWith('/delete') && init?.method === 'DELETE') {
      if (authenticated) { main.prepare('DELETE FROM _user WHERE id=?').run(own); sessions.prepare('DELETE FROM _session WHERE user=?').run(own); }
      return response(null); // Native-shaped anonymous no-op; postconditions must detect it.
    }
    throw new Error('Unexpected synthetic native cleanup route');
  }));
  return { env, owner, calls, before, main, sessions, foreign, remaining: () => !!main.prepare('SELECT 1 FROM _user WHERE id=?').get(own) };
}
it('AL cleanup characterization: installed JS0143 short-token refresh401 clears headers before anonymous DELETE after its own global revocation', async () => {
  const f = await fixture(), client = await ordinaryLogin(f.env, f.owner), tokens = client.tokens()!;
  await fetch(`${f.env.trailUrl}/api/auth/v1/logout`, { headers: { authorization: `Bearer ${tokens.auth_token}` } }); await client.deleteUser();
  expect(f.calls.map(c => c.path)).toEqual(['POST /api/auth/v1/login', 'GET /api/auth/v1/logout', 'POST /api/auth/v1/refresh', 'DELETE /api/auth/v1/delete']);
  expect(f.calls.at(-1)?.authenticated).toBe(false); expect(f.remaining()).toBe(true); expect(client.tokens()).toBeUndefined();
});
it.each([3, 3600])('AL generated-owner cleanup reauthenticates after global revocation before deleting with a live session (TTL%s)', async ttl => {
  const f = await fixture(ttl); await deleteNativeOwner(f.env, f.owner);
  expect(f.remaining()).toBe(false); expect(f.calls.filter(c => c.path.endsWith('/login'))).toHaveLength(2);
  expect(f.calls.filter(c => c.path.endsWith('/delete'))).toEqual([{ path: 'DELETE /api/auth/v1/delete', authenticated: true, liveRefresh: true }]);
  const after = nativeState(f.env); expect(after.users).toEqual(f.before.users.filter(row => Buffer.from(row.id as Uint8Array).equals(f.foreign))); expect(after.sessions).toEqual(f.before.sessions); expect(after.todos).toEqual(f.before.todos); expect(after.audit).toEqual(f.before.audit);
});
it('AL cleanup failed fresh authentication never falls back to anonymous DELETE or pretends state restoration', async () => {
  const f = await fixture(3, true); await expect(deleteNativeOwner(f.env, f.owner)).rejects.toBeInstanceOf(AggregateError);
  expect(f.calls.filter(c => c.path.endsWith('/login'))).toHaveLength(2); expect(f.calls.some(c => c.path.endsWith('/delete'))).toBe(false); expect(f.remaining()).toBe(true);
  const after = nativeState(f.env); expect(after.users).toEqual(f.before.users); expect(after.sessions).toEqual(f.before.sessions); expect(after.todos).toEqual(f.before.todos); expect(after.audit).toEqual(f.before.audit);
});
