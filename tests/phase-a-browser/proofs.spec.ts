/// <reference lib="es2024.promise" />
import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { context,confirmedTrailUser,confirmedSupabaseUser,nativeUuid } from '../phase-a/helpers.js';
import { redirectSink } from '../proofs/redirect-sink.js';

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

test('L1-27/G5/G6/S09 browser proof: 100 stream lifecycles release readers with exact live-control barriers',async({page})=>{
  test.setTimeout(120000);
  const env=await context(),account=await confirmedTrailUser(env,'b-stream-cycles');
  await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  await page.goto(env.trailUrl);
  const result=await page.evaluate(async({base,headers,owner,id,title})=>{
    const {nativeSseProof}:typeof import('../proofs/native-sse.js')=await import(`${base}/proofs/native-sse.js`);
    const request=async(path:string,init?:RequestInit)=>{
      const response=await fetch(`${base}${path}`,{...init,headers:{'content-type':'application/json',...headers},credentials:'omit',signal:init?.signal??AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error(`Browser lifecycle real request failed: ${init?.method??'GET'} HTTP ${response.status}`);return response;
    };
    const wait=async<T>(promise:Promise<T>):Promise<T>=>{
      let timer:ReturnType<typeof setTimeout>;
      try{return await Promise.race([promise,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('Browser lifecycle deadline exceeded')),10000);})]);}
      finally{clearTimeout(timer!);}
    };
    await (await request('/api/records/v1/todos',{method:'POST',body:JSON.stringify({id,user_id:owner,title})})).body?.cancel();
    const controlAbort=new AbortController(),controlResponse=await request('/api/records/v1/todos/subscribe/*',{signal:controlAbort.signal});
    if(!controlResponse.body)throw new Error('Browser lifecycle control body missing');
    const control=nativeSseProof(controlResponse.body,{signal:controlAbort.signal});let closed=0;
    try {
      for(let cycle=0;cycle<100;cycle++){
        const abort=new AbortController(),response=await request('/api/records/v1/todos/subscribe/*',{signal:abort.signal});
        if(!response.body)throw new Error('Browser lifecycle body missing');
        const parser=nativeSseProof(response.body,{signal:abort.signal});
        try {
          const pending=parser.next(),barrier=control.next(),note=`cycle-${cycle}`;
          await (await request(`/api/records/v1/todos/${id}`,{method:'PATCH',body:JSON.stringify({note})})).body?.cancel();
          for(const event of [(await wait(pending)).value,(await wait(barrier)).value]){
            if(!event||!('Update' in event)||event.Update.id!==id||event.Update.user_id!==owner||event.Update.note!==note)throw new Error('Browser lifecycle live barrier mismatch');
          }
          if(cycle%2===0){
            const pendingClose=parser.next();abort.abort();let aborted=false;
            try{await wait(pendingClose);}catch(error){aborted=(error as Error).name==='AbortError';}
            if(!aborted)throw new Error('Browser lifecycle pending abort not observable');
          }else await wait(parser.return(undefined));
          await parser.return(undefined);
          if(!(await parser.next()).done||response.body.locked)throw new Error('Browser lifecycle reader/delivery retained');
          closed++;
        }finally{abort.abort();await parser.return(undefined).catch(()=>{});}
      }
      const pending=control.next();await (await request(`/api/records/v1/todos/${id}`,{method:'DELETE'})).body?.cancel();
      const event=(await wait(pending)).value;
      if(!event||!('Delete' in event)||event.Delete.id!==id)throw new Error('Browser lifecycle final barrier mismatch');
      if((await (await request('/api/records/v1/todos')).json()).records.length!==0)throw new Error('Browser lifecycle rows retained');
    }finally{controlAbort.abort();await wait(control.return(undefined));}
    return {closed,controlUnlocked:!controlResponse.body.locked};
  },{base:env.trailUrl,headers:account.client.headers(),owner:account.user.id,id:nativeUuid(randomUUID()),title:`b-cycles-${randomUUID()}`});
  expect(result).toEqual({closed:100,controlUnlocked:true});
});

