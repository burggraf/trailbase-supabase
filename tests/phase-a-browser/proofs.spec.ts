/// <reference lib="es2024.promise" />
import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context,confirmedTrailUser,nativeUuid } from '../phase-a/helpers.js';

// Real browser execution of isolated proof modules, NOT a public SDK/UI contract suite.
test('L1-27/G5/G7 browser proof: real UTF-8 SSE, abort and guarded late refresh after logout',async({page})=>{
  const env=await context(),account=await confirmedTrailUser(env,'browser-proof');
  await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  await page.goto(env.trailUrl);
  const result=await page.evaluate(async({base,email,password,owner,id,title})=>{
    const {authCoordinationProof}:typeof import('../proofs/auth-coordination.js')=await import(`${base}/proofs/auth-coordination.js`);
    const {nativeSseProof}:typeof import('../proofs/native-sse.js')=await import(`${base}/proofs/native-sse.js`);
    const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let hold=false;
    const proof=authCoordinationProof(async(path:string,init?:RequestInit)=>{
      const response=await fetch(`${base}${path}`,{...init,credentials:'omit',signal:AbortSignal.timeout(10000)});
      if(hold&&path==='/api/auth/v1/refresh'){await response.clone().arrayBuffer();ready.resolve();await release.promise;}
      return response;
    });
    await proof.login(email,password);
    const response=await fetch(`${base}/api/records/v1/todos/subscribe/*`,{headers:proof.headers(),credentials:'omit'});
    if(!response.ok||!response.body)throw new Error('Real browser stream unavailable');
    const bytes=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){for(const byte of chunk)controller.enqueue(new Uint8Array([byte]));}}));
    const abort=new AbortController(),parser=nativeSseProof(bytes,{signal:abort.signal});
    const wait=async<T>(promise:Promise<T>):Promise<T>=>{
      let timer:ReturnType<typeof setTimeout>;
      try{return await Promise.race([promise,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('Browser proof deadline exceeded')),10000);})]);}
      finally{clearTimeout(timer!);}
    };
    try {
      let pending=parser.next();
      const inserted=await fetch(`${base}/api/records/v1/todos`,{method:'POST',credentials:'omit',headers:proof.headers(),body:JSON.stringify({id,user_id:owner,title})});
      if(!inserted.ok)throw new Error('Real browser proof insert failed');await inserted.body?.cancel();
      const insert=(await wait(pending)).value;
      if(!insert||!('Insert' in insert)||insert.Insert.title!==title||insert.Insert.id!==id)throw new Error('Browser UTF-8 insert mismatch');
      pending=parser.next();
      const deleted=await fetch(`${base}/api/records/v1/todos/${id}`,{method:'DELETE',credentials:'omit',headers:proof.headers()});
      if(!deleted.ok)throw new Error('Real browser proof delete failed');await deleted.body?.cancel();
      const deletion=(await wait(pending)).value;
      if(!deletion||!('Delete' in deletion)||deletion.Delete.id!==id)throw new Error('Browser delete mismatch');
      const rows=await fetch(`${base}/api/records/v1/todos`,{headers:proof.headers(),credentials:'omit'});
      if(!rows.ok||(await rows.json()).records.length!==0)throw new Error('Browser proof row cleanup failed');
      pending=parser.next();abort.abort();let aborted=false;
      try{await wait(pending);}catch(error){aborted=(error as Error).name==='AbortError';}
      if(!aborted||bytes.locked)throw new Error('Browser stream abort/reader cleanup failed');
      hold=true;
      const refresh=proof.refresh();
      try {
        await wait(ready.promise);await proof.logout();
        if(proof.tokens()!==undefined)throw new Error('Browser logout did not clear cache');
        release.resolve();let stale=false;
        try{await wait(refresh);}catch(error){stale=(error as Error).name==='StaleAuthProofOperation';}
        if(!stale||proof.tokens()!==undefined)throw new Error('Browser late refresh restored state');
        const denied=await fetch(`${base}/api/records/v1/todos`,{headers:proof.headers(),credentials:'omit'});
        const protectedDenied=denied.status===403;await denied.body?.cancel();
        return {unicode:true,delete:true,abort:true,logoutRace:true,protectedDenied};
      } finally {release.resolve();await Promise.allSettled([refresh]);}
    } finally {abort.abort();await parser.return(undefined);}
  },{base:env.trailUrl,email:account.email,password:account.password,owner:account.user.id,id:nativeUuid(randomUUID()),title:`browser-proof-${randomUUID()}-雪é-e\u0301`});
  expect(result).toEqual({unicode:true,delete:true,abort:true,logoutRace:true,protectedDenied:true});
});

