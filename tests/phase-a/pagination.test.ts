import { beforeAll,describe,it,expect,vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
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
  it('invalid NaN bounds produce successful but different native/reference pages, requiring future adapter validation',async()=>{
    const spy=vi.spyOn(native.client,'fetch');
    try {
      const page=await native.client.records('todos').list({order:['+priority'],pagination:{offset:NaN,limit:NaN}});
      expect(page.records.map(row=>row.priority)).toEqual([0,1,2,3,4,5]);
      expect(spy).toHaveBeenCalledTimes(1);
      const params=new URL(spy.mock.calls[0][0],env.trailUrl).searchParams;
      expect(params.has('offset')).toBe(false);expect(params.has('limit')).toBe(false);
    } finally {spy.mockRestore();}
    const limited=await reference.client.from('todos').select('priority').order('priority').limit(NaN);
    expect(limited.status).toBe(200);expect(limited.error).toBeNull();expect(limited.data?.map(row=>row.priority)).toEqual([0,1,2,3,4,5]);
    const ranged=await reference.client.from('todos').select('priority').range(NaN,NaN);
    expect(ranged.status).toBe(200);expect(ranged.error).toBeNull();expect(ranged.data).toEqual([]);
  });
  it('native rejects serialized invalid/cap bounds while reference ignores malformed limits but rejects negative limits',async()=>{
    const api=native.client.records('todos');
    for(const value of [-1,1.5,Infinity,-Infinity]) {
      await expect(api.list({pagination:{limit:value}})).rejects.toMatchObject({status:400});
      await expect(api.list({pagination:{offset:value,limit:2}})).rejects.toMatchObject({status:400});
      const limited=await reference.client.from('todos').select('priority').order('priority').limit(value);
      if(value===-1){expect(limited.status).toBe(416);expect(limited.error?.code).toBe('PGRST103');expect(limited.data).toBeNull();}
      else {expect(limited.status).toBe(200);expect(limited.error).toBeNull();expect(limited.data?.map(row=>row.priority)).toEqual([0,1,2,3,4,5]);}
    }
    for(const limit of [1001,Number.MAX_SAFE_INTEGER])await expect(api.list({pagination:{limit}})).rejects.toMatchObject({status:400});
    expect((await api.list({order:['+priority']})).records.map(row=>row.priority)).toEqual([0,1,2,3,4,5]);
    const rows=await reference.client.from('todos').select('priority').order('priority');
    expect(rows.error).toBeNull();expect(rows.data?.map(row=>row.priority)).toEqual([0,1,2,3,4,5]);
  });
  it('reference last-set wire bounds preserve zero-width errors; ordinary no-count out-of-range pages stay empty',async()=>{
    const session=(await reference.client.auth.getSession()).data.session;if(!session)throw new Error('Real pagination session missing');
    const observed:URL[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{accessToken:async()=>session.access_token,global:{fetch:(input,init)=>{
      observed.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));return fetch(input,init);
    }}});
    const query=()=>client.from('todos').select('priority').order('priority');
    const cases=[
      {query:query().limit(4).limit(2),offset:null,limit:'2',rows:[0,1]},
      {query:query().range(1,4).range(2,3),offset:'2',limit:'2',rows:[2,3]},
      {query:query().range(1,3).limit(0),offset:'1',limit:'0',rows:null},
      {query:query().limit(0).range(1,2),offset:'1',limit:'2',rows:[1,2]},
      {query:query().range(1,3).range(0,0),offset:'0',limit:'1',rows:[0]},
      {query:query().range(3,2),offset:'3',limit:'0',rows:null},
      {query:query().range(100,101),offset:'100',limit:'2',rows:[]},
      {query:query().range(-1,0),offset:'-1',limit:'2',rows:[0]}
    ];
    expect(observed).toEqual([]);
    for(const [index,item] of cases.entries()) {
      const result=await item.query;
      if(item.rows===null){expect(result.status).toBe(416);expect(result.error?.code).toBe('PGRST103');expect(result.data).toBeNull();}
      else {expect(result.status).toBe(200);expect(result.error).toBeNull();expect(result.data?.map(row=>row.priority)).toEqual(item.rows);}
      expect(observed).toHaveLength(index+1);expect(observed[index].pathname).toBe('/rest/v1/todos');
      expect(observed[index].searchParams.get('offset')).toBe(item.offset);expect(observed[index].searchParams.get('limit')).toBe(item.limit);
    }
    expect((await native.client.records('todos').list({pagination:{offset:100,limit:2}})).records).toEqual([]);
    const params=new URLSearchParams({limit:'0',offset:'1'});
    const zero=await native.client.fetch(`/api/records/v1/todos?${params}`);
    expect(zero.status).toBe(200);expect((await zero.json()).records).toEqual([]);
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
  it('G2/G4 safe offsets whose range end overflows Number safety are still serialized upstream',async()=>{
    const offset=Number.MAX_SAFE_INTEGER,limit=2,end=offset+(limit-1);
    expect(Number.isSafeInteger(offset)).toBe(true);expect(Number.isSafeInteger(end)).toBe(false);
    const nativeSpy=vi.spyOn(native.client,'fetch');
    try {
      expect((await native.client.records('todos').list({pagination:{offset,limit}})).records).toEqual([]);
      expect(nativeSpy).toHaveBeenCalledTimes(1);
      const params=new URL(nativeSpy.mock.calls[0][0],env.trailUrl).searchParams;
      expect(params.get('offset')).toBe(String(offset));expect(params.get('limit')).toBe(String(limit));
    } finally {nativeSpy.mockRestore();}
    const session=(await reference.client.auth.getSession()).data.session;if(!session)throw new Error('Real overflowing-range session missing');
    const observed:URL[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{accessToken:async()=>session.access_token,global:{fetch:(input,init)=>{
      observed.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));return fetch(input,init);
    }}});
    const page=await client.from('todos').select('priority').order('priority').range(offset,end);
    expect(page.status).toBe(200);expect(page.error).toBeNull();expect(page.data).toEqual([]);
    expect(observed).toHaveLength(1);expect(observed[0].searchParams.get('offset')).toBe(String(offset));expect(observed[0].searchParams.get('limit')).toBe(String(limit));
  });
  it('G2/G4 unsafe integer offsets are serialized by installed clients and return empty out-of-range pages',async()=>{
    const offset=Number.MAX_SAFE_INTEGER+1;
    expect(Number.isSafeInteger(offset)).toBe(false);
    const spy=vi.spyOn(native.client,'fetch');
    try {
      const page=await native.client.records('todos').list({order:['+priority'],pagination:{offset,limit:1}});
      expect(page.records).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
      const params=new URL(spy.mock.calls[0][0],env.trailUrl).searchParams;
      expect(params.get('offset')).toBe(String(offset));expect(params.get('limit')).toBe('1');
    } finally {spy.mockRestore();}
    const session=(await reference.client.auth.getSession()).data.session;if(!session)throw new Error('Real unsafe-offset session missing');
    const observed:URL[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{accessToken:async()=>session.access_token,global:{fetch:(input,init)=>{
      observed.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));return fetch(input,init);
    }}});
    const page=await client.from('todos').select('priority').order('priority').range(offset,offset);
    expect(page.status).toBe(200);expect(page.error).toBeNull();expect(page.data).toEqual([]);
    expect(observed).toHaveLength(1);expect(observed[0].searchParams.get('offset')).toBe(String(offset));expect(observed[0].searchParams.get('limit')).toBe('1');
  });
});
