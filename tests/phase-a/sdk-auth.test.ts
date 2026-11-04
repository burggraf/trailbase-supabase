import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyOwner, waitReady } from '../../scripts/harness.mjs';
import { exec } from '../../scripts/tools.mjs';
import { createClient, type AuthStorage } from '../../src/index.js';
import { context, confirmEmail, supabase, nativeUuid, canonicalUuid, confirmedTrailUser, confirmedSupabaseUser, nativeAuthSnapshot } from './helpers.js';
import { cleanupOwnedRows, withCleanup } from '../sdk-browser/cleanup.js';
import { httpStreamFixture } from '../proofs/http-stream-fixture.js';
import { realRecordOperationContract } from './sdk-auth-operation.js';

it('L1-16/18/19/24/S07/S08/AL02–AL07 genuine captured operation retires without cross-owner follow-up or accepted-write replay', realRecordOperationContract, 120000);

it('L1-14/I14 L1-15/I15 L1-16/I16 fresh SDK signup/real mail/login, reference failed replacement and bearer owner isolation', async () => {
  const env = await context();
  const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
  const ownedKey = `sdk-auth-${randomUUID()}`;
  const stored = new Map<string, string>([['unrelated', 'keep']]);
  const storage: AuthStorage = { getItem: async key => stored.get(key) ?? null, setItem: async (key, value) => { stored.set(key, value); }, removeItem: async key => { stored.delete(key); } };
  const sdk = (storage?: AuthStorage) => createClient(env.trailUrl, undefined, { trailbase: mapping, auth: { persistSession: !!storage, autoRefreshToken: false, ...(storage ? { storage, storageKey: ownedKey } : {}) }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
  const a = sdk(storage), b = sdk(), anonymous = sdk();
  const credentials = [0, 1].map(() => ({ email: `sdk-auth-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` }));
  const rowId = randomUUID(); let owner: string | undefined;
  const reference = supabase(env);
  // Fixture teardown owns any remaining sessions; the focused case also checks explicit local logout.
  await withCleanup(async () => {
    for (const [index, client] of [a, b].entries()) {
      const signup = await client.auth.signUp(credentials[index]); expect(signup.error).toBeNull(); expect(signup.data).toEqual({ user: null, session: null });
      expect((await client.auth.getSession()).data.session).toBeNull();
      await confirmEmail(env, credentials[index].email);
      const login = await client.auth.signInWithPassword(credentials[index]); expect(login.error).toBeNull(); expect(login.data.user).not.toBeNull();
      if (!index) owner = login.data.user!.id;
    }
    const before = await a.auth.getSession();
    const reloaded = sdk(storage);
    expect(await reloaded.auth.getSession()).toEqual(before);
    expect(stored.get('unrelated')).toBe('keep');
    const diskBefore = stored.get(ownedKey);
    expect(Object.keys(JSON.parse(diskBefore!)).sort()).toEqual(['tokens', 'version']);
    expect((await a.auth.signInWithPassword({ ...credentials[0], password: 'Incorrect-password' })).error).not.toBeNull();
    expect(await a.auth.getSession()).toEqual(before);
    expect(stored.get(ownedKey)).toBe(diskBefore);
    const referenceCredentials = { email: `sdk-auth-reference-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` };
    const signup = await reference.auth.signUp(referenceCredentials); expect(signup.error).toBeNull(); expect(signup.data.session).toBeNull();
    await confirmEmail(env, referenceCredentials.email); expect((await reference.auth.signInWithPassword(referenceCredentials)).error).toBeNull();
    const referenceBefore = (await reference.auth.getSession()).data.session;
    expect((await reference.auth.signInWithPassword({ ...referenceCredentials, password: 'Incorrect-password' })).error).not.toBeNull();
    expect((await reference.auth.getSession()).data.session).toEqual(referenceBefore);
    expect((await a.from('todos').insert({ id: rowId, user_id: owner, title: `sdk-auth-${rowId}` })).data).toBeNull();
    const row = await a.from('todos').select().eq('id', rowId).single(); expect(row.error).toBeNull(); expect(row.data?.user_id).toBe(owner);
    expect(await reloaded.from('todos').select().eq('id', rowId).single()).toEqual(row);
    expect((await b.from('todos').select().eq('id', rowId)).data).toEqual([]);
    expect((await anonymous.from('todos').select()).error).not.toBeNull();
    const denied = await b.from('todos').update({ title: 'forbidden' }).eq('id', rowId); expect(denied.error?.status).toBe(403);
    expect(await a.from('todos').select().eq('id', rowId).single()).toEqual(row);
    expect((await a.from('todos').delete().eq('id', rowId)).error).toBeNull();
    expect((await a.from('todos').select().eq('id', rowId)).data).toEqual([]);
  }, [
    async () => {
      const session = (await a.auth.getSession()).data.session;
      if (!owner || !session) return;
      const { initClient } = await import('trailbase');
      const raw = initClient(env.trailUrl, { transport: { fetch: (path, init) => { const headers = new Headers(init?.headers); headers.set('authorization', `Bearer ${session.access_token}`); return fetch(new URL(path, env.trailUrl), { ...init, headers, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) }); } } });
      await cleanupOwnedRows(raw.records('todos'), nativeUuid(owner), [nativeUuid(rowId)]);
    },
    async () => { stored.delete(ownedKey); expect(stored.get('unrelated')).toBe('keep'); },
    async () => { const logout = await reference.auth.signOut({ scope: 'local' }); expect(logout.error).toBeNull(); },
  ]);
}, 120000);

it('L1-17/I17/S04 live native status maps actual owned DB user, rejects forged/revoked/deleted identity without cached fallback', async () => {
  const env = await context(), { DatabaseSync } = await import('node:sqlite'), { resolve } = await import('node:path'), { mutateOwnedNativeUser, databaseDigest, ownedCleanupIdentity } = await import('./native-owned-user.mjs');
  const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const } } } } };
  const credentials = { email: `sdk-live-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` }, changedEmail = `sdk-live-changed-${randomUUID()}@example.test`;
  const data = new Map<string,string>([['unrelated','keep']]), key = `live-${randomUUID()}`, storage: AuthStorage = { getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);} };
  const make = () => createClient(env.trailUrl, undefined, { trailbase:mapping, auth:{persistSession:true,autoRefreshToken:false,storageKey:key,storage},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})} });
  const cascadeId=randomUUID(), cascadeBytes=Buffer.from(cascadeId.replaceAll('-',''),'hex');
  const a = make(); let ownedId: Buffer | undefined; let canonicalOwner: string | undefined;
  let main!: InstanceType<typeof DatabaseSync>, sessions!: InstanceType<typeof DatabaseSync>;
  const rawStatus = async (access?:string, refresh?:string) => { const response=await fetch(`${env.trailUrl}/api/auth/v1/status`,{headers:access?{authorization:`Bearer ${access}`,'Refresh-Token':refresh!}:{},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});return {status:response.status,body:await response.json()}; };
  await withCleanup(async()=>{
    main = new DatabaseSync(resolve(env.directory,'traildepot/data/main.db'), {readOnly:true}); sessions = new DatabaseSync(resolve(env.directory,'traildepot/data/session.db'));
    main.exec('PRAGMA busy_timeout=5000'); sessions.exec('PRAGMA busy_timeout=5000');
    expect((await a.auth.getUser()).error?.name).toBe('AuthSessionMissingError');expect(await rawStatus()).toEqual({status:200,body:{auth_token:null,refresh_token:null,csrf_token:null}});
    expect((await a.auth.signUp(credentials)).error).toBeNull();await confirmEmail(env,credentials.email);const login=await a.auth.signInWithPassword(credentials);expect(login.error).toBeNull();canonicalOwner=login.data.user!.id;ownedId=Buffer.from(canonicalOwner.replaceAll('-',''),'hex');
    const sentinelUsers=databaseDigest(main,'_user','id',ownedId),sentinelSessions=databaseDigest(sessions,'_session','user',ownedId);
    await expect(mutateOwnedNativeUser(env,main,sessions,{id:canonicalOwner,email:credentials.email},'change-email','invalid email')).rejects.toThrow('Invalid owned email operand');
    expect(main.prepare('SELECT email FROM _user WHERE id=?').get(ownedId)?.email).toBe(credentials.email);
    const bookkeeping=await mutateOwnedNativeUser(env,main,sessions,{id:canonicalOwner,email:credentials.email},'change-email',changedEmail);
    expect(bookkeeping.prohibitedSchemaChange).toBe(false);expect(bookkeeping.rawSchemaChanged).toBe(bookkeeping.allowedBookkeepingAdded.length>0);expect(bookkeeping.allowedBookkeepingAdded.every(name=>['sqlite_stat1','sqlite_stat4'].includes(name))).toBe(true);
    expect(main.prepare('SELECT email FROM _user WHERE id=?').get(ownedId)?.email).toBe(changedEmail);
    const live=await a.auth.getUser();expect(live.error).toBeNull();expect(live.data.user).toEqual({id:login.data.user!.id,email:changedEmail});expect((await a.auth.getSession()).data.session?.user.email).toBe(changedEmail);
    const good=data.get(key)!,frame=JSON.parse(good);const parts=frame.tokens.auth_token.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);frame.tokens.auth_token=parts.join('.');data.set(key,JSON.stringify(frame));
    expect(await rawStatus(frame.tokens.auth_token,frame.tokens.refresh_token)).toEqual({status:200,body:{auth_token:null,refresh_token:null,csrf_token:null}});const forged=await make().auth.getUser();expect(forged.data.user).toBeNull();expect(forged.error?.name).toBe('AuthSessionMissingError');expect(data.get(key)).toBe(JSON.stringify(frame));data.set(key,good);
    expect((await a.from('todos').insert({id:cascadeId,user_id:canonicalOwner,title:`owned-cascade-${cascadeId}`})).error).toBeNull();
    expect(main.prepare('SELECT COUNT(*) AS n FROM todos WHERE id=? AND user_id=?').get(cascadeBytes,ownedId)?.n).toBe(1);
    const session=(await a.auth.getSession()).data.session!;expect(sessions.prepare('DELETE FROM _session WHERE user=? AND refresh_token=?').run(ownedId,session.refresh_token).changes).toBe(1);expect(sessions.prepare('SELECT COUNT(*) AS n FROM _session WHERE user=? AND refresh_token=?').get(ownedId,session.refresh_token)?.n).toBe(0);
    const rejected=await a.auth.getUser();expect(rejected.data.user).toBeNull();expect(rejected.error?.status).toBe(401);expect(data.get(key)).toBe(good);expect((await a.auth.getSession()).data.session?.user.email).toBe(changedEmail);
    expect((await a.auth.signInWithPassword({...credentials,email:changedEmail})).error).toBeNull();const beforeDeletion=data.get(key);
    await mutateOwnedNativeUser(env,main,sessions,{id:canonicalOwner,email:changedEmail},'delete');expect(main.prepare('SELECT COUNT(*) AS n FROM _user WHERE id=?').get(ownedId)?.n).toBe(0);
    expect(main.prepare('SELECT COUNT(*) AS n FROM todos WHERE id=?').get(cascadeBytes)?.n).toBe(0);
    expect(main.prepare('SELECT operation FROM todo_audit WHERE todo_id=? AND user_id=? ORDER BY audit_key').all(cascadeBytes,ownedId).map(row=>row.operation)).toEqual(['INSERT','DELETE']);
    const deleted=await a.auth.getUser();expect(deleted.data.user).toBeNull();expect(deleted.error?.status).toBe(401);expect(data.get(key)).toBe(beforeDeletion);
    expect(databaseDigest(main,'_user','id',ownedId)).toBe(sentinelUsers);expect(databaseDigest(sessions,'_session','user',ownedId)).toBe(sentinelSessions);
  },[
    async()=>{if(ownedId){sessions.prepare('DELETE FROM _session WHERE user=?').run(ownedId);expect(sessions.prepare('SELECT COUNT(*) AS n FROM _session WHERE user=?').get(ownedId)?.n).toBe(0);}},
    async()=>{if(ownedId&&canonicalOwner){const current=main.prepare('SELECT email FROM _user WHERE id=?').get(ownedId);const cleanupOwner=ownedCleanupIdentity({id:canonicalOwner,email:credentials.email},changedEmail,current?.email);if(cleanupOwner)await mutateOwnedNativeUser(env,main,sessions,cleanupOwner,'delete');expect(main.prepare('SELECT COUNT(*) AS n FROM _user WHERE id=?').get(ownedId)?.n).toBe(0);expect(main.prepare('SELECT COUNT(*) AS n FROM todos WHERE id=?').get(cascadeBytes)?.n).toBe(0);}},
    async()=>{data.delete(key);expect(data.get('unrelated')).toBe('keep');},async()=>{sessions?.close();},async()=>{main?.close();}
  ]);
},120000);

