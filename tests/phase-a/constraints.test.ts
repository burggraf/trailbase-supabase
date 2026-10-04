import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { exec } from '../../scripts/tools.mjs';
import { cli } from '../../scripts/harness.mjs';
import { context, confirmedTrailUser, confirmedSupabaseUser, nativeUuid, supabase, trailbase, type Context } from './helpers.js';

type NativeUser=Awaited<ReturnType<typeof confirmedTrailUser>>;
type ReferenceUser=Awaited<ReturnType<typeof confirmedSupabaseUser>>;
let env:Context,a:NativeUser,b:NativeUser,sa:ReferenceUser,sb:ReferenceUser;
beforeAll(async()=>{
  env=await context();a=await confirmedTrailUser(env,'fk-a');b=await confirmedTrailUser(env,'fk-b');
  sa=await confirmedSupabaseUser(env,'fk-a');sb=await confirmedSupabaseUser(env,'fk-b');
});
const tables=['todos','todo_links','todo_audit'] as const;
async function snapshot(user=a,reference=sa){
  const native=[],postgres=[];
  for(const table of tables){
    const key=table==='todo_audit'?'audit_key':'id';
    native.push((await user.client.records(table).list({pagination:{limit:1000},order:[`+${key}`]})).records);
    const result=await reference.client.from(table).select('*').order(key).limit(1000);
    expect(result.error).toBeNull();postgres.push(result.data);
  }
  return {native,postgres};
}
async function todo(id:string,note:string|null=null,user=a,reference=sa){
  const title=`constraints-${id}`;
  await user.client.records('todos').create({id:nativeUuid(id),user_id:user.user.id,title,note});
  const result=await reference.client.from('todos').insert({id,user_id:reference.user.id,title,note});
  expect(result.error).toBeNull();expect(result.data).toBeNull();
}
async function link(id:string,parent:string,kind:'restricted_todo_id'|'cascaded_todo_id',user=a,reference=sa){
  await user.client.records('todo_links').create({id:nativeUuid(id),user_id:user.user.id,[kind]:nativeUuid(parent),note:'before'});
  const result=await reference.client.from('todo_links').insert({id,user_id:reference.user.id,[kind]:parent,note:'before'});
  expect(result.error).toBeNull();expect(result.data).toBeNull();
}

