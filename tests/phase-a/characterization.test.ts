import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { FetchError } from 'trailbase';
import { context, confirmedTrailUser, confirmedSupabaseUser, nativeUuid, supabase, trailbase, confirmEmail, type Context } from './helpers.js';

let env: Context;
beforeAll(async () => { env = await context(); });
describe('L1-27 upstream characterization; G1-G7 still require approval', () => {
  it('G1 native signup supplies no user/session; both backends require real mail confirmation', async () => {
    const password = `Fixture-${randomUUID()}-Aa1!`;
    const te = `signup-native-${randomUUID()}@example.test`;
    const native = trailbase(env);
    expect(await native.register({ email: te, password })).toBeUndefined();
    expect(native.user()).toBeUndefined(); expect(native.tokens()).toBeUndefined();
    await expect(native.login(te,password)).rejects.toBeDefined();
    await confirmEmail(env,te);
    await native.login(te,password);
    expect(native.user()?.email).toBe(te);
    const se = `signup-reference-${randomUUID()}@example.test`;
    const reference = supabase(env);
    const signup = await reference.auth.signUp({ email: se, password });
    expect(signup.error === null).toBe(true); expect(signup.data.session).toBeNull();
    expect(Boolean(signup.data.user?.id)).toBe(true);
    expect((await reference.auth.signInWithPassword({ email: se, password })).error !== null).toBe(true);
    await confirmEmail(env,se);
    expect((await reference.auth.signInWithPassword({ email: se, password })).error === null).toBe(true);
    expect((await reference.auth.getUser()).data.user?.email).toBe(se);
  });
  it('G1/S04 native confirmed duplicate signup is opaque, preserves credentials, and creates no session', async () => {
    const account = await confirmedTrailUser(env,'duplicate');
    const visitor = trailbase(env), replacement = `Fixture-${randomUUID()}-Aa1!`;
    expect(await visitor.register({ email:account.email, password:replacement })).toBeUndefined();
    expect(visitor.user()).toBeUndefined(); expect(visitor.tokens()).toBeUndefined();
    await expect(visitor.login(account.email,replacement)).rejects.toBeDefined();
    expect(visitor.user()).toBeUndefined(); expect(visitor.tokens()).toBeUndefined();
    await visitor.login(account.email,account.password);
    expect(visitor.user()?.id).toBe(account.user.id);
    const wrong = trailbase(env), unknown = trailbase(env);
    const failure = async (client: typeof wrong, email: string) => {
      try { await client.login(email,replacement); throw new Error('Unexpected authenticated invalid login'); }
      catch(error) {
        // Compare only the observable error contract, never persist credentials/backend replies.
        if (!(error instanceof FetchError)) throw error;
        return { status:error.status, message:error.message };
      }
    };
    const denied = await failure(wrong,account.email);
    expect(denied.status).toBe(401);
    expect(await failure(unknown,`unknown-${randomUUID()}@example.test`)).toEqual(denied);
    expect(wrong.tokens()).toBeUndefined(); expect(unknown.tokens()).toBeUndefined();
    expect((await account.client.fetch('/api/auth/v1/status')).ok).toBe(true);
  });
  it('G1/S04 reference confirmed duplicate signup obscures identity and invalid logins leave no session', async () => {
    const account = await confirmedSupabaseUser(env,'duplicate');
    const visitor = supabase(env), replacement = `Fixture-${randomUUID()}-Aa1!`;
    const phoneDisabled = await visitor.auth.signUp({ phone:'+15555550100',password:replacement });
    expect(phoneDisabled.error?.code).toBe('phone_provider_disabled');
    const duplicate = await visitor.auth.signUp({ email:account.email,password:replacement });
    expect(duplicate.error).toBeNull(); expect(duplicate.data.session).toBeNull();
    expect(duplicate.data.user?.id).not.toBe(account.user.id);
    expect(duplicate.data.user?.identities).toEqual([]);
    expect((await visitor.auth.getSession()).data.session).toBeNull();
    const wrong = await visitor.auth.signInWithPassword({ email:account.email,password:replacement });
    const unknown = await visitor.auth.signInWithPassword({ email:`unknown-${randomUUID()}@example.test`,password:replacement });
    expect(wrong.error?.status).toBe(400);
    expect({code:unknown.error?.code,status:unknown.error?.status,message:unknown.error?.message}).toEqual({code:wrong.error?.code,status:wrong.error?.status,message:wrong.error?.message});
    expect((await visitor.auth.getSession()).data.session).toBeNull();
    const valid = await visitor.auth.signInWithPassword({ email:account.email,password:account.password });
    expect(valid.error).toBeNull(); expect(valid.data.user?.id).toBe(account.user.id);
  });
  it('G2 installed native list defaults to 50, native limit(0) omits limit, and aligned cap is 1000', async () => {
    const native = await confirmedTrailUser(env,'pages');
    const api = native.client.records('todos');
    // Bulk setup uses ordinary owner credentials; it is not a proposed SDK bulk-write API.
    for (let start = 0; start < 1001; start += 20) {
      await Promise.all(Array.from({ length: Math.min(20,1001-start) }, (_,i) => api.create({
        id: nativeUuid(randomUUID()), user_id: native.user.id, title: `page-${env.id}-${start+i}`, priority: start+i
      })));
    }
    expect((await api.list()).records).toHaveLength(50);
    expect((await api.list({ pagination: { limit: 0 } })).records).toHaveLength(50);
    const zero = await native.client.fetch('/api/records/v1/todos?limit=0').then(response => response.json());
    expect(zero.records).toHaveLength(0);
    expect((await api.list({ pagination: { limit: 1000 } })).records).toHaveLength(1000);
    await expect(api.list({ filters: [{ column: 'typo_column', value: 'x' }] })).rejects.toBeDefined();
    const bounded = await api.list({ filters: [{ column: 'priority', op: 'greaterThanEqual', value: '10' },{ column: 'priority', op: 'lessThanEqual', value: '12' }], order: ['+priority'] });
    expect(bounded.records.map(row => row.priority)).toEqual([10,11,12]);
  });
  it('G2/G4 reference ranges/caps/zero/cardinality and repeated builder awaits are characterized', async () => {
    const reference = await confirmedSupabaseUser(env,'pages');
    const rows = Array.from({ length: 1001 }, (_,i) => ({ id: randomUUID(), user_id: reference.user.id, title: `reference-page-${env.id}-${i}`, priority: i }));
    expect((await reference.client.from('todos').insert(rows)).error === null).toBe(true);
    expect((await reference.client.from('todos').select('*')).data?.length).toBe(1000);
    expect((await reference.client.from('todos').select('*').limit(0)).data).toEqual([]);
    const range = await reference.client.from('todos').select('priority').order('priority').range(1,3);
    expect(range.data?.map(row => row.priority)).toEqual([1,2,3]);
    expect((await reference.client.from('todos').select('*').single()).error !== null).toBe(true);
    expect((await reference.client.from('todos').select('*').eq('priority',-1).maybeSingle()).data).toBeNull();
    expect((await reference.client.from('todos').select('*').order('priority').limit(1).single()).data?.priority).toBe(0);
    const mutation = reference.client.from('todos').insert({ id: randomUUID(), user_id: reference.user.id, title: `repeat-${randomUUID()}`, priority: 2000 });
    expect((await mutation).error === null).toBe(true);
    expect((await mutation).error !== null).toBe(true); // A second await executes the insert again; duplicate key proves it.
    expect((await reference.client.from('todos').select('priority').order('priority').limit(1).range(1,3)).data?.map(row => row.priority)).toEqual([1,2,3]);
    expect((await reference.client.from('todos').select('priority').order('priority').range(1,3).limit(1)).data?.map(row => row.priority)).toEqual([1]);
  });
  it('G3 native missing writes error; reference missing writes succeed without modifying another row', async () => {
    const native = await confirmedTrailUser(env,'missing');
    const reference = await confirmedSupabaseUser(env,'missing');
    const missing = randomUUID(), control = randomUUID();
    await native.client.records('todos').create({ id: nativeUuid(control), user_id: native.user.id, title: `control-native-${control}` });
    expect((await reference.client.from('todos').insert({ id: control, user_id: reference.user.id, title: `control-reference-${control}` })).error === null).toBe(true);
    await expect(native.client.records('todos').update(nativeUuid(missing),{ title: 'missing' })).rejects.toBeDefined();
    await expect(native.client.records('todos').delete(nativeUuid(missing))).rejects.toBeDefined();
    expect((await reference.client.from('todos').update({ title: 'missing' }).eq('id',missing)).error).toBeNull();
    expect((await reference.client.from('todos').delete().eq('id',missing)).error).toBeNull();
    expect((await native.client.records('todos').read(nativeUuid(control))).title).toBe(`control-native-${control}`);
    expect((await reference.client.from('todos').select('*').eq('id',control).single()).data?.title).toBe(`control-reference-${control}`);
  });
  it('G7 native validated status, retained refresh token and explicit local/global revocation across two sessions', async () => {
    const first = await confirmedTrailUser(env,'sessions');
    const second = trailbase(env);
    await second.login(first.email, first.password);
    const t1 = first.client.tokens()!, t2 = second.tokens()!;
    const status = await first.client.fetch('/api/auth/v1/status').then(response => response.json());
    expect(typeof status.auth_token).toBe('string');
    expect(await first.client.refreshAuthToken({ force: true })).toBe(true);
    expect(first.client.tokens()?.refresh_token === t1.refresh_token).toBe(true);
    const refresh = (token: string) => fetch(`${env.trailUrl}/api/auth/v1/refresh`, { method:'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ refresh_token: token }) });
    await first.client.fetch('/api/auth/v1/logout', { method:'POST', body: JSON.stringify({ refresh_token: t1.refresh_token }) });
    expect((await refresh(t1.refresh_token!)).ok).toBe(false);
    expect((await refresh(t2.refresh_token!)).ok).toBe(true);
    const third = trailbase(env);
    await third.login(first.email,first.password);
    const t3 = third.tokens()!;
    expect((await refresh(t3.refresh_token!)).ok).toBe(true); // Two independently live sessions before global logout.
    const loggedOut = await second.fetch('/api/auth/v1/logout', { redirect:'manual', throwOnError:false });
    expect([302,303].includes(loggedOut.status)).toBe(true);
    expect((await refresh(t2.refresh_token!)).ok).toBe(false);
    expect((await refresh(t3.refresh_token!)).ok).toBe(false);
    // Deleting refresh sessions does not instantly revoke a valid stateless access JWT.
    const residual = await fetch(`${env.trailUrl}/api/records/v1/todos`, { headers:{ authorization:`Bearer ${t2.auth_token}` } });
    expect(residual.ok).toBe(true);
  });
  it('G7 reference default logout is global; explicit local scope preserves the other refresh session', async () => {
    const first = await confirmedSupabaseUser(env,'sessions');
    const second = supabase(env);
    const login = await second.auth.signInWithPassword({ email:first.email, password:first.password });
    expect(login.error === null).toBe(true);
    const one = (await first.client.auth.getSession()).data.session!;
    const two = login.data.session!;
    expect((await first.client.auth.signOut({ scope:'local' })).error).toBeNull();
    expect((await first.client.auth.refreshSession({ refresh_token:one.refresh_token })).error !== null).toBe(true);
    expect((await second.auth.refreshSession({ refresh_token:two.refresh_token })).error).toBeNull();
    expect((await first.client.auth.signInWithPassword({ email:first.email, password:first.password })).error).toBeNull();
    const renewed = (await second.auth.getSession()).data.session!;
    const freshFirst = (await first.client.auth.getSession()).data.session!;
    expect((await first.client.auth.signOut()).error).toBeNull();
    expect((await first.client.auth.refreshSession({ refresh_token:freshFirst.refresh_token })).error !== null).toBe(true);
    expect((await second.auth.refreshSession({ refresh_token:renewed.refresh_token })).error !== null).toBe(true);
  });
});
