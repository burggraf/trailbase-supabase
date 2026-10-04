import { beforeAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { initClient } from 'trailbase';
import { createClient } from '@supabase/supabase-js';
import { context,confirmedTrailUser,confirmedSupabaseUser,nativeUuid,deadline,type Context } from './helpers.js';
import { nativeSseProof } from '../proofs/native-sse.js';
import { httpStreamFixture } from '../proofs/http-stream-fixture.js';

let env:Context;
beforeAll(async()=>{env=await context();});
describe('L1-27 G5/S07 owned real HTTP fault fixture, NOT arbitrary TCP/browser/package guarantee',()=>{
  it('preserves real UTF-8 frames over observed multi-chunk HTTP and releases upstream on consumer abort',async()=>{
    const account=await confirmedTrailUser(env,'http-stream');
    const fixture=await httpStreamFixture(signal=>fetch(`${env.trailUrl}/api/records/v1/todos/subscribe/*`,{headers:account.client.headers(),signal}),'fragment');
    const abort=new AbortController();let parser:ReturnType<typeof nativeSseProof>|undefined;
    try {
      const wrong=await fetch(new URL('/wrong',fixture.url));expect(wrong.status).toBe(404);await wrong.body?.cancel();
      const response=await fetch(fixture.url,{signal:abort.signal});expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      if(!response.body)throw new Error('Real HTTP fixture body missing');
      let chunks=0,losses=0;
      const observed=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){chunks++;controller.enqueue(chunk);}}));
      parser=nativeSseProof(observed,{signal:abort.signal,onLoss:()=>losses++});
      const api=account.client.records('todos'),id=nativeUuid(randomUUID()),title=`http-${randomUUID()}-雪é-e\u0301`;
      let pending=parser.next();await api.create({id,user_id:account.user.id,title});
      let event=(await deadline(pending)).value!;expect('Insert' in event).toBe(true);
      if(!('Insert' in event))throw new Error('Real HTTP insert missing');
      expect((event.Insert as Record<string,unknown>).title).toBe(title);
      expect(chunks).toBeGreaterThan(1);
      pending=parser.next();await api.update(id,{title:`${title}-updated`});
      event=(await deadline(pending)).value!;expect('Update' in event).toBe(true);
      if(!('Update' in event))throw new Error('Real HTTP update missing');
      expect((event.Update as Record<string,unknown>).title).toBe(`${title}-updated`);
      pending=parser.next();await api.delete(id);
      event=(await deadline(pending)).value!;expect('Delete' in event).toBe(true);
      if(!('Delete' in event))throw new Error('Real HTTP delete missing');
      expect((event.Delete as Record<string,unknown>).id).toBe(id);expect(losses).toBe(0);
      expect((await api.list()).records).toEqual([]);
      pending=parser.next();const failed=expect(deadline(pending)).rejects.toMatchObject({name:'AbortError'});
      abort.abort();await failed;
      await deadline(fixture.idle());expect(fixture.stats()).toMatchObject({active:0,cancelled:1});
    } finally {
      abort.abort();await parser?.return(undefined).catch(()=>{});await deadline(fixture.close());
      expect(fixture.stats()).toMatchObject({active:0,listening:false});
    }
  });
  it('a real HTTP disconnect inside a native event fails observably and yields no fabricated event',async()=>{
    const account=await confirmedTrailUser(env,'http-disconnect');
    const fixture=await httpStreamFixture(signal=>fetch(`${env.trailUrl}/api/records/v1/todos/subscribe/*`,{headers:account.client.headers(),signal}),'disconnect');
    let parser:ReturnType<typeof nativeSseProof>|undefined;
    try {
      const response=await fetch(fixture.url);expect(response.ok).toBe(true);
      if(!response.body)throw new Error('Real disconnect fixture body missing');
      parser=nativeSseProof(response.body);
      const failed=expect(deadline(parser.next())).rejects.toBeDefined();
      await account.client.records('todos').create({id:nativeUuid(randomUUID()),user_id:account.user.id,title:`disconnect-${randomUUID()}-雪`});
      await failed;await deadline(fixture.idle());
      expect(fixture.stats()).toMatchObject({active:0,cancelled:1,bytesWritten:32});
      expect((await account.client.records('todos').list()).records).toHaveLength(1);
    } finally {
      await parser?.return(undefined).catch(()=>{});await deadline(fixture.close());
      expect(fixture.stats()).toMatchObject({active:0,listening:false});
    }
  });
});

