import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { initClient } from 'trailbase';
import { createClient as referenceClient } from '@supabase/supabase-js';
import { createClient, type AuthStorage } from '../../src/index.js';
import { exec } from '../../scripts/tools.mjs';
import { cli, fixtureEnvironment } from '../../scripts/harness.mjs';
import { context, canonicalUuid, nativeUuid, nativeAuthSnapshot, confirmEmail, supabase, type Context } from '../phase-a/helpers.js';
import { authSnapshot, account, fixtureEmail, sql } from '../auth-reference/helpers.js';
import { cleanupOwnedRows, withCleanup } from '../sdk-browser/cleanup.js';
import { totp } from './totp.js';

export const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
export type Owner = { label: string; email: string; password: string; id?: string; rowId?: string; totpUri?: string };
export type State = { runId: string; owners: Owner[]; rejected: Owner[]; reference?: Owner };
const statePath = (env: Context) => resolve(env.directory, 'auth-negative-state-private.json');
export async function negativeContext(disabled?: boolean) {
  const env = await context();
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'default' || env.nativeServerProfile !== 'default' || env.registrationPolicyTest !== true || owner.registrationPolicyTest !== true || typeof env.registrationDisabled !== 'boolean' || disabled !== undefined && env.registrationDisabled !== disabled) throw new Error('Dedicated owned0359 negative-control fixture required');
  return env;
}
export async function save(env: Context, state: State) {
  if (state.runId !== env.id) throw new Error('Negative-control state owner mismatch');
  await writeFile(statePath(env), JSON.stringify(state), { mode: 0o600 });
}
export async function load(env: Context): Promise<State> {
  const state: State = JSON.parse(await readFile(statePath(env), 'utf8'));
  if (state.runId !== env.id) throw new Error('Negative-control state owner mismatch');
  for (const owner of [...state.owners, ...state.rejected, ...(state.reference ? [state.reference] : [])]) {
    fixtureEmail(owner.email);
    if (!owner.email.startsWith(`an-${env.id}-`) || typeof owner.password !== 'string' || owner.id !== undefined && !/^[a-f0-9-]{36}$/.test(owner.id)) throw new Error('Refusing non-owned negative-control identity');
  }
  return state;
}
export const identity = (env: Context, label: string): Owner => ({ label, email: `an-${env.id}-${label}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` });
export function nativeState(env: Context) {
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  let sessions: DatabaseSync | undefined;
  try { sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true }); return nativeAuthSnapshot(main, sessions); }
  finally { sessions?.close(); main.close(); }
}
export const native = (env: Context) => initClient(env.trailUrl, { transport: { fetch: (path, init) => {
  const url = new URL(path, env.trailUrl);
  if (url.origin !== env.trailUrl) throw new Error('Refusing foreign native fixture request');
  return fetch(url, { ...init, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
} } });
export async function request(env: Context, route: string, body: Record<string, string>) {
  if (!['register', 'login', 'refresh'].includes(route)) throw new Error('Invalid negative-control route');
  return fetch(`${env.trailUrl}/api/auth/v1/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
}
export function sdk(env: Context, storage?: AuthStorage, key?: string) {
  return createClient(env.trailUrl, undefined, { trailbase: mapping, auth: { persistSession: !!storage, autoRefreshToken: false, ...(storage ? { storage, storageKey: key } : {}) }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }) } });
}
export async function ordinaryLogin(env: Context, owner: Owner) {
  const client = native(env), challenge = await client.login(owner.email, owner.password);
  if (challenge) {
    if (!owner.totpUri) throw new Error('Owned MFA cleanup lacks its genuine issued secret');
    await client.loginSecond({ mfaToken: challenge, totpCode: totp(owner.totpUri) });
  }
  const user = client.user();
  if (!user || owner.id && canonicalUuid(user.id) !== owner.id) throw new Error('Ordinary fixture login owner mismatch');
  owner.id ??= canonicalUuid(user.id);
  return client;
}
export async function enrollOwner(env: Context, state: State, label: string, mfa = false) {
  const owner = identity(env, label); state.owners.push(owner); await save(env, state); // Preserve unknown request outcomes for cleanup.
  const client = native(env); await client.register(owner); await confirmEmail(env, owner.email); await client.login(owner.email, owner.password);
  owner.id = canonicalUuid(client.user()!.id); await save(env, state);
  if (mfa) {
    owner.totpUri = (await client.registerTOTP()).url; await save(env, state);
    await client.confirmTOTP(owner.totpUri, totp(owner.totpUri));
  }
  owner.rowId = randomUUID(); await save(env, state);
  const authenticated = await ordinaryLogin(env, owner);
  await authenticated.records('todos').create({ id: nativeUuid(owner.rowId), user_id: nativeUuid(owner.id), title: `AN-${owner.rowId}` });
  return owner;
}
export async function baseline(env: Context) {
  const value = { native: nativeState(env), reference: await authSnapshot(env) };
  // Lossless private complete rows, including int64s and genuine credentials; never a public artifact.
  await writeFile(resolve(env.directory, 'auth-negative-baseline-private.bin'), serialize(value), { mode: 0o600 });
  assert.equal(value.reference.find(row => row.name === 'audit_log_entries')?.count, 0);
  return value;
}
export async function original(env: Context): Promise<Awaited<ReturnType<typeof baseline>>> {
  return deserialize(await readFile(resolve(env.directory, 'auth-negative-baseline-private.bin')));
}
export async function recoverSignup(env: Context, owner: Owner) {
  const client = sdk(env), input = { email: owner.email, password: owner.password }, result = await client.auth.signUp(input);
  assert.deepEqual(result, { data: { user: null, session: null }, error: null });
  await confirmEmail(env, owner.email);
  const login = await client.auth.signInWithPassword(input);
  assert.equal(login.error, null); assert.equal(login.data.user?.email, owner.email);
  owner.id = login.data.user!.id;
  assert.equal((await client.auth.signOut()).error, null);
}
export async function deleteNativeOwner(env: Context, owner: Owner) {
  const before = nativeState(env), row = before.users.find(row => row.email === owner.email || row.unverified_email === owner.email);
  if (!row) return;
  if (row.email !== owner.email && row.email !== null || owner.id && !(row.id instanceof Uint8Array && Buffer.from(nativeUuid(owner.id), 'base64url').equals(row.id))) throw new Error('Refusing unrelated pending native cleanup');
  // Native confirmation moves unverified_email into email; there is no verified column.
  if (row.email !== owner.email) await confirmEmail(env, owner.email);
  const client = await ordinaryLogin(env, owner);
  const tokens = client.tokens(); if (!tokens) throw new Error('Fresh native cleanup credentials missing');
  await withCleanup(async () => {
    if (owner.rowId) await cleanupOwnedRows(client.records('todos'), nativeUuid(owner.id!), [nativeUuid(owner.rowId)]);
  }, [
    async () => {
      const response = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { headers: { authorization: `Bearer ${tokens.auth_token}`, 'content-type': 'application/json' }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200); assert.equal(response.redirected, false); assert.equal(response.url, `${env.trailUrl}/api/auth/v1/logout`);
      assert.equal(response.headers.get('location'), null); assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8'); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode('logged out'));
    },
    async () => { await client.deleteUser(); },
    async () => {
      const after = nativeState(env), own = (value: unknown) => value instanceof Uint8Array && Buffer.from(nativeUuid(owner.id!), 'base64url').equals(value);
      assert.deepEqual(after.users, before.users.filter(value => !own(value.id)));
      assert.deepEqual(after.sessions, before.sessions.filter(value => !own(value.user)));
      assert.deepEqual(after.todos, before.todos.filter(value => !own(value.user_id)));
      assert.deepEqual(after.audit.slice(0, before.audit.length), before.audit);
      const deleted = before.todos.filter(value => own(value.user_id));
      assert.equal(after.audit.length, before.audit.length + deleted.length);
      for (const [index, todo] of deleted.entries()) assert.deepEqual({ ...after.audit[before.audit.length + index] }, { audit_key: BigInt(before.audit.at(-1)?.audit_key as bigint ?? 0n) + BigInt(index + 1), todo_id: todo.id, user_id: todo.user_id, operation: 'DELETE' });
    },
  ]);
}
export async function deleteReferenceOwner(env: Context, owner: Owner) {
  const found = await account(env, owner.email); if (!found) return;
  if (owner.id && owner.id !== found.id) throw new Error('Reference cleanup identity mismatch');
  owner.id = found.id;
  if (!found.confirmed) await confirmEmail(env, owner.email);
  const ordinary = supabase(env);
  const login = await ordinary.auth.signInWithPassword({ email: owner.email, password: owner.password });
  assert.equal(login.error, null); assert.equal(login.data.user?.id, owner.id);
  assert.equal((await ordinary.auth.signOut({ scope: 'global' })).error, null);
  // Only Node-side disposable-fixture cleanup. This private CLI setup key never enters context/browser/public evidence.
  // status.log combines stdout+stderr and is not a JSON document. Parse only fresh CLI stdout.
  const result = await exec(cli, ['status', '-o', 'json', '--workdir', env.directory, '--agent', 'no'], { env: fixtureEnvironment(), timeout: 5000, maxBuffer: 4096 });
  const status = JSON.parse(result.stdout);
  if (typeof status.SERVICE_ROLE_KEY !== 'string' || status.API_URL !== env.supabaseUrl) throw new Error('Private owned reference cleanup target/key mismatch');
  const admin = referenceClient(env.supabaseUrl, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  assert.equal((await admin.auth.admin.deleteUser(owner.id)).error, null);
  assert.equal(await account(env, owner.email), null);
}
type AuditFingerprint = { id: string; sha256: string; owned: boolean };
export function assertReferenceAuditPreserved(before: AuditFingerprint[], after: AuditFingerprint[]) {
  const previous = new Map(before.map(row => [row.id, row])), current = new Map(after.map(row => [row.id, row]));
  assert.equal(previous.size, before.length, 'Duplicate pre-cleanup audit identity');
  assert.equal(current.size, after.length, 'Duplicate final audit identity');
  for (const [id, row] of previous) assert.deepEqual(current.get(id), row, 'Existing complete reference audit row changed/removed');
  for (const [id, row] of current) if (!previous.has(id)) assert.equal(row.owned, true, 'Unattributable new reference cleanup audit row');
}
export async function referenceAuditSnapshot(env: Context, owner: Owner): Promise<AuditFingerprint[]> {
  if (!owner.id || !/^[a-f0-9-]{36}$/.test(owner.id)) throw new Error('Missing owned reference audit target');
  return sql(env, `SELECT coalesce(json_agg(json_build_object('id',id,'sha256',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'owned',coalesce(payload->>'actor_id'='${owner.id}' OR payload->'traits'->>'user_id'='${owner.id}',false)) ORDER BY id),'[]'::json) FROM auth.audit_log_entries t`);
}