describe('L1-27/G3/I27/C27/S03/S05 scalar FK/delete/trigger characterization, NOT SDK or relationship support',()=>{
  it('cold-start pgTAP validates link/audit grants, owner policies, FK modes and narrow trigger capability',async()=>{
    const {stdout}=await exec(cli,['test','db','--workdir',env.directory,'--agent','no'],{timeout:60000});
    expect(stdout.includes('All tests successful')||stdout.includes('PASS')).toBe(true);
  });
  it('missing-parent insert/update and RESTRICT delete reject without changing any owned rows or audit entries',async()=>{
    const parent=randomUUID(),control=randomUUID(),child=randomUUID(),missing=randomUUID();
    await todo(parent);await todo(control);await link(child,parent,'restricted_todo_id');
    const before=await snapshot();
    await expect(a.client.records('todo_links').create({id:nativeUuid(randomUUID()),user_id:a.user.id,restricted_todo_id:nativeUuid(missing),note:'must not insert'})).rejects.toMatchObject({status:400});
    const insert=await sa.client.from('todo_links').insert({id:randomUUID(),user_id:sa.user.id,restricted_todo_id:missing,note:'must not insert'});
    expect(insert.status).toBe(409);expect(insert.error?.code).toBe('23503');expect(insert.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    await expect(a.client.records('todo_links').update(nativeUuid(child),{restricted_todo_id:nativeUuid(missing),note:'must roll back'})).rejects.toMatchObject({status:500});
    const update=await sa.client.from('todo_links').update({restricted_todo_id:missing,note:'must roll back'}).eq('id',child);
    expect(update.status).toBe(409);expect(update.error?.code).toBe('23503');expect(update.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    await expect(a.client.records('todos').delete(nativeUuid(parent))).rejects.toMatchObject({status:400});
    const removed=await sa.client.from('todos').delete().eq('id',parent);
    expect(removed.status).toBe(409);expect(removed.error?.code).toBe('23503');expect(removed.data).toBeNull();
    expect(await snapshot()).toEqual(before);
  });
  it('configured CASCADE removes same/foreign-owner dependent rows only after an authorized parent delete',async()=>{
    const parent=randomUUID(),control=randomUUID(),own=randomUUID(),foreign=randomUUID(),survivor=randomUUID();
    await todo(parent);await todo(control,'control',b,sb);
    await link(own,parent,'cascaded_todo_id');await link(foreign,parent,'cascaded_todo_id',b,sb);await link(survivor,control,'cascaded_todo_id',b,sb);
    const beforeA=await snapshot(),beforeB=await snapshot(b,sb);
    await expect(b.client.records('todos').delete(nativeUuid(parent))).rejects.toMatchObject({status:403});
    const denied=await sb.client.from('todos').delete().eq('id',parent);
    expect(denied.status).toBe(204);expect(denied.error).toBeNull();expect(denied.data).toBeNull();
    expect(await snapshot()).toEqual(beforeA);expect(await snapshot(b,sb)).toEqual(beforeB);
    await a.client.records('todos').delete(nativeUuid(parent));
    const deleted=await sa.client.from('todos').delete().eq('id',parent);
    expect(deleted.status).toBe(204);expect(deleted.error).toBeNull();expect(deleted.data).toBeNull();
    for(const [user,reference,id] of [[a,sa,own],[b,sb,foreign]] as const){
      expect((await user.client.records('todo_links').list({filters:[{column:'id',op:'equal',value:nativeUuid(id)}]})).records).toEqual([]);
      const absent=await reference.client.from('todo_links').select('*').eq('id',id);
      expect(absent.error).toBeNull();expect(absent.data).toEqual([]);
    }
    expect((await a.client.records('todos').list({filters:[{column:'id',op:'equal',value:nativeUuid(parent)}]})).records).toEqual([]);
    const absent=await sa.client.from('todos').select('*').eq('id',parent);expect(absent.error).toBeNull();expect(absent.data).toEqual([]);
    expect(await b.client.records('todos').read(nativeUuid(control))).toEqual(beforeB.native[0]!.find(row=>row.id===nativeUuid(control)));
    expect(await b.client.records('todo_links').read(nativeUuid(survivor))).toEqual(beforeB.native[1]!.find(row=>row.id===nativeUuid(survivor)));
    const afterA=await snapshot(),afterB=await snapshot(b,sb);
    expect(afterA.native[0]).toEqual(beforeA.native[0]!.filter(row=>row.id!==nativeUuid(parent)));
    expect(afterA.native[1]).toEqual(beforeA.native[1]!.filter(row=>row.id!==nativeUuid(own)));
    expect(afterA.postgres[0]).toEqual(beforeA.postgres[0]!.filter(row=>row.id!==parent));
    expect(afterA.postgres[1]).toEqual(beforeA.postgres[1]!.filter(row=>row.id!==own));
    expect(afterA.native[2]!.length).toBe(beforeA.native[2]!.length+1);
    expect(afterA.postgres[2]!.length).toBe(beforeA.postgres[2]!.length+1);
    expect(afterB.postgres[0]).toEqual(beforeB.postgres[0]);
    expect(afterB.postgres[1]).toEqual(beforeB.postgres[1]!.filter(row=>row.id!==foreign));
    expect(afterB.native[2]).toEqual(beforeB.native[2]);expect(afterB.postgres[2]).toEqual(beforeB.postgres[2]);
    // Raw configured DB referential action, not authorization to directly mutate B's row.
  });
  it('trigger-rejected insert/update/delete roll back complete data and audit rows',async()=>{
    const target=randomUUID(),control=randomUUID(),deleteBlocked=randomUUID(),failed=randomUUID();
    await todo(target);await todo(control);await todo(deleteBlocked,'phase-a-delete-reject');
    const before=await snapshot();
    await expect(a.client.records('todos').create({id:nativeUuid(failed),user_id:a.user.id,title:`constraints-${failed}`,note:'phase-a-trigger-reject'})).rejects.toMatchObject({status:400});
    const insert=await sa.client.from('todos').insert({id:failed,user_id:sa.user.id,title:`constraints-${failed}`,note:'phase-a-trigger-reject'});
    expect(insert.status).toBe(400);expect(insert.error?.code).toBe('P0001');expect(insert.data).toBeNull();expect(await snapshot()).toEqual(before);
    await expect(a.client.records('todos').update(nativeUuid(target),{note:'phase-a-trigger-reject',priority:7})).rejects.toMatchObject({status:500});
    const update=await sa.client.from('todos').update({note:'phase-a-trigger-reject',priority:7}).eq('id',target);
    expect(update.status).toBe(400);expect(update.error?.code).toBe('P0001');expect(update.data).toBeNull();expect(await snapshot()).toEqual(before);
    await expect(a.client.records('todos').delete(nativeUuid(deleteBlocked))).rejects.toMatchObject({status:400});
    const removed=await sa.client.from('todos').delete().eq('id',deleteBlocked);
    expect(removed.status).toBe(400);expect(removed.error?.code).toBe('P0001');expect(removed.data).toBeNull();expect(await snapshot()).toEqual(before);
    // Postgres identity allocation can advance on rollback; row equality is not sequence equality.
  });
  it('successful ordinary-user INSERT/UPDATE/DELETE produce exactly their owner-scoped audit entries',async()=>{
    const id=randomUUID(),before=await snapshot();
    await todo(id);await a.client.records('todos').update(nativeUuid(id),{note:'after'});
    const updated=await sa.client.from('todos').update({note:'after'}).eq('id',id);expect(updated.error).toBeNull();expect(updated.data).toBeNull();
    await a.client.records('todos').delete(nativeUuid(id));
    const removed=await sa.client.from('todos').delete().eq('id',id);expect(removed.error).toBeNull();expect(removed.data).toBeNull();
    const after=await snapshot();
    expect(after.native[0]).toEqual(before.native[0]);expect(after.postgres[0]).toEqual(before.postgres[0]);
    expect(after.native[1]).toEqual(before.native[1]);expect(after.postgres[1]).toEqual(before.postgres[1]);
    expect(after.native[2]!.length).toBe(before.native[2]!.length+3);expect(after.postgres[2]!.length).toBe(before.postgres[2]!.length+3);
    expect(after.native[2]!.filter(row=>row.todo_id===nativeUuid(id)).map(row=>row.operation)).toEqual(['INSERT','UPDATE','DELETE']);
    expect(after.postgres[2]!.filter(row=>row.todo_id===id).map(row=>row.operation)).toEqual(['INSERT','UPDATE','DELETE']);
  });
  it('anonymous/foreign/reassignment and direct audit writes cannot alter data or audit history',async()=>{
    const parent=randomUUID(),child=randomUUID();await todo(parent);await link(child,parent,'restricted_todo_id');
    const beforeA=await snapshot(),beforeB=await snapshot(b,sb);
    for(const table of ['todo_links','todo_audit']){
      await expect(trailbase(env).records(table).list()).rejects.toMatchObject({status:403});
      const anonymous=await supabase(env).from(table).select('*');expect(anonymous.error?.code).toBe('42501');expect(anonymous.data).toBeNull();
    }
    await expect(b.client.records('todo_links').update(nativeUuid(child),{note:'stolen'})).rejects.toMatchObject({status:403});
    await expect(b.client.records('todo_links').delete(nativeUuid(child))).rejects.toMatchObject({status:403});
    const hidden=await sb.client.from('todo_links').update({note:'stolen'}).eq('id',child);expect(hidden.status).toBe(204);expect(hidden.error).toBeNull();expect(hidden.data).toBeNull();
    const removed=await sb.client.from('todo_links').delete().eq('id',child);expect(removed.status).toBe(204);expect(removed.error).toBeNull();expect(removed.data).toBeNull();
    await expect(a.client.records('todo_links').update(nativeUuid(child),{user_id:b.user.id})).rejects.toMatchObject({status:403});
    const reassigned=await sa.client.from('todo_links').update({user_id:sb.user.id}).eq('id',child);expect(reassigned.error?.code).toBe('42501');expect(reassigned.data).toBeNull();
    const nativeKey=Number(beforeA.native[2]![0]!.audit_key),referenceKey=beforeA.postgres[2]![0]!.audit_key;
    await expect(a.client.records('todo_audit').create({audit_key:99999,todo_id:nativeUuid(parent),user_id:a.user.id,operation:'INSERT'})).rejects.toMatchObject({status:403});
    await expect(a.client.records('todo_audit').update(nativeKey,{operation:'DELETE'})).rejects.toMatchObject({status:403});
    await expect(a.client.records('todo_audit').delete(nativeKey)).rejects.toMatchObject({status:403});
    const writes=[await sa.client.from('todo_audit').insert({todo_id:parent,user_id:sa.user.id,operation:'INSERT'}),await sa.client.from('todo_audit').update({operation:'DELETE'}).eq('audit_key',referenceKey),await sa.client.from('todo_audit').delete().eq('audit_key',referenceKey)];
    for(const result of writes){expect(result.error?.code).toBe('42501');expect(result.data).toBeNull();}
    expect(await snapshot()).toEqual(beforeA);expect(await snapshot(b,sb)).toEqual(beforeB);
  });
});
