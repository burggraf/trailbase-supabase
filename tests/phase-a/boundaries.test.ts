import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { context, confirmedTrailUser, confirmedSupabaseUser, nativeUuid, canonicalUuid } from './helpers.js';

let env: Awaited<ReturnType<typeof context>>;
let native: Awaited<ReturnType<typeof confirmedTrailUser>>;
let reference: Awaited<ReturnType<typeof confirmedSupabaseUser>>;
const titles=['A','Z','a','z','ä','é','雪','e\u0301'];
const ids=titles.map(()=>randomUUID());
beforeAll(async()=>{
  env=await context();
  native=await confirmedTrailUser(env,'boundaries'); reference=await confirmedSupabaseUser(env,'boundaries');
  for(let i=0;i<ids.length;i++) {
    const row={title:titles[i],priority:i,note:i===0?null:i===1?'null':'other'};
    await native.client.records('todos').create({...row,id:nativeUuid(ids[i]),user_id:native.user.id});
    expect((await reference.client.from('todos').insert({...row,id:ids[i],user_id:reference.user.id})).error).toBeNull();
  }
});
describe('L1-27 G2/G4/S02 upstream boundaries, NOT adapter runtime validation',()=>{
  it('safe integers round-trip; native preserves unsafe bigint while reference JSON loses precision',async()=>{
    const api=native.client.records('integer_todos');
    for(const value of [9007199254740991n,9007199254740993n]) {
      await api.create({todo_key:value,user_id:native.user.id,title:`integer-${value}`});
      expect((await reference.client.from('integer_todos').insert({todo_key:value.toString(),user_id:reference.user.id,title:`integer-${value}`})).error).toBeNull();
      const row=await api.read(value.toString());
      const result=await reference.client.from('integer_todos').select('*').eq('todo_key',value.toString()).single();
      expect(result.error).toBeNull();
      if(value===9007199254740991n) {
        expect(row.todo_key).toBe(Number(value)); expect(result.data?.todo_key).toBe(Number(value));
      } else {
        expect(row.todo_key).toBe(value);
        expect(result.data?.todo_key).toBe(9007199254740992);
        expect(Number.isSafeInteger(result.data?.todo_key)).toBe(false);
        // Real wire data proves this is decoding loss, not an imprecise fixture insert.
        const session=(await reference.client.auth.getSession()).data.session;
        if(!session)throw new Error('Confirmed reference session missing');
        const response=await fetch(`${env.supabaseUrl}/rest/v1/integer_todos?select=todo_key&todo_key=eq.${value}`,{
          headers:{apikey:env.anonKey,Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(5000)
        });
        expect(response.ok).toBe(true);
        expect(await response.text()).toContain('"todo_key":9007199254740993');
      }
    }
  });
  it('null equality becomes literal text null, not IS NULL, in both installed clients',async()=>{
    const rows=(await native.client.records('todos').list({filters:[{column:'note',value:null as unknown as string}]})).records;
    const result=await reference.client.from('todos').select('*').eq('note',null);
    expect(result.error).toBeNull();
    expect(rows.map(row=>canonicalUuid(String(row.id)))).toEqual([ids[1]]);
    expect(result.data?.map(row=>row.id)).toEqual([ids[1]]);
    expect(rows[0].note).toBe('null');
  });
  it('nonfinite/fractional numeric values, typo columns and malformed UUIDs fail rather than broadening reads',async()=>{
    for(const[column,value]of [
      ['priority','NaN'],['priority','Infinity'],['priority','-Infinity'],['priority','1.5'],
      ['typo_column','anything'],['id','not-a-uuid']
    ]) {
      await expect(native.client.records('todos').list({filters:[{column,value}]})).rejects.toBeDefined();
      const result=await reference.client.from('todos').select('*').eq(column,value);
      expect(result.error).not.toBeNull(); expect(result.data).toBeNull();
    }
    expect((await native.client.records('todos').list()).records).toHaveLength(ids.length);
    expect((await reference.client.from('todos').select('*')).data).toHaveLength(ids.length);
  });
  it('nullable defaults diverge; mixed-case/Unicode ordering is deterministic but not promised portable',async()=>{
    const api=native.client.records('todos');
    const nativeNull=(await api.list({order:['+note','+priority']})).records;
    const referenceNull=await reference.client.from('todos').select('*').order('note').order('priority');
    expect(referenceNull.error).toBeNull();
    expect(canonicalUuid(String(nativeNull[0].id))).toBe(ids[0]);
    expect(referenceNull.data?.at(-1)?.id).toBe(ids[0]);
    const explicit=await reference.client.from('todos').select('*').order('note',{nullsFirst:true}).order('priority');
    expect(explicit.error).toBeNull();
    expect(nativeNull.map(row=>canonicalUuid(String(row.id)))).toEqual(explicit.data?.map(row=>row.id));
    const binary=[...titles.keys()].sort((a,b)=>Buffer.compare(Buffer.from(titles[a]),Buffer.from(titles[b]))).map(i=>ids[i]);
    const rows=(await api.list({order:['+title','+id']})).records;
    expect(rows.map(row=>canonicalUuid(String(row.id)))).toEqual(binary);
    const ascending=await reference.client.from('todos').select('*').order('title').order('id');
    const descending=await reference.client.from('todos').select('*').order('title',{ascending:false}).order('id',{ascending:false});
    expect(ascending.error).toBeNull(); expect(descending.error).toBeNull();
    expect(ascending.data?.map(row=>row.id).sort()).toEqual([...ids].sort());
    expect(descending.data?.map(row=>row.id)).toEqual(ascending.data?.map(row=>row.id).reverse());
    for(const title of ['é','e\u0301']) {
      const result=await reference.client.from('todos').select('*').eq('title',title);
      expect(result.error).toBeNull(); expect(result.data?.map(row=>row.title)).toEqual([title]);
      expect((await api.list({filters:[{column:'title',value:title}]})).records.map(row=>row.title)).toEqual([title]);
    }
  });
  it('G4 repeated order keys retain first-key precedence; bounds/order call order selects the same page',async()=>{
    const api=native.client.records('todos');
    for(const ascending of [true,false]) {
      const expected=ascending?[...ids]:[...ids].reverse();
      const page=await api.list({order:[ascending?'+priority':'-priority',ascending?'-priority':'+priority','+id']});
      const result=await reference.client.from('todos').select('*').order('priority',{ascending}).order('priority',{ascending:!ascending}).order('id');
      expect(page.records.map(row=>canonicalUuid(String(row.id)))).toEqual(expected);
      expect(result.error).toBeNull(); expect(result.data?.map(row=>row.id)).toEqual(expected);
    }
    const beforeOrder=await reference.client.from('todos').select('*').range(1,3).order('priority',{ascending:false});
    const afterOrder=await reference.client.from('todos').select('*').order('priority',{ascending:false}).range(1,3);
    expect(beforeOrder.error).toBeNull(); expect(afterOrder.error).toBeNull();
    expect(beforeOrder.data?.map(row=>row.id)).toEqual([ids[6],ids[5],ids[4]]);
    expect(afterOrder.data).toEqual(beforeOrder.data);
    const nativePage=await api.list({order:['-priority'],pagination:{offset:1,limit:3}});
    expect(nativePage.records.map(row=>canonicalUuid(String(row.id)))).toEqual([ids[6],ids[5],ids[4]]);
    await expect(api.list({order:['+typo_column']})).rejects.toMatchObject({status:500});
    const invalid=await reference.client.from('todos').select('*').order('typo_column');
    expect(invalid.error).not.toBeNull(); expect(invalid.data).toBeNull();
  });
  it('construction is lazy, repeated execution sends requests, independent builders isolate but shared builders/options mutate',async()=>{
    let calls=0;
    const session=(await reference.client.auth.getSession()).data.session;
    if(!session)throw new Error('Confirmed reference session missing');
    const client=createClient(env.supabaseUrl,env.anonKey,{
      accessToken:async()=>session.access_token,
      global:{fetch:async(input,init)=>{if(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).pathname==='/rest/v1/todos')calls++;return fetch(input,init);}}
    });
    const query=client.from('todos').select('*').eq('priority',0);
    const other=client.from('todos').select('*').eq('priority',1);
    expect(calls).toBe(0);
    expect((await query).data?.map(row=>row.id)).toEqual([ids[0]]);
    expect((await query).data?.map(row=>row.id)).toEqual([ids[0]]);
    expect((await other).data?.map(row=>row.id)).toEqual([ids[1]]);
    expect(calls).toBe(3);
    expect(query.eq('priority',1)).toBe(query);
    const shared=await query; expect(shared.error).toBeNull(); expect(shared.data).toEqual([]);
    expect(calls).toBe(4);
    const spy=vi.spyOn(native.client,'fetch');
    try {
      const api=native.client.records('todos');
      const options={filters:[{column:'priority',value:'0'}]};
      const operation=api.listOp(options),independent=api.listOp({filters:[{column:'priority',value:'1'}]});
      expect(spy).not.toHaveBeenCalled();
      expect((await operation.query()).records.map(row=>canonicalUuid(String(row.id)))).toEqual([ids[0]]);
      expect((await operation.query()).records.map(row=>canonicalUuid(String(row.id)))).toEqual([ids[0]]);
      expect((await independent.query()).records.map(row=>canonicalUuid(String(row.id)))).toEqual([ids[1]]);
      expect(spy.mock.calls.filter(([path])=>path.startsWith('/api/records/v1/todos?'))).toHaveLength(3);
      options.filters[0].value='1';
      expect((await operation.query()).records.map(row=>canonicalUuid(String(row.id)))).toEqual([ids[1]]);
      expect(spy.mock.calls.filter(([path])=>path.startsWith('/api/records/v1/todos?'))).toHaveLength(4);
    } finally {spy.mockRestore();}
  });
});
