import { beforeAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { context,confirmedTrailUser,nativeUuid,deadline,type Context } from './helpers.js';
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