for(const operation of ['refresh','status'] as const)for(const stage of ['response','json'] as const) {
  test(`L1-27/G7/S04/S08 browser proof: terminal revocation rejects late ${operation} at ${stage} completion`,async({page})=>{
    const env=await context(),account=await confirmedTrailUser(env,`b-term-${operation}-${stage}`);
    await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
    await page.goto(env.trailUrl);
    const result=await page.evaluate(async({base,email,password,operation,stage})=>{
      const {authCoordinationProof}:typeof import('../proofs/auth-coordination.js')=await import(`${base}/proofs/auth-coordination.js`);
      const ready=Promise.withResolvers<number>(),release=Promise.withResolvers<void>();
      const forward=(path:string,init?:RequestInit)=>fetch(`${base}${path}`,{...init,credentials:'omit',signal:AbortSignal.timeout(10000)});
      const wait=async<T>(promise:Promise<T>):Promise<T>=>{
        let timer:ReturnType<typeof setTimeout>;
        try{return await Promise.race([promise,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('Browser revocation deadline exceeded')),10000);})]);}
        finally{clearTimeout(timer!);}
      };
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
      await proof.login(email,password);
      const pending=operation==='refresh'?proof.refresh():proof.validate();
      try {
        if(await wait(ready.promise)!==200)throw new Error('Browser held response was not successful');
        const revoked=await forward('/api/auth/v1/logout',{method:'POST',headers:proof.headers(),body:JSON.stringify({refresh_token:proof.tokens()!.refresh_token})});
        if(!revoked.ok)throw new Error('Browser remote revocation failed');await revoked.body?.cancel();
        let terminal=false;
        try{await wait<unknown>(operation==='refresh'?proof.validate():proof.refresh());}
        catch(error){terminal=(error as {name:string;status:number}).name==='AuthProofHttpError'&&(error as {status:number}).status===401;}
        if(!terminal||proof.tokens()!==undefined)throw new Error('Browser terminal denial did not clear cache');
        release.resolve();let stale=false;
        try{await wait<unknown>(pending);}catch(error){stale=(error as Error).name==='StaleAuthProofOperation';}
        if(!stale||proof.tokens()!==undefined||await proof.refresh())throw new Error('Browser revoked state was restored');
        const denied=await forward('/api/records/v1/todos',{headers:proof.headers()});
        if(denied.status!==403)throw new Error('Browser revoked proof retained protected access');await denied.body?.cancel();
        await proof.login(email,password);if(!await proof.refresh())throw new Error('Browser genuine relogin refresh failed');
        const read=await forward('/api/records/v1/todos',{headers:proof.headers()});
        if(!read.ok)throw new Error('Browser genuine relogin access failed');await read.body?.cancel();
        await proof.logout();if(proof.tokens()!==undefined)throw new Error('Browser recovery logout failed');
        return {terminal:true,stale:true,protectedDenied:true,recovered:true,signedOut:true};
      } finally {release.resolve();await Promise.allSettled([pending]);}
    },{base:env.trailUrl,email:account.email,password:account.password,operation,stage});
    expect(result).toEqual({terminal:true,stale:true,protectedDenied:true,recovered:true,signedOut:true});
  });
}