test('L1-27/G6/S09 reference browser: 100 CDC-ready channels remove without late callbacks and explicitly disconnect',async({page})=>{
  test.setTimeout(180000);
  const env=await context(),account=await confirmedSupabaseUser(env,'b-ref-cycles'),id=randomUUID(),controlId=randomUUID();
  await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  await page.goto(env.trailUrl);await page.addScriptTag({url:`${env.trailUrl}/fixtures/supabase.js`});
  const result=await page.evaluate(async({base,anon,email,password,owner,id,controlId})=>{
    const client=window.supabase.createClient(base,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const wait=async<T>(promise:PromiseLike<T>):Promise<T>=>{
      let timer:ReturnType<typeof setTimeout>;
      try{return await Promise.race([promise,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('Reference browser lifecycle deadline exceeded')),10000);})]);}
      finally{clearTimeout(timer!);}
    };
    const login=await client.auth.signInWithPassword({email,password});
    if(login.error||login.data.user?.id!==owner)throw new Error('Reference browser lifecycle login failed');
    const queue:{eventType:string;new:Record<string,unknown>;old:Record<string,unknown>}[]=[];let notify:(()=>void)|undefined;
    const retired:number[]=[],control=client.channel(`control-${id}`,{config:{postgres_changes_options:{wait:true}}})
      .on('postgres_changes',{event:'*',schema:'public',table:'todos'},event=>{queue.push(event);notify?.();});
    const ready=(channel:typeof control)=>wait(new Promise<void>((yes,no)=>channel.subscribe(status=>{
      if(status==='SUBSCRIBED')yes();
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')no(new Error('Reference browser lifecycle CDC startup failed'));
    })));
    const take=async()=>{
      if(!queue.length)await wait(new Promise<void>(yes=>{notify=yes;}));notify=undefined;
      const event=queue.shift();if(!event)throw new Error('Reference browser lifecycle control event missing');return event;
    };
    try {
      await ready(control);
      for(const row of [{id,user_id:owner,title:`cycle-${id}`,note:'initial'},{id:controlId,user_id:owner,title:`control-${controlId}`,note:'unchanged'}]){
        if((await client.from('todos').insert(row)).error)throw new Error('Reference browser lifecycle seed failed');
        const event=await take();
        if(event.eventType!=='INSERT'||event.new.id!==row.id||event.new.user_id!==owner||event.new.title!==row.title||event.new.note!==row.note)throw new Error('Reference browser lifecycle seed event mismatch');
      }
      const before=await client.from('todos').select('*').eq('id',controlId).single();
      if(before.error)throw new Error('Reference browser lifecycle control read failed');
      for(let cycle=0;cycle<100;cycle++){
        retired.push(0);const eventReady=Promise.withResolvers<Record<string,unknown>>();
        const channel=client.channel(`cycle-${id}-${cycle}`,{config:{postgres_changes_options:{wait:true}}})
          .on('postgres_changes',{event:'UPDATE',schema:'public',table:'todos'},event=>{retired[cycle]++;eventReady.resolve(event.new);});
        try {
          await ready(channel);
          if(client.getChannels().length!==2)throw new Error('Reference browser lifecycle registry grew');
          for(const removed of [false,true]){
            if(removed){
              if(await wait(client.removeChannel(channel))!=='ok'||await wait(client.removeChannel(channel))!=='ok')throw new Error('Reference browser lifecycle leave failed');
              if(client.getChannels().length!==1||client.getChannels()[0]!==control||!client.realtime.isConnected())throw new Error('Reference browser lifecycle removed live control');
            }
            const note=`${removed?'closed':'cycle'}-${cycle}`;
            if((await client.from('todos').update({note}).eq('id',id)).error)throw new Error('Reference browser lifecycle write failed');
            if(!removed){const row=await wait(eventReady.promise);if(row.id!==id||row.user_id!==owner||row.note!==note)throw new Error('Reference browser lifecycle event mismatch');}
            const event=await take();
            if(event.eventType!=='UPDATE'||event.new.id!==id||event.new.user_id!==owner||event.new.note!==note)throw new Error('Reference browser lifecycle live barrier mismatch');
          }
          if(retired.some(count=>count!==1))throw new Error('Reference browser lifecycle late callback');
        }finally{await wait(client.removeChannel(channel));}
      }
      const rows=await client.from('todos').select('*').eq('id',controlId).single();
      if(rows.error||JSON.stringify(rows.data)!==JSON.stringify(before.data))throw new Error('Reference browser lifecycle changed control row');
      if((await client.from('todos').delete().eq('id',id)).error)throw new Error('Reference browser lifecycle delete failed');
      const event=await take();
      if(event.eventType!=='DELETE'||Object.keys(event.old).length!==1||event.old.id!==id||Object.keys(event.new).length!==0||queue.length||retired.some(count=>count!==1))throw new Error('Reference browser lifecycle delete/retired barrier failed');
      const after=await client.from('todos').select('*');
      if(after.error||after.data?.length!==1||JSON.stringify(after.data[0])!==JSON.stringify(before.data))throw new Error('Reference browser lifecycle row postcondition failed');
    }finally{
      const removed=await wait(client.removeAllChannels());
      if(removed.length!==1||removed[0]!=='ok'||client.getChannels().length||client.realtime.isConnected())throw new Error('Reference browser lifecycle teardown failed');
      if((await wait(client.removeAllChannels())).length)throw new Error('Reference browser repeated teardown failed');
      if((await client.auth.signOut({scope:'local'})).error)throw new Error('Reference browser owned session cleanup failed');
    }
    return {cycles:retired.length,noLateCallbacks:retired.every(count=>count===1),disconnected:!client.realtime.isConnected()};
  },{base:env.supabaseUrl,anon:env.anonKey,email:account.email,password:account.password,owner:account.user.id,id,controlId});
  expect(result).toEqual({cycles:100,noLateCallbacks:true,disconnected:true});
});

