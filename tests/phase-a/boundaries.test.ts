import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { isNotNull,isNull } from 'trailbase';
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
  it('L1-09/G2 upstream NULL predicates select SQL NULL, outside the approved six-filter subset',async()=>{
    const nativeSpy=vi.spyOn(native.client,'fetch');
    try {
      const api=native.client.records('todos');
      const nativeNull=await api.list({filters:[isNull('note')],order:['+id']});
      const nativeNotNull=await api.list({filters:[isNotNull('note')],order:['+id']});
      expect(nativeSpy).toHaveBeenCalledTimes(2);
      const nativeUrls=nativeSpy.mock.calls.map(([path])=>new URL(path,env.trailUrl));
      expect(nativeUrls.map(url=>url.searchParams.get('filter[note][$is]'))).toEqual(['NULL','!NULL']);
      expect(nativeNull.records.map(row=>canonicalUuid(String(row.id)))).toEqual([ids[0]]);
      expect(nativeNotNull.records.map(row=>canonicalUuid(String(row.id))).sort()).toEqual(ids.slice(1).sort());
    } finally {nativeSpy.mockRestore();}

    const session=(await reference.client.auth.getSession()).data.session;
    if(!session)throw new Error('Confirmed reference session missing');
    const urls:URL[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      accessToken:async()=>session.access_token,
      global:{fetch:(input,init)=>{
        urls.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));
        return fetch(input,init);
      }}
    });
    const referenceNull=await client.from('todos').select('id,note').is('note',null).order('id');
    const referenceNotNull=await client.from('todos').select('id,note').not('note','is',null).order('id');
    expect(referenceNull.status).toBe(200);expect(referenceNull.error).toBeNull();
    expect(referenceNull.data?.map(row=>row.id)).toEqual([ids[0]]);
    expect(referenceNotNull.status).toBe(200);expect(referenceNotNull.error).toBeNull();
    expect(referenceNotNull.data?.map(row=>row.id)).toEqual(ids.slice(1).sort());
    expect(urls.map(url=>url.searchParams.get('note'))).toEqual(['is.null','not.is.null']);
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
  it('L1-10/G4 installed nullsFirst flags produce explicit reference order tokens; nullable ordering stays nonportable',async()=>{
    const session=(await reference.client.auth.getSession()).data.session;
    if(!session)throw new Error('Confirmed reference session missing');
    const urls:URL[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      accessToken:async()=>session.access_token,
      global:{fetch:(input,init)=>{
        urls.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));
        return fetch(input,init);
      }}
    });
    const first=await client.from('todos').select('id').order('note',{nullsFirst:true}).order('priority');
    const last=await client.from('todos').select('id').order('note',{nullsFirst:false}).order('priority');
    const nullFirst=[ids[0],...ids.slice(1)],nullLast=[...ids.slice(1),ids[0]];
    expect(first.status).toBe(200);expect(first.error).toBeNull();expect(first.data?.map(row=>row.id)).toEqual(nullFirst);
    expect(last.status).toBe(200);expect(last.error).toBeNull();expect(last.data?.map(row=>row.id)).toEqual(nullLast);
    expect(urls.map(url=>url.searchParams.get('order'))).toEqual([
      'note.asc.nullsfirst,priority.asc','note.asc.nullslast,priority.asc'
    ]);
    const nativeDefault=await native.client.records('todos').list({order:['+note','+priority']});
    expect(nativeDefault.records.map(row=>canonicalUuid(String(row.id)))).toEqual(nullFirst);
  });
  it('L1-10/G4 installed referencedTable/foreignTable order options stay outside the supported contract',async()=>{
    const session=(await reference.client.auth.getSession()).data.session;
    if(!session)throw new Error('Confirmed reference session missing');
    const urls:URL[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      accessToken:async()=>session.access_token,
      global:{fetch:(input,init)=>{
        urls.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));
        return fetch(input,init);
      }}
    });
    const current=await client.from('todos').select('id').order('priority',{ascending:false}).order('title',{referencedTable:'todo_links'});
    const legacy=await client.from('todos').select('id').order('priority',{ascending:false}).order('title',{foreignTable:'todo_links'});
    expect(current.status).toBe(400);expect(current.error?.code).toBe('PGRST108');expect(current.data).toBeNull();
    expect(legacy.status).toBe(400);expect(legacy.error?.code).toBe('PGRST108');expect(legacy.data).toBeNull();
    expect(urls.map(url=>url.searchParams.get('order'))).toEqual(['priority.desc','priority.desc']);
    expect(urls.map(url=>url.searchParams.get('todo_links.order'))).toEqual(['title.asc','title.asc']);
  });
  it('L1-11/G4 referencedTable/foreignTable limit and range options require an embedded relation',async()=>{
    const session=(await reference.client.auth.getSession()).data.session;
    if(!session)throw new Error('Confirmed reference session missing');
    const requests:{url:URL;method:string}[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      accessToken:async()=>session.access_token,
      global:{fetch:(input,init)=>{
        requests.push({url:new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),method:init?.method??'GET'});
        return fetch(input,init);
      }}
    });
    try{
      const limited=await client.from('todos').select('id').limit(1,{referencedTable:'todo_links'});
      const ranged=await client.from('todos').select('id').range(0,1,{foreignTable:'todo_links'});
      for(const result of [limited,ranged]){expect(result.status).toBe(400);expect(result.error?.code).toBe('PGRST108');expect(result.data).toBeNull();}
      expect(requests).toHaveLength(2);expect(requests.every(request=>request.method==='GET'&&request.url.pathname==='/rest/v1/todos')).toBe(true);
      expect(requests.map(request=>request.url.searchParams.get('todo_links.limit'))).toEqual(['1','2']);
      expect(requests.map(request=>request.url.searchParams.get('todo_links.offset'))).toEqual([null,'0']);
      expect(requests.every(request=>!request.url.searchParams.has('limit')&&!request.url.searchParams.has('offset'))).toBe(true);
    }finally{client.realtime.disconnect();}
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
  for(const shape of ['date','bytes'] as const)it(`G2/G3/S02 raw ${shape} serialization preserves rejected-write rows/audits and other-owner controls`,async()=>{
    const b=await confirmedTrailUser(env,'shape-b'),rb=await confirmedSupabaseUser(env,'shape-b');
    const bid=randomUUID(),created=randomUUID(),date=new Date('2024-01-02T03:04:05.000Z'),bytes=Uint8Array.from(Buffer.from(created.replaceAll('-',''),'hex'));
    const api=native.client.records('todos');
    await b.client.records('todos').create({id:nativeUuid(bid),user_id:b.user.id,title:'other-owner-shape-control'});
    expect((await rb.client.from('todos').insert({id:bid,user_id:rb.user.id,title:'other-owner-shape-control'})).error).toBeNull();
    const token=(await reference.client.auth.getSession()).data.session!.access_token;
    const wire:{method:string;body:Record<string,unknown>}[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{accessToken:async()=>token,global:{fetch:async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      if(url.pathname==='/rest/v1/todos'&&['POST','PATCH'].includes(init?.method??''))wire.push({method:init!.method!,body:JSON.parse(String(init!.body))});
      return fetch(input,{...init,signal:AbortSignal.timeout(10000)});
    }}});
    const spy=vi.spyOn(native.client,'fetch');let nativeCreated=false,referenceCreated=false;
    const state=async()=>{
      const rows=await reference.client.from('todos').select('*').order('id'),audit=await reference.client.from('todo_audit').select('*').order('audit_key');
      const other=await rb.client.from('todos').select('*').order('id'),otherAudit=await rb.client.from('todo_audit').select('*').order('audit_key');
      for(const result of [rows,audit,other,otherAudit])expect(result.error).toBeNull();
      return {rows:rows.data,audit:audit.data,other:other.data,otherAudit:otherAudit.data,native:(await api.list({order:['+id'],pagination:{limit:1000}})).records,nativeAudit:(await native.client.records('todo_audit').list({order:['+audit_key'],pagination:{limit:1000}})).records,nativeOther:(await b.client.records('todos').list()).records,nativeOtherAudit:(await b.client.records('todo_audit').list({order:['+audit_key']})).records};
    };
    try{
      if(shape==='date'){
        const invalidId=randomUUID(),invalidDate=new Date(Number.NaN);
        await expect(api.create({id:nativeUuid(invalidId),user_id:native.user.id,title:invalidDate})).rejects.toMatchObject({status:400});
        const invalid=await client.from('todos').insert({id:invalidId,user_id:reference.user.id,title:invalidDate});expect(invalid.status).toBe(400);expect(invalid.error?.code).toBe('23502');expect(invalid.data).toBeNull();
        expect(await api.create({id:nativeUuid(created),user_id:native.user.id,title:date})).toBe(nativeUuid(created));nativeCreated=true;
        const inserted=await client.from('todos').insert({id:created,user_id:reference.user.id,title:date});referenceCreated=!inserted.error;expect(inserted.error).toBeNull();
        expect((await api.read(nativeUuid(created))).title).toBe(date.toISOString());
        const row=await reference.client.from('todos').select('*').eq('id',created).single();expect(row.error).toBeNull();expect(row.data.title).toBe(date.toISOString());
      }
      const before=await state();
      const bad=shape==='date'?{id:nativeUuid(randomUUID()),user_id:native.user.id,title:'rejected-date',created_at:date}:{id:bytes,user_id:native.user.id,title:'rejected-bytes'};
      await expect(api.create(bad)).rejects.toMatchObject({status:400});
      const rejected=await client.from('todos').insert({...bad,id:shape==='date'?randomUUID():bytes,user_id:reference.user.id});
      expect(rejected.status).toBe(400);expect(rejected.error?.code).toBe('22P02');expect(rejected.data).toBeNull();
      const values=shape==='date'?{created_at:date,note:'must-not-persist'}:{priority:bytes,note:'must-not-persist'};
      await expect(api.update(nativeUuid(ids[0]),values)).rejects.toMatchObject({status:400});
      const updated=await client.from('todos').update(values).eq('id',ids[0]);expect(updated.status).toBe(400);expect(updated.error?.code).toBe('22P02');expect(updated.data).toBeNull();
      expect(await state()).toEqual(before);
      const nativeWire=spy.mock.calls.filter(([,init])=>['POST','PATCH'].includes(init?.method??'')).map(([,init])=>({method:init!.method!,body:JSON.parse(String(init!.body))}));
      expect(nativeWire.map(call=>call.method)).toEqual(shape==='date'?['POST','POST','POST','PATCH']:['POST','PATCH']);expect(wire.map(call=>call.method)).toEqual(nativeWire.map(call=>call.method));
      for(const calls of [nativeWire,wire]){
        if(shape==='date'){expect(calls[0].body.title).toBe(null);expect(calls[1].body.title).toBe(date.toISOString());expect(calls[2].body.created_at).toBe(date.toISOString());expect(calls[3].body.created_at).toBe(date.toISOString());}
        else{expect(calls[0].body.id).toEqual(JSON.parse(JSON.stringify(bytes)));expect(calls[1].body.priority).toEqual(JSON.parse(JSON.stringify(bytes)));}
      }
    }finally{
      spy.mockRestore();
      if(nativeCreated)await api.delete(nativeUuid(created));if(referenceCreated)expect((await reference.client.from('todos').delete().eq('id',created)).error).toBeNull();
      await b.client.records('todos').delete(nativeUuid(bid));expect((await rb.client.from('todos').delete().eq('id',bid)).error).toBeNull();
      expect((await b.client.records('todos').list()).records).toEqual([]);const empty=await rb.client.from('todos').select('*');expect(empty.error).toBeNull();expect(empty.data).toEqual([]);
      const refresh=b.client.tokens()!.refresh_token;await b.client.logout();expect(b.client.tokens()).toBeUndefined();expect(b.client.user()).toBeUndefined();
      expect((await fetch(`${env.trailUrl}/api/auth/v1/refresh`,{method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(10000)})).status).toBe(401);
      expect((await rb.client.auth.signOut({scope:'local'})).error).toBeNull();expect((await rb.client.auth.getSession()).data.session).toBeNull();client.realtime.disconnect();
    }
  });
  it('G2 installed equality filters stringify JSON-shaped values instead of rejecting them',async()=>{
    const value={nested:['alpha',7],enabled:true},api=native.client.records('todos');
    const nativeRowsBefore=(await api.list({pagination:{limit:1000},order:['+id']})).records;
    const nativeAuditBefore=(await native.client.records('todo_audit').list({pagination:{limit:1000},order:['+audit_key']})).records;
    const referenceRowsBefore=await reference.client.from('todos').select('*').order('id');
    const referenceAuditBefore=await reference.client.from('todo_audit').select('*').order('audit_key');
    expect(referenceRowsBefore.error).toBeNull();expect(referenceAuditBefore.error).toBeNull();
    const session=(await reference.client.auth.getSession()).data.session;
    if(!session)throw new Error('Confirmed reference session missing');
    const referenceUrls:URL[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      accessToken:async()=>session.access_token,
      global:{fetch:(input,init)=>{
        referenceUrls.push(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url));
        return fetch(input,init);
      }}
    });
    const nativeSpy=vi.spyOn(native.client,'fetch');
    try{
      const nativeResult=await api.list({filters:[{column:'title',op:'equal',value:value as unknown as string}]});
      expect(nativeResult.records).toEqual([]);
      const nativeCalls=nativeSpy.mock.calls.filter(([path])=>new URL(path,env.trailUrl).pathname.includes('/todos'));
      expect(nativeCalls).toHaveLength(1);
      const nativeFetch=nativeSpy.mock.results[0]?.value;
      if(!nativeFetch)throw new Error('Native equality fetch did not return a response');
      expect((await nativeFetch).status).toBe(200);
      const nativeUrl=new URL(nativeCalls[0][0],env.trailUrl);
      expect(nativeUrl.searchParams.get('filter[title][$eq]')).toBe('[object Object]');
      const referenceResult=await client.from('todos').select('id').eq('title',value);
      expect(referenceResult.status).toBe(200);expect(referenceResult.error).toBeNull();expect(referenceResult.data).toEqual([]);
      expect(referenceUrls).toHaveLength(1);expect(referenceUrls[0].searchParams.get('title')).toBe('eq.[object Object]');
      expect((await api.list({pagination:{limit:1000},order:['+id']})).records).toEqual(nativeRowsBefore);
      expect((await native.client.records('todo_audit').list({pagination:{limit:1000},order:['+audit_key']})).records).toEqual(nativeAuditBefore);
      const referenceRowsAfter=await reference.client.from('todos').select('*').order('id');
      const referenceAuditAfter=await reference.client.from('todo_audit').select('*').order('audit_key');
      expect(referenceRowsAfter.error).toBeNull();expect(referenceRowsAfter.data).toEqual(referenceRowsBefore.data);
      expect(referenceAuditAfter.error).toBeNull();expect(referenceAuditAfter.data).toEqual(referenceAuditBefore.data);
    }finally{nativeSpy.mockRestore();client.realtime.disconnect();}
  });
  it('G2 rejects unsupported JSON-shaped text input natively while reference coerces it to JSON text',async()=>{
    const value={nested:['alpha',7],enabled:true},nativeId=randomUUID(),referenceId=randomUUID();
    const api=native.client.records('todos');
    const nativeRowsBefore=(await api.list({pagination:{limit:1000},order:['+id']})).records;
    const nativeAuditBefore=(await native.client.records('todo_audit').list({pagination:{limit:1000},order:['+audit_key']})).records;
    const referenceRowsBefore=await reference.client.from('todos').select('*').order('id');
    const referenceAuditBefore=await reference.client.from('todo_audit').select('*').order('audit_key');
    expect(referenceRowsBefore.error).toBeNull();expect(referenceAuditBefore.error).toBeNull();
    const referenceSession=(await reference.client.auth.getSession()).data.session;
    if(!referenceSession)throw new Error('Confirmed reference session missing');
    const referenceWire:{method:string;body:Record<string,unknown>}[]=[];
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      accessToken:async()=>referenceSession.access_token,
      global:{fetch:(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        if(url.pathname==='/rest/v1/todos'&&init?.method==='POST')referenceWire.push({method:init.method,body:JSON.parse(String(init.body))});
        return fetch(input,init);
      }}
    });
    const nativeSpy=vi.spyOn(native.client,'fetch');
    try{
      let nativeError:unknown;
      try{await api.create({id:nativeUuid(nativeId),user_id:native.user.id,title:value});}catch(error){nativeError=error;}
      expect((nativeError as {status?:number}|undefined)?.status).toBe(400);
      const nativeWire=nativeSpy.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(String(init?.body)));
      expect(nativeWire).toHaveLength(1);expect(nativeWire[0].title).toEqual(value);
      expect((await api.list({pagination:{limit:1000},order:['+id']})).records).toEqual(nativeRowsBefore);
      expect((await native.client.records('todo_audit').list({pagination:{limit:1000},order:['+audit_key']})).records).toEqual(nativeAuditBefore);

      const inserted=await client.from('todos').insert({id:referenceId,user_id:reference.user.id,title:value});
      expect(inserted.status).toBe(201);expect(inserted.error).toBeNull();expect(inserted.data).toBeNull();
      expect(referenceWire).toHaveLength(1);expect(referenceWire[0].body.title).toEqual(value);
      const found=await reference.client.from('todos').select('id,title').eq('id',referenceId).single();
      expect(found.error).toBeNull();if(!found.data)throw new Error('Reference JSON-shaped row missing');
      expect(typeof found.data.title).toBe('string');expect(JSON.parse(found.data.title)).toEqual(value);
      const referenceRowsAfter=await reference.client.from('todos').select('*').order('id');
      expect(referenceRowsAfter.error).toBeNull();expect(referenceRowsAfter.data?.filter(row=>row.id!==referenceId)).toEqual(referenceRowsBefore.data);
      const referenceAuditAfter=await reference.client.from('todo_audit').select('*').order('audit_key');
      expect(referenceAuditAfter.error).toBeNull();
      expect(referenceAuditAfter.data?.filter(row=>row.todo_id!==referenceId)).toEqual(referenceAuditBefore.data);
      expect(referenceAuditAfter.data?.filter(row=>row.todo_id===referenceId).map(row=>row.operation)).toEqual(['INSERT']);
    }finally{
      nativeSpy.mockRestore();
      const nativeProbe=await api.list({filters:[{column:'id',value:nativeUuid(nativeId)}]});
      if(nativeProbe.records.length)await api.delete(nativeUuid(nativeId));
      expect((await api.list({pagination:{limit:1000},order:['+id']})).records).toEqual(nativeRowsBefore);
      expect((await native.client.records('todo_audit').list({pagination:{limit:1000},order:['+audit_key']})).records).toEqual(nativeAuditBefore);
      const referenceProbe=await reference.client.from('todos').select('id').eq('id',referenceId);
      expect(referenceProbe.error).toBeNull();
      if(referenceProbe.data?.length){const removed=await reference.client.from('todos').delete().eq('id',referenceId);expect(removed.status).toBe(204);expect(removed.error).toBeNull();}
      const referenceRowsAfter=await reference.client.from('todos').select('*').order('id');
      const referenceAuditAfter=await reference.client.from('todo_audit').select('*').order('audit_key');
      expect(referenceRowsAfter.error).toBeNull();expect(referenceRowsAfter.data).toEqual(referenceRowsBefore.data);
      expect(referenceAuditAfter.error).toBeNull();
      expect(referenceAuditAfter.data?.filter(row=>row.todo_id!==referenceId)).toEqual(referenceAuditBefore.data);
      expect(referenceAuditAfter.data?.filter(row=>row.todo_id===referenceId).map(row=>row.operation)).toEqual(referenceProbe.data?.length?['INSERT','DELETE']:[]);
      client.realtime.disconnect();
    }
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