describe('L1-27/G3/G4/S05 actual lost mutation reply, NOT SDK retry policy or browser/WAN signoff',()=>{
  it('native insert loses its real HTTP reply, rejects observably and is reconciled without replay',async()=>{
    const account=await confirmedTrailUser(env,'lost-native-write');
    const id=nativeUuid(randomUUID()),control=nativeUuid(randomUUID()),title=`lost-native-${randomUUID()}`;
    const records=account.client.records('todos');
    await records.create({id:control,user_id:account.user.id,title:`control-${randomUUID()}`,note:'control'});
    const before=await records.list({pagination:{limit:1000},order:['+id']});
    const auditBefore=(await account.client.records('todo_audit').list({pagination:{limit:1000},order:['+audit_key']})).records;
    let captured:RequestInit|undefined,calls=0,status=0;
    const fixture=await httpStreamFixture(async signal=>{
      if(!captured)throw new Error('Owned mutation request missing');
      const actual=await fetch(new URL('/api/records/v1/todos',env.trailUrl),{...captured,signal});
      status=actual.status;return actual;
    },'drop');
    const client=initClient(env.trailUrl,{transport:{fetch:async(path,init)=>{
      if(path==='/api/records/v1/todos'&&init?.method==='POST'){
        calls++;captured=init;return fetch(fixture.url,{signal:AbortSignal.timeout(10000)});
      }
      return fetch(new URL(path,env.trailUrl),{...init,signal:AbortSignal.timeout(10000)});
    }}});
    try {
      await client.login(account.email,account.password);
      await expect(deadline(client.records('todos').create({id,user_id:account.user.id,title,note:'persisted despite lost reply'}))).rejects.toBeInstanceOf(TypeError);
      await deadline(fixture.idle());expect(calls).toBe(1);expect(status).toBeGreaterThanOrEqual(200);expect(status).toBeLessThan(300);
      const persisted=await records.read(id);
      expect(persisted).toMatchObject({id,user_id:account.user.id,title,note:'persisted despite lost reply',completed:0,priority:0});
      expect(Number.isSafeInteger(persisted.created_at)).toBe(true);
      const after=(await records.list({pagination:{limit:1000},order:['+id']})).records;
      expect(after).toHaveLength(before.records.length+1);expect(after.filter(row=>row.id!==id)).toEqual(before.records);
      const audit=(await account.client.records('todo_audit').list({pagination:{limit:1000},order:['+audit_key']})).records;
      expect(audit).toHaveLength(auditBefore.length+1);expect(audit.slice(0,auditBefore.length)).toEqual(auditBefore);
      expect(audit.filter(row=>row.todo_id===id).map(row=>row.operation)).toEqual(['INSERT']);
      // Reconciliation is a test/caller read, not an adapter preflight/retry.
      expect(calls).toBe(1);expect(fixture.stats()).toMatchObject({active:0,bytesWritten:0});
    } finally {await deadline(fixture.close());expect(fixture.stats()).toMatchObject({active:0,listening:false});}
  });
  it('reference insert loses its real HTTP reply, returns error/no-data and is reconciled without replay',async()=>{
    const account=await confirmedSupabaseUser(env,'lost-reference-write');
    const id=randomUUID(),control=randomUUID(),title=`lost-reference-${randomUUID()}`;
    expect((await account.client.from('todos').insert({id:control,user_id:account.user.id,title:`control-${randomUUID()}`,note:'control'})).error).toBeNull();
    const before=await account.client.from('todos').select('*').order('id');expect(before.error).toBeNull();
    const auditBefore=await account.client.from('todo_audit').select('*').order('audit_key');expect(auditBefore.error).toBeNull();
    let captured:{url:string,init:RequestInit}|undefined,calls=0,status=0;
    const fixture=await httpStreamFixture(async signal=>{
      if(!captured)throw new Error('Owned reference mutation request missing');
      const actual=await fetch(captured.url,{...captured.init,signal});status=actual.status;return actual;
    },'drop');
    const client=createClient(env.supabaseUrl,env.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      if(url.origin===env.supabaseUrl&&url.pathname==='/rest/v1/todos'&&init?.method==='POST'){
        calls++;captured={url:url.href,init};return fetch(fixture.url,{signal:AbortSignal.timeout(10000)});
      }
      return fetch(input,{...init,signal:AbortSignal.timeout(10000)});
    }}});
    try {
      const login=await client.auth.signInWithPassword({email:account.email,password:account.password});expect(login.error).toBeNull();
      const lost=await deadline(Promise.resolve(client.from('todos').insert({id,user_id:account.user.id,title,note:'persisted despite lost reply'})));
      expect(lost.error).not.toBeNull();expect(lost.data).toBeNull();expect(lost.status).toBe(0);
      await deadline(fixture.idle());expect(calls).toBe(1);expect(status).toBe(201);
      const persisted=await account.client.from('todos').select('*').eq('id',id).single();expect(persisted.error).toBeNull();
      expect(persisted.data).toMatchObject({id,user_id:account.user.id,title,note:'persisted despite lost reply',completed:false,priority:0});
      expect(Number.isSafeInteger(persisted.data?.created_at)).toBe(true);
      const after=await account.client.from('todos').select('*').order('id');expect(after.error).toBeNull();
      expect(after.data).toHaveLength(before.data!.length+1);expect(after.data!.filter(row=>row.id!==id)).toEqual(before.data);
      const audit=await account.client.from('todo_audit').select('*').order('audit_key');expect(audit.error).toBeNull();
      expect(audit.data).toHaveLength(auditBefore.data!.length+1);expect(audit.data!.slice(0,auditBefore.data!.length)).toEqual(auditBefore.data);
      expect(audit.data!.filter(row=>row.todo_id===id).map(row=>row.operation)).toEqual(['INSERT']);
      expect(calls).toBe(1);expect(fixture.stats()).toMatchObject({active:0,bytesWritten:0});
    } finally {await deadline(fixture.close());expect(fixture.stats()).toMatchObject({active:0,listening:false});}
  });
});
