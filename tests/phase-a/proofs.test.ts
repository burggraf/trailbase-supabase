/// <reference lib="es2024.promise" />
import { randomUUID } from 'node:crypto';
import { beforeAll,describe,expect,it } from 'vitest';
import { context,confirmedTrailUser,nativeUuid,deadline,type Context } from './helpers.js';
import { nativeSseProof } from '../proofs/native-sse.js';
import { authCoordinationProof } from '../proofs/auth-coordination.js';

let env:Context;
beforeAll(async()=>{env=await context();});
const forward=(path:string,init?:RequestInit)=>fetch(new URL(path,env.trailUrl),{...init,signal:AbortSignal.timeout(10000)});
const remoteRefresh=(refresh_token:string)=>forward('/api/auth/v1/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token})});

describe('L1-27 G5/G7 authorized test-only proofs, NOT replacement SDK/signoff',()=>{
  it('buffered decoder consumes a byte-rechunked REAL UTF-8 stream and aborts its pending read',async()=>{
    const account=await confirmedTrailUser(env,'proof-stream'),api=account.client.records('todos');
    const response=await account.client.fetch('/api/records/v1/todos/subscribe/*');
    expect(response.ok).toBe(true);if(!response.body)throw new Error('Real stream body missing');
    // Deterministic rechunking AFTER real HTTP receipt; not a TCP/proxy/browser fragmentation claim.
    const bytes=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){for(const byte of chunk)controller.enqueue(new Uint8Array([byte]));}}));
    const abort=new AbortController();let losses=0;
    const parser=nativeSseProof(bytes,{signal:abort.signal,onLoss:()=>losses++});
    const id=nativeUuid(randomUUID()),title=`proof-${randomUUID()}-雪é-e\u0301`;
    try {
      let pending=parser.next();
      await api.create({id,user_id:account.user.id,title});
      let event=(await deadline(pending)).value!;
      expect('Insert' in event).toBe(true);if(!('Insert' in event))throw new Error('Real insert missing');
      expect((event.Insert as Record<string,unknown>).title).toBe(title);
      pending=parser.next();await api.update(id,{title:`${title}-updated`});
      event=(await deadline(pending)).value!;
      expect('Update' in event).toBe(true);if(!('Update' in event))throw new Error('Real update missing');
      expect((event.Update as Record<string,unknown>).title).toBe(`${title}-updated`);
      pending=parser.next();await api.delete(id);
      event=(await deadline(pending)).value!;
      expect('Delete' in event).toBe(true);if(!('Delete' in event))throw new Error('Real delete missing');
      expect((event.Delete as Record<string,unknown>).id).toBe(id);
      expect((await api.list()).records).toEqual([]);expect(losses).toBe(0);
      pending=parser.next();abort.abort();
      await expect(deadline(pending)).rejects.toMatchObject({name:'AbortError'});
      expect(bytes.locked).toBe(false);
    } finally {abort.abort();await parser.return(undefined);}
  });
  it('single-flight proof issues one real refresh and clears its slot for the next refresh',async()=>{
    const account=await confirmedTrailUser(env,'proof-refresh');
    const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let calls=0,hold=true;
    const proof=authCoordinationProof(async(path,init)=>{
      if(path==='/api/auth/v1/refresh'){calls++;if(hold){ready.resolve();await release.promise;}}
      return forward(path,init);
    });
    await proof.login(account.email,account.password);
    const before=proof.tokens()!.refresh_token!;
    const first=proof.refresh(),second=proof.refresh();
    try {
      expect(first).toBe(second);await deadline(ready.promise);expect(calls).toBe(1);
      release.resolve();expect(await deadline(Promise.all([first,second]))).toEqual([true,true]);
      expect(proof.tokens()?.refresh_token===before).toBe(true);
      hold=false;expect(await proof.refresh()).toBe(true);expect(calls).toBe(2);
      expect((await forward('/api/records/v1/todos',{headers:proof.headers()})).ok).toBe(true);
      await proof.logout();expect(proof.tokens()).toBeUndefined();expect((await remoteRefresh(before)).status).toBe(401);
    } finally {release.resolve();await Promise.allSettled([first,second]);}
  });
  for(const operation of ['refresh','status'] as const)for(const stage of ['response','json'] as const) {
    it(`epoch proof discards late real ${operation} at ${stage} completion after logout`,async()=>{
      const account=await confirmedTrailUser(env,`proof-${operation}-${stage}`);
      const ready=Promise.withResolvers<number>(),release=Promise.withResolvers<void>();
      const proof=authCoordinationProof(async(path,init)=>{
        const response=await forward(path,init);
        if(path===`/api/auth/v1/${operation}`) {
          if(stage==='response'){await response.clone().arrayBuffer();ready.resolve(response.status);await release.promise;}
          else {
            const json=response.json.bind(response);
            response.json=async()=>{const actual=await json();ready.resolve(response.status);await release.promise;return actual;};
          }
        }
        return response;
      });
      await proof.login(account.email,account.password);
      const before=proof.tokens()!.refresh_token!;
      const pending=operation==='refresh'?proof.refresh():proof.validate();
      try {
        expect(await deadline(ready.promise)).toBe(200);
        await proof.logout();expect(proof.tokens()).toBeUndefined();
        expect((await remoteRefresh(before)).status).toBe(401);
        release.resolve();await expect(deadline<unknown>(pending)).rejects.toMatchObject({name:'StaleAuthProofOperation'});
        expect(proof.tokens()).toBeUndefined();
        expect((await forward('/api/records/v1/todos',{headers:proof.headers()})).status).toBe(403);
      } finally {release.resolve();await Promise.allSettled([pending]);}
    });
  }
  it('account switch invalidates an old response without clearing the new single-flight slot',async()=>{
    const firstAccount=await confirmedTrailUser(env,'proof-switch-first'),secondAccount=await confirmedTrailUser(env,'proof-switch-second');
    const ready=[Promise.withResolvers<void>(),Promise.withResolvers<void>()],release=[Promise.withResolvers<void>(),Promise.withResolvers<void>()];
    let calls=0;
    const proof=authCoordinationProof(async(path,init)=>{
      const response=await forward(path,init);
      if(path==='/api/auth/v1/refresh'){
        const index=calls++;await response.clone().arrayBuffer();ready[index].resolve();await release[index].promise;
      }
      return response;
    });
    await proof.login(firstAccount.email,firstAccount.password);
    const old=proof.refresh();let current:Promise<boolean>|undefined;
    try {
      await deadline(ready[0].promise);
      await proof.login(secondAccount.email,secondAccount.password);
      current=proof.refresh();await deadline(ready[1].promise);
      release[0].resolve();await expect(deadline(old)).rejects.toMatchObject({name:'StaleAuthProofOperation'});
      const joined=proof.refresh();expect(joined).toBe(current);expect(calls).toBe(2);
      release[1].resolve();expect(await deadline(Promise.all([current,joined]))).toEqual([true,true]);
      const id=nativeUuid(randomUUID());
      await secondAccount.client.records('todos').create({id,user_id:secondAccount.user.id,title:`switch-${randomUUID()}`});
      const response=await forward('/api/records/v1/todos',{headers:proof.headers()});expect(response.ok).toBe(true);
      expect((await response.json()).records.map((row:Record<string,unknown>)=>row.id)).toEqual([id]);
      await proof.logout();expect(proof.tokens()).toBeUndefined();
    } finally {for(const gate of release)gate.resolve();await Promise.allSettled(current?[old,current]:[old]);}
  });
  it('logout proof clears locally before I/O and surfaces an undelivered remote revocation',async()=>{
    const account=await confirmedTrailUser(env,'proof-outage');let outage=false;
    const proof=authCoordinationProof((path,init)=>{
      if(outage&&path==='/api/auth/v1/logout')throw new TypeError('Injected owned logout failure');
      return forward(path,init);
    });
    await proof.login(account.email,account.password);const before=proof.tokens()!.refresh_token!,beforeHeaders=proof.headers();
    outage=true;const pending=proof.logout();expect(proof.tokens()).toBeUndefined();
    await expect(pending).rejects.toThrow('Injected owned logout failure');
    expect((await forward('/api/records/v1/todos',{headers:proof.headers()})).status).toBe(403);
    expect((await remoteRefresh(before)).status).toBe(200);
    // Restore transport; revoke only this generated session through its original credentials.
    outage=false;
    expect((await forward('/api/auth/v1/logout',{method:'POST',headers:beforeHeaders,body:JSON.stringify({refresh_token:before})})).ok).toBe(true);
    expect((await remoteRefresh(before)).status).toBe(401);
  });
});