test('L1-27/G7/S04/S09 browser proof: local revocation and opaque global redirect remain observable',async({page})=>{
  const env=await context(),account=await confirmedTrailUser(env,'browser-scopes');
  await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  await page.goto(env.trailUrl);
  const result=await page.evaluate(async({base,email,password})=>{
    const {authCoordinationProof}:typeof import('../proofs/auth-coordination.js')=await import(`${base}/proofs/auth-coordination.js`);
    const forward=(path:string,init?:RequestInit)=>fetch(`${base}${path}`,{...init,credentials:'omit',signal:AbortSignal.timeout(10000)});
    let calls=0,opaque=false;
    const first=authCoordinationProof(async(path,init)=>{
      const response=await forward(path,init);
      if(path==='/api/auth/v1/logout'){
        calls++;
        if(init?.method==='GET')opaque=response.type==='opaqueredirect'&&response.status===0&&response.headers.get('location')===null;
      }
      return response;
    }),sibling=authCoordinationProof(forward);
    const refresh=async(token:string)=>{
      const response=await forward('/api/auth/v1/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:token})});
      const status=response.status;await response.body?.cancel();return status;
    };
    await first.login(email,password);await sibling.login(email,password);
    const local=first.tokens()!.refresh_token!,other=sibling.tokens()!.refresh_token!;
    await first.logout('local');await first.logout('local');
    const localRevoked=await refresh(local)===401,siblingAlive=await refresh(other)===200,localCalls=calls===1;
    await first.login(email,password);const global=first.tokens()!.refresh_token!;
    let visibleError=false;
    try{await first.logout('global');}
    catch(error){visibleError=(error as {name:string;status:number}).name==='AuthProofHttpError'&&(error as {status:number}).status===0;}
    const bothRevoked=await refresh(global)===401&&await refresh(other)===401;
    await first.logout('global');const noReplay=calls===2;
    const denied=await forward('/api/records/v1/todos',{headers:first.headers()});
    const protectedDenied=denied.status===403;await denied.body?.cancel();
    // Root-enabled fixture redirects are opaque in browser manual mode; do not
    // pretend status 0 is a proven successful logout or follow arbitrary origins.
    return {localRevoked,siblingAlive,localCalls,opaque,visibleError,bothRevoked,noReplay,protectedDenied,signedOut:first.tokens()===undefined};
  },{base:env.trailUrl,email:account.email,password:account.password});
  expect(result).toEqual({localRevoked:true,siblingAlive:true,localCalls:true,opaque:true,visibleError:true,bothRevoked:true,noReplay:true,protectedDenied:true,signedOut:true});
});

test('L1-27/G7/S01/S04 browser candidate: fixed acknowledgement, anonymous false-success boundary and foreign redirect credential isolation',async({page,browserName})=>{
  const env=await context(),account=await confirmedTrailUser(env,'b-ack'),sink=await redirectSink();
  const allowed=[...env.origins,new URL(sink.url).origin];
  await page.context().route('**/*',route=>allowed.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  await page.context().addCookies([{name:'owned-redirect-marker',value:'fixture-cookie',url:sink.url}]);
  try {
    await page.goto(env.trailUrl);
    const result=await page.evaluate(async({base,email,password,sinkUrl})=>{
      const {authCoordinationProof}:typeof import('../proofs/auth-coordination.js')=await import(`${base}/proofs/auth-coordination.js`);
      let phase='initialization';
      const forward=async(path:string,init?:RequestInit)=>{
        try{return await fetch(`${base}${path}`,{...init,credentials:'omit',signal:AbortSignal.timeout(10000)});}
        catch(cause){throw new Error(`Browser candidate fetch failure at ${phase}`,{cause});}
      };
      const first=authCoordinationProof(forward),sibling=authCoordinationProof(forward);
      const refresh=async(token:string)=>{
        const response=await forward('/api/auth/v1/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:token})});
        const status=response.status;await response.body?.cancel();return status;
      };
      for(const credential of ['anonymous','invalid','genuine'] as const){
        phase=`login-${credential}`;await first.login(email,password);await sibling.login(email,password);
        const one=first.tokens()!,two=sibling.tokens()!.refresh_token!;
        const headers:Record<string,string>=credential==='anonymous'?{}:{Authorization:`Bearer ${credential==='genuine'?one.auth_token:'fixture-invalid-jwt'}`};
        phase=`fixed-ack-${credential}`;
        const response=await forward('/api/auth/v1/logout?redirect_uri=%2Fapi%2Fhealthcheck',{method:'GET',headers,redirect:'follow'});
        if(response.status!==200||!response.redirected||response.url!==`${base}/api/healthcheck`)throw new Error('Browser fixed acknowledgement path mismatch');
        await response.body?.cancel();
        const expected=credential==='genuine'?401:200;phase=`revocation-probe-${credential}`;
        if(await refresh(one.refresh_token!)!==expected||await refresh(two)!==expected)throw new Error('Browser acknowledgement mistaken for authenticated revocation');
        phase=`local-cleanup-${credential}`;await first.logout();await sibling.logout();
      }
      phase='foreign-login';await first.login(email,password);const current=first.tokens()!;
      const target=new URL(sinkUrl),relative=`//${target.host}${target.pathname}`;
      phase='foreign-redirect';
      let foreignRejected=false,foreignBlocked=false;
      try {
        const redirected=await forward(`/api/auth/v1/logout?redirect_uri=${encodeURIComponent(relative)}`,{method:'GET',headers:{Authorization:`Bearer ${current.auth_token}`},redirect:'follow'});
        foreignRejected=redirected.status===200&&redirected.url===sinkUrl&&new URL(redirected.url).origin!==base;
        await redirected.body?.cancel();
      } catch(error) {
        // The diagnostic run located pinned Firefox/WebKit failures specifically
        // here, with zero accepted GET arrivals. Blocking is not an auth receipt.
        foreignBlocked=(error as Error).cause instanceof TypeError;
        if(!foreignBlocked)throw error;
      }
      phase='foreign-revocation-probe';
      if(!(foreignRejected||foreignBlocked)||await refresh(current.refresh_token!)!==401)throw new Error('Browser foreign response accepted as native acknowledgement or revocation unproven');
      return {fixedPath:true,anonymousNotRevoked:true,invalidNotRevoked:true,genuineBothRevoked:true,foreignRejected,foreignBlocked};
    },{base:env.trailUrl,email:account.email,password:account.password,sinkUrl:sink.url});
    expect(result).toEqual({fixedPath:true,anonymousNotRevoked:true,invalidNotRevoked:true,genuineBothRevoked:true,foreignRejected:browserName==='chromium',foreignBlocked:browserName!=='chromium'});
    expect(sink.stats()).toMatchObject({getRequests:browserName==='chromium'?1:0,authorization:false,refresh:false,csrf:false,cookie:false,bodyBytes:0,listening:true});
    // Count every known-route request, including rejected OPTIONS/preflight, so
    // credential absence is not inferred solely from a missing GET.
    expect(sink.stats().requests).toBeGreaterThanOrEqual(sink.stats().getRequests);
    expect(sink.stats().requests).toBeLessThanOrEqual(1);
    expect((await page.context().cookies()).some(cookie=>cookie.name==='owned-redirect-marker')).toBe(true);
  } finally {
    await sink.close();expect(sink.stats().listening).toBe(false);
    await writeFile(`${env.directory}/redirect-sink-${browserName}.json`,JSON.stringify(sink.stats()),{mode:0o600});
  }
});

for(const stage of ['response','json'] as const)for(const outage of [false,true]) {
  test(`L1-27/G7/S04/S08 browser discarded login ${stage}, cleanup outage ${outage}: exact-session cleanup preserves newer account`,async({page})=>{
    const env=await context(),first=await confirmedTrailUser(env,`b-old-${stage}`),second=await confirmedTrailUser(env,`b-new-${stage}`);
    await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
    await page.goto(env.trailUrl);
    const result=await page.evaluate(async({base,oldEmail,oldPassword,email,password,owner,id,stage,outage})=>{
      const {authCoordinationProof}:typeof import('../proofs/auth-coordination.js')=await import(`${base}/proofs/auth-coordination.js`);
      const forward=(path:string,init?:RequestInit)=>fetch(`${base}${path}`,{...init,credentials:'omit',signal:AbortSignal.timeout(10000)});
      const wait=async<T>(promise:Promise<T>):Promise<T>=>{
        let timer:ReturnType<typeof setTimeout>;
        try{return await Promise.race([promise,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('Browser discarded-login deadline exceeded')),10000);})]);}
        finally{clearTimeout(timer!);}
      };
      let created:ReturnType<ReturnType<typeof authCoordinationProof>['tokens']>,logins=0,attempts=0;
      const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
      const proof=authCoordinationProof(async(path,init)=>{
        if(path==='/api/auth/v1/logout'&&created&&JSON.parse(String(init?.body)).refresh_token===created.refresh_token){
          attempts++;const headers=new Headers(init?.headers);
          if(init?.method!=='POST'||init.credentials!=='omit'||init.redirect!=='error'||headers.has('authorization')||headers.has('refresh-token')||headers.has('csrf-token'))throw new Error('Browser discarded-session credential boundary failed');
          if(outage)throw new TypeError('Injected discarded-session cleanup outage');
        }
        const response=await forward(path,init);
        if(path==='/api/auth/v1/login'&&logins++===0){
          created=await response.clone().json();
          if(stage==='response'){ready.resolve();await release.promise;}
          else {
            const json=response.json.bind(response);
            response.json=async()=>{const actual=await json();ready.resolve();await release.promise;return actual;};
          }
        }
        return response;
      });
      const sibling=authCoordinationProof(forward);await sibling.login(oldEmail,oldPassword);const siblingToken=sibling.tokens()!.refresh_token!;
      const refresh=async(token:string)=>{
        const response=await forward('/api/auth/v1/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:token})});
        const status=response.status;await response.body?.cancel();return status;
      };
      const pending=proof.login(oldEmail,oldPassword);
      try {
        await wait(ready.promise);await proof.login(email,password);const current=proof.tokens();release.resolve();
        let stale=false;
        try{await wait(pending);}catch(error){stale=(error as {name:string;cleanupFailed:boolean}).name==='StaleAuthProofOperation'&&(error as {cleanupFailed:boolean}).cleanupFailed===outage;}
        if(!stale||attempts!==1||proof.tokens()!==current)throw new Error('Browser stale login changed newer state or hid cleanup failure');
        if(await refresh(created!.refresh_token!)!==(outage?200:401)||await refresh(siblingToken)!==200)throw new Error('Browser discarded-session/sibling revocation mismatch');
        if(!await proof.refresh())throw new Error('Browser newer session refresh failed');
        const write=await forward('/api/records/v1/todos',{method:'POST',headers:proof.headers(),body:JSON.stringify({id,user_id:owner,title:`browser-cleanup-${id}`})});
        if(!write.ok)throw new Error('Browser newer owner write failed');await write.body?.cancel();
        const read=await forward('/api/records/v1/todos',{headers:proof.headers()});
        if(!read.ok||(await read.json()).records.map((row:{id:string})=>row.id).join()!==id)throw new Error('Browser newer owner isolation failed');
        await proof.logout();await sibling.logout();
        if(attempts!==1||proof.tokens()!==undefined)throw new Error('Browser cleanup replay or local resurrection');
        return {stale:true,exactAttempt:true,newerPreserved:true,siblingPreserved:true,remoteCleanup:!outage,cleanupFailure:outage,signedOut:true};
      } finally {
        release.resolve();await Promise.allSettled([pending]);
        if(created){const cleaned=await forward('/api/auth/v1/logout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:created.refresh_token})});if(!cleaned.ok)throw new Error('Owned discarded-session final cleanup failed');await cleaned.body?.cancel();}
      }
    },{base:env.trailUrl,oldEmail:first.email,oldPassword:first.password,email:second.email,password:second.password,owner:second.user.id,id:nativeUuid(randomUUID()),stage,outage});
    expect(result).toEqual({stale:true,exactAttempt:true,newerPreserved:true,siblingPreserved:true,remoteCleanup:!outage,cleanupFailure:outage,signedOut:true});
  });
}

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
