import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type AuthStorage } from '../../src/index.js';
import { context, confirmEmail, supabase, nativeUuid, canonicalUuid, confirmedTrailUser, confirmedSupabaseUser } from './helpers.js';
import { cleanupOwnedRows, withCleanup } from '../sdk-browser/cleanup.js';

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

it('L1-19/I19/C19/S08 real local/global refresh revocation, observable native global uncertainty and unchanged owner rows', async () => {
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
    const globalSession = await a.auth.signInWithPassword(credentials); expect(globalSession.error).toBeNull();
    expect((await a.auth.signOut()).error?.name).toBe('AuthGlobalSignOutUnconfirmedError');
    for (const token of [globalSession.data.session!.refresh_token, second.data.session!.refresh_token, owner.client.tokens()!.refresh_token!]) expect(await refresh(token)).toBe(401);
    expect(await refresh(control.client.tokens()!.refresh_token!)).toBe(200); expect(await snapshot()).toEqual(before);
    expect((await a.auth.getSession()).data.session).toBeNull();
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
    async () => { await cleanupOwnedRows(owner.client.records('todos'), owner.user.id, [nativeUuid(id)]); },
    async () => { await cleanupOwnedRows(control.client.records('todos'), control.user.id, [nativeUuid(controlId)]); },
    async () => { await a.auth.signOut({ scope: 'local' }); await sibling.auth.signOut({ scope: 'local' }); },
    async () => { await owner.client.logout(); await control.client.logout(); await reference.client.auth.signOut({ scope: 'local' }); },
  ]);
}, 120000);
