import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type AuthStorage } from '../../src/index.js';
import { context, confirmEmail, supabase, nativeUuid } from './helpers.js';
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
  // The backend harness owns identities/sessions; slice1 signOut is deliberately unsupported.
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
