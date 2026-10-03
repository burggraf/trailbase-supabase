import { beforeAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { context,confirmedTrailUser,confirmedSupabaseUser,nativeUuid,type Context } from './helpers.js';

let env:Context,native:Awaited<ReturnType<typeof confirmedTrailUser>>,reference:Awaited<ReturnType<typeof confirmedSupabaseUser>>;
const filters=[{column:'priority',op:'greaterThanEqual' as const,value:'1'},{column:'priority',op:'lessThanEqual' as const,value:'4'}];
beforeAll(async()=>{
  env=await context();
  native=await confirmedTrailUser(env,'counts');reference=await confirmedSupabaseUser(env,'counts');
  const foreignNative=await confirmedTrailUser(env,'foreign-counts'),foreignReference=await confirmedSupabaseUser(env,'foreign-counts');
  for(const [account,priorities] of [[native,[0,1,2,3,4,5]],[foreignNative,[2,3]]] as const) {
    for(const priority of priorities)await account.client.records('todos').create({id:nativeUuid(randomUUID()),user_id:account.user.id,title:`count-${randomUUID()}`,priority});
  }
  for(const [account,priorities] of [[reference,[0,1,2,3,4,5]],[foreignReference,[2,3]]] as const) {
    expect((await account.client.from('todos').insert(priorities.map(priority=>({id:randomUUID(),user_id:account.user.id,title:`count-${randomUUID()}`,priority})))).error).toBeNull();
  }
});

describe('L1-27 G2/G4 exact count/page characterization, NOT adapter count/range signoff',()=>{
  it('filtered totals ignore page size, exclude foreign owners, and head/zero-body probes retain exact counts',async()=>{
    const page=await native.client.records('todos').list({filters,count:true,order:['+priority'],pagination:{offset:1,limit:2}});
    expect(page.records.map(row=>row.priority)).toEqual([2,3]);expect(page.total_count).toBe(4);
    const ranged=await reference.client.from('todos').select('priority',{count:'exact'}).gte('priority',1).lte('priority',4).order('priority').range(1,2);
    expect(ranged.error).toBeNull();expect(ranged.data?.map(row=>row.priority)).toEqual([2,3]);expect(ranged.count).toBe(4);
    const head=await reference.client.from('todos').select('id',{count:'exact',head:true}).gte('priority',1).lte('priority',4).range(1,2);
    expect(head.error).toBeNull();expect(head.data).toBeNull();expect(head.count).toBe(4);
    // Bypass installed native limit(0) omission, already characterized separately.
    const params=new URLSearchParams({count:'true',limit:'0','filter[priority][$gte]':'1','filter[priority][$lte]':'4'});
    const zero=await native.client.fetch(`/api/records/v1/todos?${params}`).then(response=>response.json());
    expect(zero.records).toEqual([]);expect(zero.total_count).toBe(4);
    const empty=await native.client.records('todos').list({count:true,filters:[{column:'priority',op:'greaterThan',value:'99'}]});
    expect(empty.records).toEqual([]);expect(empty.total_count).toBe(0);
    const emptyHead=await reference.client.from('todos').select('id',{count:'exact',head:true}).gt('priority',99);
    expect(emptyHead.error).toBeNull();expect(emptyHead.count).toBe(0);expect(emptyHead.data).toBeNull();
  });
  it('out-of-range count behavior is not interchangeable: native loses total, reference exact-range returns an error',async()=>{
    const page=await native.client.records('todos').list({filters,count:true,order:['+priority'],pagination:{offset:100,limit:2}});
    expect(page.records).toEqual([]);expect(page.total_count).toBe(0); // Four matches still exist; not a portable exact total.
    const referencePage=await reference.client.from('todos').select('id',{count:'exact'}).gte('priority',1).lte('priority',4).range(100,101);
    expect(referencePage.status).toBe(416);expect(referencePage.error).not.toBeNull();expect(referencePage.data).toBeNull();expect(referencePage.count).toBeNull();
    const session=(await reference.client.auth.getSession()).data.session;if(!session)throw new Error('Real count probe session missing');
    const params=new URLSearchParams({select:'id',offset:'100',limit:'2'});params.append('priority','gte.1');params.append('priority','lte.4');
    const actual=await fetch(`${env.supabaseUrl}/rest/v1/todos?${params}`,{method:'HEAD',headers:{apikey:env.anonKey,authorization:`Bearer ${session.access_token}`,Prefer:'count=exact'}});
    expect(actual.status).toBe(416);expect(actual.headers.get('content-range')).toBe('*/4');await actual.body?.cancel();
    const control=await native.client.records('todos').list({filters,count:true,pagination:{limit:1}});
    expect(control.total_count).toBe(4);expect(control.records).toHaveLength(1);
  });
});