it('L1-19/I19/C19/OGL03 real local and0359 default/explicit global acknowledgement revoke only owner refresh sessions and preserve complete state', async () => {
  const env = await context();
  const owner = await confirmedTrailUser(env, 'sdk-logout'), control = await confirmedTrailUser(env, 'sdk-logout-control');
  const reference = await confirmedSupabaseUser(env, 'sdk-logout-reference');
  const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
  const data = new Map<string, string>([['unrelated', 'keep']]);
  const storage: AuthStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
  const make = () => createClient(env.trailUrl, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storage, storageKey: `logout-${randomUUID()}` } });
  const a = make(), sibling = make(); const events: string[] = [];
  const credentials = { email: owner.email, password: owner.password };
  const listener = a.auth.onAuthStateChange(event => { events.push(event); }).data.subscription;
  const id = randomUUID(), controlId = randomUUID();
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true }), sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const ownerId = Buffer.from(owner.user.id, 'base64url');
  const unrelatedSessions = nativeAuthSnapshot(main, sessions).sessions.filter(row => ![owner, control].some(user => row.user instanceof Uint8Array && Buffer.from(user.user.id, 'base64url').equals(row.user)));
  const refresh = async (token: string) => {
    const response = await fetch(`${env.trailUrl}/api/auth/v1/refresh`, { method: 'POST', body: JSON.stringify({ refresh_token: token }), headers: { 'content-type': 'application/json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    await response.body?.cancel(); return response.status;
  };
  const snapshot = async () => Promise.all([owner, control].flatMap(user => ['todos', 'todo_audit'].map(async table => (await user.client.records(table).list({ pagination: { limit: 1000 }, order: [table === 'todos' ? '+id' : '+audit_key'] })).records)));
  await withCleanup(async () => {
    await owner.client.records('todos').create({ id: nativeUuid(id), user_id: owner.user.id, title: `logout-${id}` });
    await control.client.records('todos').create({ id: nativeUuid(controlId), user_id: control.user.id, title: `control-${controlId}` });
    const before = await snapshot();
    const first = await a.auth.signInWithPassword(credentials), second = await sibling.auth.signInWithPassword(credentials);
    expect(first.error).toBeNull(); expect(second.error).toBeNull(); expect(first.data.user?.id).toBe(canonicalUuid(owner.user.id));
    expect((await a.auth.signOut({ scope: 'local' })).error).toBeNull();
    expect(await refresh(first.data.session!.refresh_token)).toBe(401); expect(await refresh(second.data.session!.refresh_token)).toBe(200);
    expect((await a.auth.getSession()).data.session).toBeNull(); expect(data.get('unrelated')).toBe('keep'); expect(events).toEqual(['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT']);
    for (const explicit of [false, true]) {
      if (explicit) expect((await sibling.auth.signInWithPassword(credentials)).error).toBeNull();
      const globalSession = await a.auth.signInWithPassword(credentials); expect(globalSession.error).toBeNull();
      const complete = nativeAuthSnapshot(main, sessions), belongs = (row: Record<string, unknown>) => row.user instanceof Uint8Array && ownerId.equals(row.user);
      expect(complete.sessions.filter(belongs)).toHaveLength(explicit ? 2 : 3);
      expect(await (explicit ? a.auth.signOut({ scope: 'global' }) : a.auth.signOut())).toEqual({ error: null });
      expect(nativeAuthSnapshot(main, sessions)).toEqual({ ...complete, sessions: complete.sessions.filter(row => !belongs(row)) });
      for (const token of [globalSession.data.session!.refresh_token, second.data.session!.refresh_token, owner.client.tokens()!.refresh_token!]) expect(await refresh(token)).toBe(401);
      expect(await refresh(control.client.tokens()!.refresh_token!)).toBe(200); expect(await snapshot()).toEqual(before);
      expect((await a.auth.getSession()).data.session).toBeNull();
      const residual = await fetch(new URL('/api/records/v1/todos?skip_cursor=true', env.trailUrl), { headers: { authorization: `Bearer ${globalSession.data.session!.access_token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      expect(residual.status).toBe(200); await residual.body?.cancel();
    }
    expect(events).toEqual(['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'SIGNED_IN', 'SIGNED_OUT', 'SIGNED_IN', 'SIGNED_OUT']);
    // The real reference has an authenticated acknowledgement; keep its scope semantics separate.
    const r1 = supabase(env), r2 = supabase(env);
    try {
      const login1 = await r1.auth.signInWithPassword(reference), login2 = await r2.auth.signInWithPassword(reference);
      expect(login1.error).toBeNull(); expect(login2.error).toBeNull();
      expect((await r1.auth.signOut({ scope: 'local' })).error).toBeNull();
      expect((await r1.auth.refreshSession({ refresh_token: login1.data.session!.refresh_token })).error).not.toBeNull();
      expect((await r2.auth.refreshSession()).error).toBeNull();
      expect((await r1.auth.signInWithPassword(reference)).error).toBeNull(); expect((await r1.auth.signOut()).error).toBeNull();
      expect((await r2.auth.refreshSession()).error).not.toBeNull();
    } finally { await r1.auth.signOut({ scope: 'local' }); await r2.auth.signOut({ scope: 'local' }); }
  }, [
    async () => { listener.unsubscribe(); },
    async () => { await cleanupOfficialAuthOwner(env, owner, nativeUuid(id)); },
    async () => { await cleanupOfficialAuthOwner(env, control, nativeUuid(controlId)); },
    async () => { expect((await a.auth.signOut({ scope: 'local' })).error).toBeNull(); expect((await sibling.auth.signOut({ scope: 'local' })).error).toBeNull(); expect((await reference.client.auth.signOut({ scope: 'local' })).error).toBeNull(); },
    async () => { expect(nativeAuthSnapshot(main, sessions).sessions).toEqual(unrelatedSessions); },
    async () => { sessions.close(); main.close(); },
  ]);
}, 120000);

// Fresh ordinary credentials clean exact owned rows; acknowledged owner-wide cleanup also
// removes retained original/other credentials, including when primary or row cleanup fails.
async function cleanupOfficialAuthOwner(env: Awaited<ReturnType<typeof context>>, user: Awaited<ReturnType<typeof confirmedTrailUser>>, id: string) {
  await user.client.login(user.email, user.password); expect(user.client.user()?.id).toBe(user.user.id);
  await withCleanup(async () => { await cleanupOwnedRows(user.client.records('todos'), user.user.id, [id]); }, [async () => {
    const response = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { method: 'GET', headers: { authorization: `Bearer ${user.client.tokens()!.auth_token}`, 'content-type': 'application/json' }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    await withCleanup(async () => { expect(response.status).toBe(200); expect(await response.text()).toBe('logged out'); }, [async () => { if (!response.bodyUsed) await response.body?.cancel(); }]);
  }]);
}

const officialAuthMapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };

it('L1-14/OA01 official0359 duplicate409 preserves pending identity/password; no fabricated user and original confirmation still works', async () => {
  const env = await context(); expect(env.authVariant).toBe('stock');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  const input = { email: `official-pending-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` }, replacement = `Fixture-${randomUUID()}-Aa1!`;
  let requests = 0;
  const sdk = createClient(env.trailUrl, undefined, { trailbase: officialAuthMapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => { if (new URL(String(url)).pathname.endsWith('/register')) requests++; return fetch(url, { ...init, signal: AbortSignal.timeout(10000) }); } } });
  const identity = () => main.prepare('SELECT * FROM _user WHERE unverified_email = ? OR email = ? ORDER BY id').all(input.email, input.email);
  await withCleanup(async () => {
    expect(await sdk.auth.signUp(input)).toEqual({ data: { user: null, session: null }, error: null });
    const pending = identity(); expect(pending).toHaveLength(1);
    const duplicate = await sdk.auth.signUp({ ...input, password: replacement });
    expect(duplicate.error?.status).toBe(409); expect(duplicate.data).toEqual({ user: null, session: null }); expect(requests).toBe(2);
    expect(identity()).toEqual(pending); expect((await sdk.auth.getSession()).data.session).toBeNull();
    expect((await sdk.auth.signInWithPassword(input)).error?.status).toBe(401);
    await confirmEmail(env, input.email);
    const login = await sdk.auth.signInWithPassword(input); expect(login.error).toBeNull(); expect(login.data.user?.email).toBe(input.email);
    expect((await sdk.auth.signInWithPassword({ ...input, password: replacement })).error?.status).toBe(401);
    expect((await sdk.auth.getSession()).data.session?.user.id).toBe(login.data.user!.id);
    const confirmed = identity(); expect(confirmed).toHaveLength(1); expect(confirmed[0]).toMatchObject({ id: pending[0].id, password_hash: pending[0].password_hash, email: input.email, unverified_email: null });
  }, [async () => { expect((await sdk.auth.signOut({ scope: 'local' })).error).toBeNull(); }, async () => { main.close(); }]);
}, 60000);

it('L1-14/OA02 official0359 SMTP424 retains pending state; retry409 and resend200 are not successful recovery', async () => {
  const env = await context(); expect(env.authVariant).toBe('stock');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  const project = verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const host = (await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
  if (!host.startsWith('unix://') || process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) throw new Error('Owned SMTP fault requires local Docker');
  const container = `supabase_inbucket_${project}`;
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  const input = { email: `official-smtp-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` };
  const sdk = createClient(env.trailUrl, undefined, { trailbase: officialAuthMapping, auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) } });
  const identity = () => main.prepare('SELECT * FROM _user WHERE unverified_email = ? OR email = ? ORDER BY id').all(input.email, input.email);
  let control: Awaited<ReturnType<typeof confirmedTrailUser>> | undefined;
  await withCleanup(async () => {
    try {
      expect((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim()).toBe('true');
      await exec('docker', ['stop', '--time', '1', container], { timeout: 15000 });
      expect((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim()).toBe('false');
      const failed = await sdk.auth.signUp(input); expect(failed.error?.status).toBe(424); expect(failed.data).toEqual({ user: null, session: null });
    } finally {
      await exec('docker', ['start', container], { timeout: 15000 }); await waitReady(`${env.mailUrl}/api/v1/messages`, 10000);
    }
    const pending = identity(); expect(pending).toHaveLength(1); expect(pending[0]).toMatchObject({ email: null, unverified_email: input.email });
    const retry = await sdk.auth.signUp(input); expect(retry.error?.status).toBe(409); expect(retry.data).toEqual({ user: null, session: null }); expect(identity()).toEqual(pending);
    const resend = await fetch(new URL(`/api/auth/v1/verify_email/trigger?email=${encodeURIComponent(input.email)}`, env.trailUrl), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    expect(resend.status).toBe(200); await resend.body?.cancel(); expect(identity()).toEqual(pending);
    control = await confirmedTrailUser(env, 'official-smtp-control'); // Genuine delivered confirmation/login is the correlated healthy-mail barrier.
    const mail = await fetch(`${env.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${input.email}`)}`, { signal: AbortSignal.timeout(10000) });
    expect(mail.ok).toBe(true); expect((await mail.json()).messages).toHaveLength(0);
    expect((await sdk.auth.signInWithPassword(input)).error?.status).toBe(401); expect((await sdk.auth.getSession()).data.session).toBeNull(); expect(identity()).toEqual(pending);
  }, [async () => { if (control) await control.client.logout(); }, async () => { expect((await sdk.auth.signOut({ scope: 'local' })).error).toBeNull(); }, async () => { main.close(); }]);
  // The unrecovered pending identity is intentionally not repaired; unconditional owned-fixture teardown removes it.
}, 60000);

it('L1-19/OA03/OGL04 official0359 invalid401 and authenticated explicit303 redirect are not SDK acknowledgements; complete control state preserved', async () => {
  const env = await context(); expect(env.authVariant).toBe('stock');
  const owner = await confirmedTrailUser(env, 'official-ack-owner'), sibling = await confirmedTrailUser(env, 'official-ack-control');
  const second = createClient(env.trailUrl, undefined, { trailbase: officialAuthMapping, auth: { persistSession: false, autoRefreshToken: false } });
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true }), sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const ownerId = Buffer.from(owner.user.id, 'base64url'), siblingId = Buffer.from(sibling.user.id, 'base64url');
  const ownerSessions = () => sessions.prepare('SELECT * FROM _session WHERE user = ? ORDER BY id').all(ownerId);
  const siblingSessions = () => sessions.prepare('SELECT * FROM _session WHERE user = ? ORDER BY id').all(siblingId);
  const statements = { users: main.prepare('SELECT * FROM _user ORDER BY id'), rows: main.prepare('SELECT * FROM todos ORDER BY id'), audit: main.prepare('SELECT * FROM todo_audit ORDER BY audit_key') };
  // The full stock suite retains genuine unsafe-integer fixtures: compare exact SQLite values, never coerce or omit those rows.
  for (const statement of Object.values(statements)) statement.setReadBigInts(true);
  const snapshot = () => ({ users: statements.users.all(), rows: statements.rows.all(), audit: statements.audit.all() });
  const target = new URL('/api/health', env.trailUrl).href, url = new URL(`/api/auth/v1/logout?redirect_uri=${encodeURIComponent(target)}`, env.trailUrl);
  const logout = (token?: string) => fetch(url, { credentials: 'omit', redirect: 'manual', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(10000) });
  const ids = [nativeUuid(randomUUID()), nativeUuid(randomUUID())];
  await withCleanup(async () => {
    const login = await second.auth.signInWithPassword({ email: owner.email, password: owner.password }); expect(login.error).toBeNull();
    for (const [index, user] of [owner, sibling].entries()) await user.client.records('todos').create({ id: ids[index], user_id: user.user.id, title: `official-ack-${randomUUID()}` });
    const before = snapshot(), completeBefore = nativeAuthSnapshot(main, sessions), ownBefore = ownerSessions(), controlBefore = siblingSessions(); expect(ownBefore).toHaveLength(2); expect(controlBefore).toHaveLength(1);
    for (const token of [undefined, 'invalid-not-a-jwt']) {
      const response = await logout(token); expect(response.status).toBe(401); expect(response.headers.get('location')).toBeNull(); await response.body?.cancel();
      expect(ownerSessions()).toEqual(ownBefore); expect(siblingSessions()).toEqual(controlBefore); expect(snapshot()).toEqual(before); expect(nativeAuthSnapshot(main, sessions)).toEqual(completeBefore);
    }
    const response = await logout(login.data.session!.access_token); expect(response.status).toBe(303); expect(response.headers.get('location')).toBe(target); await response.body?.cancel();
    expect(ownerSessions()).toEqual([]); expect(siblingSessions()).toEqual(controlBefore); expect(snapshot()).toEqual(before);
    expect(nativeAuthSnapshot(main, sessions)).toEqual({ ...completeBefore, sessions: completeBefore.sessions.filter(row => !(row.user instanceof Uint8Array && ownerId.equals(row.user))) });
    for (const token of [owner.client.tokens()!.refresh_token!, login.data.session!.refresh_token]) {
      const refresh = await fetch(new URL('/api/auth/v1/refresh', env.trailUrl), { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: token }), signal: AbortSignal.timeout(10000) });
      expect(refresh.status).toBe(401); await refresh.body?.cancel();
    }
    const residual = await fetch(new URL('/api/records/v1/todos?limit=1&skip_cursor=true', env.trailUrl), { headers: { authorization: `Bearer ${login.data.session!.access_token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    expect(residual.status).toBe(200); await residual.body?.cancel(); expect(snapshot()).toEqual(before);
  }, [
    async () => { await cleanupOfficialAuthOwner(env, owner, ids[0]); },
    async () => { await cleanupOfficialAuthOwner(env, sibling, ids[1]); },
    async () => { expect((await second.auth.signOut({ scope: 'local' })).error).toBeNull(); expect(ownerSessions()).toEqual([]); expect(siblingSessions()).toEqual([]); },
    async () => { main.close(); sessions.close(); },
  ]);
}, 60000);

it('L1-19/OGL04–05 genuine native DELETE abort fully rolls back; zero-dispatch failure and fresh recovery cannot fabricate acknowledgement', async () => {
  const env = await context(); expect(env.authVariant).toBe('stock'); expect(env.nativeAuthProfile).toBe('default');
  const owner = await confirmedTrailUser(env, 'ogl-fault-owner'), control = await confirmedTrailUser(env, 'ogl-fault-control');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true }), sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'));
  const ownerId = Buffer.from(owner.user.id, 'base64url'), ids = [nativeUuid(randomUUID()), nativeUuid(randomUUID())];
  const unrelatedSessions = nativeAuthSnapshot(main, sessions).sessions.filter(row => ![owner, control].some(user => row.user instanceof Uint8Array && Buffer.from(user.user.id, 'base64url').equals(row.user)));
  const trigger = `ogl_delete_${randomUUID().replaceAll('-', '')}`, key = `ogl-${randomUUID()}`, stored = new Map([['unrelated', 'keep']]);
  const storage: AuthStorage = { getItem: k => stored.get(k) ?? null, setItem: (k, v) => { stored.set(k, v); }, removeItem: k => { stored.delete(k); } };
  const a = createClient(env.trailUrl, undefined, { trailbase: officialAuthMapping, auth: { persistSession: true, autoRefreshToken: false, storage, storageKey: key } });
  let created = false;
  const primaryFailure = new Error('Owned primary failure after completed native assertions');
  await expect(withCleanup(async () => {
    for (const [index, user] of [owner, control].entries()) await user.client.records('todos').create({ id: ids[index], user_id: user.user.id, title: `OGL-${randomUUID()}` });
    expect((await a.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
    const before = nativeAuthSnapshot(main, sessions), schema = sessions.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    expect(before.sessions.filter(row => row.user instanceof Uint8Array && ownerId.equals(row.user))).toHaveLength(2);
    sessions.exec(`CREATE TRIGGER ${trigger} BEFORE DELETE ON _session WHEN OLD.user=X'${ownerId.toString('hex')}' BEGIN SELECT RAISE(ABORT,'owned-global-delete-fault'); END`); created = true;
    const failed = await a.auth.signOut(); expect(failed.error?.status).toBe(400); expect(nativeAuthSnapshot(main, sessions)).toEqual(before);
    expect((await a.auth.getSession()).data.session).toBeNull(); expect(stored.has(key)).toBe(false); expect(stored.get('unrelated')).toBe('keep');
    sessions.exec(`DROP TRIGGER ${trigger}`); created = false; expect(sessions.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    let attempts = 0;
    stored.set(key, JSON.stringify({ version: 1, tokens: owner.client.tokens() }));
    const beforeDispatch = createClient(env.trailUrl, undefined, { trailbase: officialAuthMapping, auth: { persistSession: true, autoRefreshToken: false, storage, storageKey: key }, global: { fetch: async () => { attempts++; throw Error('private-before-dispatch'); } } });
    expect((await beforeDispatch.auth.signOut()).error?.name).toBe('AuthSignOutRequestError'); expect(attempts).toBe(1); expect(nativeAuthSnapshot(main, sessions)).toEqual(before); expect(stored.has(key)).toBe(false);
    expect((await a.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull(); const recoveryBefore = nativeAuthSnapshot(main, sessions);
    expect(await a.auth.signOut({ scope: 'global' })).toEqual({ error: null });
    expect(nativeAuthSnapshot(main, sessions)).toEqual({ ...recoveryBefore, sessions: recoveryBefore.sessions.filter(row => !(row.user instanceof Uint8Array && ownerId.equals(row.user))) });
    throw primaryFailure; // Explicitly exercise complete cleanup while retaining the original failure.
  }, [
    async () => { if (created) { sessions.exec(`DROP TRIGGER ${trigger}`); created = false; } },
    ...[owner, control].map((user, index) => async () => { await cleanupOfficialAuthOwner(env, user, ids[index]); }),
    async () => { expect((await a.auth.signOut({ scope: 'local' })).error).toBeNull(); expect(stored.get('unrelated')).toBe('keep'); },
    async () => { expect(nativeAuthSnapshot(main, sessions).sessions).toEqual(unrelatedSessions); },
    async () => { sessions.close(); main.close(); },
  ])).rejects.toBe(primaryFailure);
}, 120000);

it('L1-19/OGL03/OGL05 real0359 receipt bytes fragment, drop, truncate or disconnect after DELETE; no replay and complete unrelated-owner preservation', async () => {
  const env = await context(); expect(env.authVariant).toBe('stock'); expect(env.nativeAuthProfile).toBe('default');
  const owner = await confirmedTrailUser(env, 'ogl-wire-owner'), control = await confirmedTrailUser(env, 'ogl-wire-control');
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true }), sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  const ownerId = Buffer.from(owner.user.id, 'base64url'), ids = [nativeUuid(randomUUID()), nativeUuid(randomUUID())];
  const unrelatedSessions = nativeAuthSnapshot(main, sessions).sessions.filter(row => ![owner, control].some(user => row.user instanceof Uint8Array && Buffer.from(user.user.id, 'base64url').equals(row.user)));
  const second = createClient(env.trailUrl, undefined, { trailbase: officialAuthMapping, auth: { persistSession: false, autoRefreshToken: false } });
  await withCleanup(async () => {
    for (const [index, user] of [owner, control].entries()) await user.client.records('todos').create({ id: ids[index], user_id: user.user.id, title: `OGL-wire-${randomUUID()}` });
    for (const mode of ['fragment', 'drop', 'truncate', 'disconnect'] as const) {
      await owner.client.login(owner.email, owner.password); expect((await second.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
      const before = nativeAuthSnapshot(main, sessions), secondBefore = await second.auth.getSession(), tokens = owner.client.tokens()!;
      const expected = { ...before, sessions: before.sessions.filter(row => !(row.user instanceof Uint8Array && ownerId.equals(row.user))) };
      expect(before.sessions.filter(row => row.user instanceof Uint8Array && ownerId.equals(row.user))).toHaveLength(mode === 'fragment' ? 3 : 2);
      let upstream = 0, downstream = 0, completed = false, upstreamFailure: unknown; const events: string[] = [];
      const fixture = await httpStreamFixture(async signal => {
        upstream++;
        try {
          const actual = await fetch(new URL('/api/auth/v1/logout', env.trailUrl), { method: 'GET', credentials: 'omit', redirect: 'manual', headers: { authorization: `Bearer ${tokens.auth_token}`, 'content-type': 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
          expect(actual.status).toBe(200); expect(actual.headers.get('location')).toBeNull(); expect(await actual.clone().text()).toBe('logged out');
          expect(nativeAuthSnapshot(main, sessions)).toEqual(expected); completed = true; return actual;
        } catch (error) { upstreamFailure = error; throw error; }
      }, mode, '/api/auth/v1/logout');
      const origin = new URL(fixture.url).origin, key = `ogl-wire-${randomUUID()}`, stored = new Map([['unrelated', 'keep'], [key, JSON.stringify({ version: 1, tokens })]]);
      const storage: AuthStorage = { getItem: k => stored.get(k) ?? null, setItem: (k, v) => { stored.set(k, v); }, removeItem: k => { stored.delete(k); } };
      // Owned loopback fault proxy is the configured origin, not a foreign redirect or product gateway.
      // It forwards actual verified native bytes/status/MIME and never exposes upstream auth/cookies.
      const a = createClient(origin, undefined, { trailbase: officialAuthMapping, auth: { persistSession: true, autoRefreshToken: false, storage, storageKey: key }, global: { fetch: async (input, init) => {
        downstream++; expect(String(input)).toBe(fixture.url); expect(init?.method).toBe('GET'); expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('manual');
        expect([...new Headers(init?.headers)]).toEqual([['authorization', `Bearer ${tokens.auth_token}`], ['content-type', 'application/json']]); return fetch(input, init);
      } } });
      const subscription = a.auth.onAuthStateChange(event => events.push(event)).data.subscription;
      try {
        expect((await a.auth.getSession()).data.session?.user.id).toBe(canonicalUuid(owner.user.id));
        const result = await a.auth.signOut(); await fixture.idle();
        if (upstreamFailure) throw upstreamFailure;
        expect(completed).toBe(true);
        if (mode === 'fragment') expect(result).toEqual({ error: null });
        else expect(result.error, `OGL ${mode} must not acknowledge`).not.toBeNull();
        expect(downstream).toBe(1); expect(upstream).toBe(1); expect(stored.has(key)).toBe(false); expect(stored.get('unrelated')).toBe('keep'); expect(events).toEqual(['INITIAL_SESSION', 'SIGNED_OUT']);
        expect((await a.auth.getSession()).data.session).toBeNull(); expect(nativeAuthSnapshot(main, sessions)).toEqual(expected); expect(await second.auth.getSession()).toEqual(secondBefore);
        const refresh = await fetch(new URL('/api/auth/v1/refresh', env.trailUrl), { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: tokens.refresh_token }), signal: AbortSignal.timeout(10000) });
        expect(refresh.status).toBe(401); await refresh.body?.cancel();
        const residual = await fetch(new URL('/api/records/v1/todos?skip_cursor=true', env.trailUrl), { credentials: 'omit', redirect: 'error', headers: { authorization: `Bearer ${tokens.auth_token}` }, signal: AbortSignal.timeout(10000) }); expect(residual.status).toBe(200); await residual.body?.cancel();
        await fixture.idle(); expect(fixture.stats()).toMatchObject({ active: 0, bytesWritten: mode === 'fragment' ? 10 : mode === 'drop' ? 0 : 5 });
      } finally {
        subscription.unsubscribe(); await fixture.close(); expect(fixture.stats()).toMatchObject({ active: 0, listening: false });
      }
    }
  }, [
    ...[owner, control].map((user, index) => async () => { await cleanupOfficialAuthOwner(env, user, ids[index]); }),
    async () => { expect((await second.auth.signOut({ scope: 'local' })).error).toBeNull(); },
    async () => { expect(nativeAuthSnapshot(main, sessions).sessions).toEqual(unrelatedSessions); },
    async () => { sessions.close(); main.close(); },
  ]);
}, 120000);
