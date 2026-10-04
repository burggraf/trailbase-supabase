/// <reference lib="es2024.promise" />
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { initClient } from 'trailbase';
import { createClient } from '@supabase/supabase-js';
import { context, confirmedTrailUser, confirmedSupabaseUser, deadline, type Context } from './helpers.js';

let env: Context;
beforeAll(async()=>{env=await context();});
const nativeFetch=(path:string,init?:RequestInit)=>fetch(new URL(path,env.trailUrl),{...init,signal:AbortSignal.timeout(10000)});
const nativeRefresh=(refresh_token:string)=>nativeFetch('/api/auth/v1/refresh',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token})
});

describe('L1-27 G7/S04 upstream auth lifecycle/races, NOT SDK lifecycle signoff',()=>{
  it('reference owned persistent storage hydrates real sessions and observes shared-store logout',async()=>{
    const account=await confirmedSupabaseUser(env,'storage');
    const values=new Map<string,string>();
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
    const options={auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage,storageKey:`fixture-${env.id}-storage`}};
    const first=createClient(env.supabaseUrl,env.anonKey,options);
    const login=await first.auth.signInWithPassword({email:account.email,password:account.password});
    expect(login.error).toBeNull();expect(values.size).toBeGreaterThan(0);
    const second=createClient(env.supabaseUrl,env.anonKey,options);
    const hydrated=await second.auth.getSession();
    expect(hydrated.error).toBeNull();expect(hydrated.data.session?.user.id===account.user.id).toBe(true);
    const validated=await second.auth.getUser();expect(validated.error).toBeNull();expect(validated.data.user?.id===account.user.id).toBe(true);
    expect((await first.auth.signOut()).error).toBeNull();
    expect((await second.auth.getSession()).data.session).toBeNull();
    expect(values.size).toBe(0);
    const read=await second.from('todos').select('*');expect(read.error).not.toBeNull();expect(read.data).toBeNull();
  });
  for(const ordering of ['unawaited','awaited'] as const) {
    it(`reference ${ordering} async hydration must not notify recovered A after genuine newer B login`,async()=>{
      const a=await confirmedSupabaseUser(env,'hydrate-a'),b=await confirmedSupabaseUser(env,'hydrate-b');
      const aid=randomUUID(),bid=randomUUID(),key=`fixture-${env.id}-hydrate-${ordering}`;
      for(const [account,id] of [[a,aid],[b,bid]] as const)expect((await account.client.from('todos').insert({id,user_id:account.user.id,title:`hydrate-${id}`,note:'unchanged'})).error).toBeNull();
      const beforeA=await a.client.from('todos').select('*').eq('id',aid).single(),beforeB=await b.client.from('todos').select('*').eq('id',bid).single();
      expect(beforeA.error).toBeNull();expect(beforeB.error).toBeNull();
      const seed=await a.client.auth.getSession();expect(seed.error).toBeNull();expect(seed.data.session?.user.id===a.user.id).toBe(true);
      const values=new Map([[key,JSON.stringify(seed.data.session)],['owned-unrelated','keep']]);
      const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),initial=Promise.withResolvers<void>();
      let held=false,passwordRequests=0;
      const client=createClient(env.supabaseUrl,env.anonKey,{
        auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storageKey:key,storage:{
          getItem:async(name:string)=>{const snapshot=values.get(name)??null;if(name===key&&!held){held=true;ready.resolve();await release.promise;}return snapshot;},
          setItem:(name:string,value:string)=>{values.set(name,value);},removeItem:(name:string)=>{values.delete(name);}
        }},
        global:{fetch:(input,init)=>{
          const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
          if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password')passwordRequests++;
          return fetch(input,init);
        }}
      });
      const events:{event:string;owner:'A'|'B'|'none'|'other'}[]=[];
      const subscription=client.auth.onAuthStateChange((event,session)=>{
        events.push({event,owner:!session?'none':session.user.id===a.user.id?'A':session.user.id===b.user.id?'B':'other'});
        if(event==='INITIAL_SESSION')initial.resolve();
      }).data.subscription;
      let pending:ReturnType<typeof client.auth.signInWithPassword>|undefined;
      try {
        await deadline(ready.promise);
        pending=(async()=>{if(ordering==='awaited')await client.auth.initialize();return client.auth.signInWithPassword({email:b.email,password:b.password});})();
        if(ordering==='awaited'){
          await new Promise<void>(yes=>setImmediate(yes)); // Drain ready tasks, not a timing sleep.
          expect(passwordRequests).toBe(0);release.resolve();
        }
        const login=await deadline(pending);expect(login.error).toBeNull();expect(login.data.user?.id===b.user.id).toBe(true);
        release.resolve();expect((await deadline(client.auth.initialize())).error).toBeNull();await deadline(initial.promise);
        const cached=await client.auth.getSession(),validated=await client.auth.getUser(),rows=await client.from('todos').select('*');
        const unchangedA=await a.client.from('todos').select('*').eq('id',aid).single(),unchangedB=await b.client.from('todos').select('*').eq('id',bid).single();
        expect(cached.error).toBeNull();expect(validated.error).toBeNull();expect(rows.error).toBeNull();
        expect(cached.data.session?.user.id===b.user.id).toBe(true);expect(validated.data.user?.id===b.user.id).toBe(true);
        expect(rows.data).toEqual([beforeB.data]);expect(unchangedA).toEqual(beforeA);expect(unchangedB).toEqual(beforeB);
        expect(JSON.parse(values.get(key)??'null')?.user?.id===b.user.id).toBe(true);expect(passwordRequests).toBe(1);
        // Fixed labels/booleans only; never serialize the genuine session/rows/IDs.
        await writeFile(`${env.directory}/reference-hydration-${ordering}.json`,JSON.stringify({ordering,events,passwordRequests,cachedB:true,validatedB:true,onlyBRow:true,controlsUnchanged:true}),{mode:0o600});
        const signedIn=events.filter(event=>event.event==='SIGNED_IN').map(event=>event.owner),newer=signedIn.indexOf('B');
        expect(newer).toBeGreaterThanOrEqual(0);expect(signedIn.slice(newer+1)).not.toContain('A');
        subscription.unsubscribe();subscription.unsubscribe();const count=events.length;
        expect((await client.auth.signOut({scope:'local'})).error).toBeNull();expect(events.length).toBe(count);
        expect((await client.auth.getSession()).data.session).toBeNull();expect(values.get('owned-unrelated')).toBe('keep');expect(values.has(key)).toBe(false);
        const denied=await client.from('todos').select('*');expect(denied.error).not.toBeNull();expect(denied.data).toBeNull();
      } finally {
        release.resolve();await Promise.allSettled(pending?[pending]:[]);subscription.unsubscribe();
        expect((await deadline(client.auth.signOut({scope:'local'}))).error).toBeNull();
        for(const [account,id] of [[a,aid],[b,bid]] as const){expect((await account.client.from('todos').delete().eq('id',id)).error).toBeNull();expect((await account.client.auth.signOut({scope:'local'})).error).toBeNull();}
      }
    });
  }
  it('reference storage write failure is observable, installs no local session and recovers with real login',async()=>{
    const account=await confirmedSupabaseUser(env,'storage-fault');
    const values=new Map<string,string>();let fail=true;
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storageKey:`fixture-${env.id}-storage-fault`,storage:{
        getItem:(key:string)=>values.get(key)??null,
        setItem:(key:string,value:string)=>{if(fail)throw new Error('Injected owned storage write failure');values.set(key,value);},
        removeItem:(key:string)=>{values.delete(key);}
      }}
    });
    await expect(client.auth.signInWithPassword({email:account.email,password:account.password})).rejects.toThrow('Injected owned storage write failure');
    expect((await client.auth.getSession()).data.session).toBeNull();expect(values.size).toBe(0);
    const denied=await client.from('todos').select('*');expect(denied.error).not.toBeNull();expect(denied.data).toBeNull();
    fail=false;
    const recovered=await client.auth.signInWithPassword({email:account.email,password:account.password});
    expect(recovered.error).toBeNull();expect(recovered.data.user?.id===account.user.id).toBe(true);
    expect((await client.auth.getUser()).error).toBeNull();
    expect((await client.auth.signOut()).error).toBeNull();expect(values.size).toBe(0);
  });
  it('native hydration exposes cached claims before real revoked-session validation clears local state',async()=>{
    const account=await confirmedTrailUser(env,'hydration');
    const tokens=account.client.tokens()!;
    await account.client.logout();
    expect((await nativeRefresh(tokens.refresh_token!)).status).toBe(401);
    const ready=Promise.withResolvers<number>(),release=Promise.withResolvers<void>(),cleared=Promise.withResolvers<void>();
    const hydrated=initClient(env.trailUrl,{
      tokens,
      onAuthChange:(_client,user)=>{if(!user)cleared.resolve();},
      transport:{fetch:async(path,init)=>{
        const response=await nativeFetch(path,init);
        if(path==='/api/auth/v1/status'){ready.resolve(response.status);await release.promise;}
        return response;
      }}
    });
    try {
      expect(hydrated.user()?.id===account.user.id).toBe(true);
      expect(hydrated.tokens()!==undefined).toBe(true);
      expect(await deadline(ready.promise)).toBe(401);
      release.resolve(); await deadline(cleared.promise);
      expect(hydrated.user()).toBeUndefined();expect(hydrated.tokens()).toBeUndefined();
      await expect(hydrated.records('todos').list()).rejects.toMatchObject({status:403});
    } finally {release.resolve();}
  });
  it('native concurrent forced refreshes send two real requests rather than single-flight',async()=>{
    const account=await confirmedTrailUser(env,'parallel-refresh');
    const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
    let calls=0;
    const client=initClient(env.trailUrl,{transport:{fetch:async(path,init)=>{
      if(path==='/api/auth/v1/refresh'){if(++calls===2)ready.resolve();await release.promise;}
      return nativeFetch(path,init);
    }}});
    await client.login(account.email,account.password);
    const original=client.tokens()!.refresh_token;
    const first=client.refreshAuthToken({force:true}),second=client.refreshAuthToken({force:true});
    try {
      await deadline(ready.promise);expect(calls).toBe(2);
      release.resolve();expect(await deadline(Promise.all([first,second]))).toEqual([true,true]);
      expect(client.tokens()?.refresh_token===original).toBe(true);
      expect(client.user()?.id===account.user.id).toBe(true);
      expect((await client.records('todos').list()).records).toEqual([]);
    } finally {release.resolve();await Promise.allSettled([first,second]);}
  });
  for(const operation of ['refresh','status'] as const) {
    it(`native late ${operation} response must not restore a locally logged-out client`,async()=>{
      const account=await confirmedTrailUser(env,`logout-${operation}`);
      const ready=Promise.withResolvers<number>(),release=Promise.withResolvers<void>();
      const client=initClient(env.trailUrl,{transport:{fetch:async(path,init)=>{
        const response=await nativeFetch(path,init);
        if(path===`/api/auth/v1/${operation}`){
          await response.clone().arrayBuffer(); // Hold a complete REAL successful response, not a fake session.
          ready.resolve(response.status);await release.promise;
        }
        return response;
      }}});
      await client.login(account.email,account.password);
      const before=client.tokens()!;
      const pending=operation==='refresh'?client.refreshAuthToken({force:true}):client.checkCookies();
      try {
        expect(await deadline(ready.promise)).toBe(200);
        expect(await client.logout()).toBe(true);
        expect(client.tokens()).toBeUndefined();expect(client.user()).toBeUndefined();
        expect((await nativeRefresh(before.refresh_token!)).status).toBe(401);
        release.resolve();await deadline<unknown>(pending);
        // Strict local postcondition: revocation does not justify resurrection from an old response.
        expect(client.tokens()).toBeUndefined();expect(client.user()).toBeUndefined();
        await expect(client.records('todos').list()).rejects.toMatchObject({status:403});
      } finally {release.resolve();await Promise.allSettled([pending]);}
    });
  }
  it('reference concurrent refresh is single-flight and preserves a usable actual rotated session',async()=>{
    const account=await confirmedSupabaseUser(env,'parallel-refresh');
    const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
    let calls=0;
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:async(input,init)=>{
        const response=await fetch(input,init);
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='refresh_token'){
          calls++;await response.clone().arrayBuffer();ready.resolve();await release.promise;
        }
        return response;
      }}
    });
    expect((await client.auth.signInWithPassword({email:account.email,password:account.password})).error).toBeNull();
    const first=client.auth.refreshSession();
    let second: ReturnType<typeof client.auth.refreshSession>|undefined;
    try {
      await deadline(ready.promise);second=client.auth.refreshSession();
      // Drain ready JS tasks so the second caller joins the held refresh; no readiness sleep/network stub.
      await new Promise<void>(yes=>setImmediate(yes));
      release.resolve();const results=await deadline(Promise.all([first,second]));
      expect(calls).toBe(1);
      for(const result of results){expect(result.error).toBeNull();expect(result.data.user?.id===account.user.id).toBe(true);}
      expect(results[0].data.session?.refresh_token===results[1].data.session?.refresh_token).toBe(true);
      const read=await client.from('todos').select('*');expect(read.error).toBeNull();expect(read.data).toEqual([]);
    } finally {release.resolve();await Promise.allSettled(second?[first,second]:[first]);}
  });
  it('reference late refresh is discarded after logout and emits no post-logout TOKEN_REFRESHED',async()=>{
    const account=await confirmedSupabaseUser(env,'logout-race');
    const ready=Promise.withResolvers<number>(),release=Promise.withResolvers<void>();
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:async(input,init)=>{
        const response=await fetch(input,init);
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='refresh_token'){
          await response.clone().arrayBuffer();ready.resolve(response.status);await release.promise;
        }
        return response;
      }}
    });
    expect((await client.auth.signInWithPassword({email:account.email,password:account.password})).error).toBeNull();
    const events:string[]=[];
    const subscription=client.auth.onAuthStateChange(event=>{events.push(event);}).data.subscription;
    const pending=client.auth.refreshSession();
    try {
      expect(await deadline(ready.promise)).toBe(200);
      expect((await client.auth.signOut()).error).toBeNull();
      expect((await client.auth.getSession()).data.session).toBeNull();
      const signedOut=events.lastIndexOf('SIGNED_OUT');expect(signedOut).toBeGreaterThanOrEqual(0);
      release.resolve();const result=await deadline(pending);
      expect(result.data.session).toBeNull();expect(result.error?.name).toBe('AuthRefreshDiscardedError');
      expect((await client.auth.getSession()).data.session).toBeNull();
      expect(events.slice(signedOut+1)).not.toContain('TOKEN_REFRESHED');
      const read=await client.from('todos').select('*');expect(read.error).not.toBeNull();expect(read.data).toBeNull();
    } finally {release.resolve();await Promise.allSettled([pending]);subscription.unsubscribe();}
  });
  it('native logout transport failure clears local state but reports true while remote refresh remains live',async()=>{
    const account=await confirmedTrailUser(env,'logout-outage');
    let outage=false;
    const client=initClient(env.trailUrl,{transport:{fetch:(path,init)=>{
      if(outage&&path==='/api/auth/v1/logout')throw new TypeError('Injected owned logout transport failure');
      return nativeFetch(path,init);
    }}});
    await client.login(account.email,account.password);
    const refresh=client.tokens()!.refresh_token!;
    outage=true;
    expect(await client.logout()).toBe(true);
    expect(client.tokens()).toBeUndefined();expect(client.user()).toBeUndefined();
    await expect(client.records('todos').list()).rejects.toMatchObject({status:403});
    expect((await nativeRefresh(refresh)).status).toBe(200);
  });
  it('reference logout transport failure is observable, clears local state and leaves remote refresh usable',async()=>{
    const account=await confirmedSupabaseUser(env,'logout-outage');
    let outage=false;
    const client=createClient(env.supabaseUrl,env.anonKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        if(outage&&url.pathname==='/auth/v1/logout')throw new TypeError('Injected owned logout transport failure');
        return fetch(input,init);
      }}
    });
    const login=await client.auth.signInWithPassword({email:account.email,password:account.password});
    expect(login.error).toBeNull();const refresh=login.data.session!.refresh_token;
    outage=true;
    expect((await deadline(client.auth.signOut())).error).not.toBeNull();
    expect((await client.auth.getSession()).data.session).toBeNull();
    const read=await client.from('todos').select('*');expect(read.error).not.toBeNull();expect(read.data).toBeNull();
    const recovery=await account.client.auth.refreshSession({refresh_token:refresh});
    expect(recovery.error).toBeNull();expect(recovery.data.user?.id===account.user.id).toBe(true);
  });
});
