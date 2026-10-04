import { test,expect,type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { context,confirmedSupabaseUser } from '../phase-a/helpers.js';

declare global {
  interface Window {
    supabase:typeof import('@supabase/supabase-js');
    phaseAClient:SupabaseClient;
    phaseAEvents:string[];
    phaseARefreshToken?:string;
  }
}

// Genuine installed reference SDK in disposable browsers, NOT adapter storage/timer parity.
// Credentials/session data stay inside private browser/fixture state; results are booleans.
test('L1-27/G7 reference browser persistence: reload hydration, cross-tab logout and real refresh revocation',async({page})=>{
  const env=await context(),account=await confirmedSupabaseUser(env,'browser-storage');
  const key=`owned-storage-${env.id}-${randomUUID()}`,id=randomUUID();
  await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  const start=async(target:Page)=>{
    await target.goto(env.trailUrl);await target.addScriptTag({url:`${env.trailUrl}/fixtures/supabase.js`});
    await target.evaluate(({base,anon,key})=>{
      window.phaseAEvents=[];
      window.phaseAClient=window.supabase.createClient(base,anon,{auth:{storageKey:key,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
      window.phaseAClient.auth.onAuthStateChange(event=>{window.phaseAEvents.push(event);});
    },{base:env.supabaseUrl,anon:env.anonKey,key});
  };
  await start(page);
  const loggedIn=await page.evaluate(async({email,password,owner,id,key})=>{
    const client=window.phaseAClient,login=await client.auth.signInWithPassword({email,password});
    if(login.error||!login.data.session||login.data.user.id!==owner)return false;
    const inserted=await client.from('todos').insert({id,user_id:owner,title:`owned-browser-storage-${id}`});
    const persisted=JSON.parse(localStorage.getItem(key)??'null');
    return !inserted.error&&persisted?.user?.id===owner&&Boolean(persisted.access_token&&persisted.refresh_token);
  },{email:account.email,password:account.password,owner:account.user.id,id,key});
  expect(loggedIn).toBe(true);
  await start(page); // Actual new document; no injected session or fake storage value.
  const hydrated=await page.evaluate(async({owner,id})=>{
    const client=window.phaseAClient,session=await client.auth.getSession(),user=await client.auth.getUser();
    const read=await client.from('todos').select('id,user_id');
    return !session.error&&session.data.session?.user.id===owner&&!user.error&&user.data.user?.id===owner&&
      !read.error&&read.data?.length===1&&read.data[0].id===id&&read.data[0].user_id===owner;
  },{owner:account.user.id,id});
  expect(hydrated).toBe(true);
  const second=await page.context().newPage();
  try {
    await start(second);
    const shared=await second.evaluate(async(owner)=>{
      const session=await window.phaseAClient.auth.getSession();window.phaseARefreshToken=session.data.session?.refresh_token;
      return !session.error&&session.data.session?.user.id===owner&&Boolean(window.phaseARefreshToken);
    },account.user.id);
    expect(shared).toBe(true);
    expect(await page.evaluate(async()=>!(await window.phaseAClient.auth.signOut()).error)).toBe(true);
    await second.waitForFunction(()=>window.phaseAEvents.includes('SIGNED_OUT'),{},{timeout:10000});
    const cleared=await second.evaluate(async(key)=>{
      const session=await window.phaseAClient.auth.getSession();
      const anonymous=await window.phaseAClient.from('todos').select('id');
      return !session.error&&session.data.session===null&&localStorage.getItem(key)===null&&anonymous.error?.code==='42501'&&anonymous.data===null;
    },key);
    expect(cleared).toBe(true);
    const revoked=await second.evaluate(async()=>{
      if(!window.phaseARefreshToken)return false;
      const refresh=await window.phaseAClient.auth.refreshSession({refresh_token:window.phaseARefreshToken});
      window.phaseARefreshToken=undefined;
      const session=await window.phaseAClient.auth.getSession();
      return Boolean(refresh.error)&&refresh.data.session===null&&!session.error&&session.data.session===null;
    });
    expect(revoked).toBe(true);
  } finally {await second.close();}
});

for(const ordering of ['unawaited','awaited'] as const){
  test(`L1-27/G7/S08 reference ${ordering} async hydration must not notify recovered A after newer B login`,async({page,browserName})=>{
    test.setTimeout(60000);
    const env=await context(),a=await confirmedSupabaseUser(env,'browser-hydrate-a'),b=await confirmedSupabaseUser(env,'browser-hydrate-b');
    const aid=randomUUID(),bid=randomUUID(),key=`owned-hydration-${env.id}-${randomUUID()}`;
    for(const [account,id] of [[a,aid],[b,bid]] as const)expect((await account.client.from('todos').insert({id,user_id:account.user.id,title:`hydrate-${id}`,note:'unchanged'})).error).toBeNull();
    const beforeA=await a.client.from('todos').select('*').eq('id',aid).single(),beforeB=await b.client.from('todos').select('*').eq('id',bid).single();
    expect(beforeA.error).toBeNull();expect(beforeB.error).toBeNull();
    await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
    try{
      await page.goto(env.trailUrl);await page.addScriptTag({url:`${env.trailUrl}/fixtures/supabase.js`});
      const result=await page.evaluate(async({base,anon,key,ordering,a,b,beforeB})=>{
        const bounded=async<T>(promise:Promise<T>)=>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('Reference browser hydration deadline')),10000);})]);}finally{clearTimeout(timer!);}};
        const seed=window.supabase.createClient(base,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:`${key}-seed`}});
        const first=await bounded(seed.auth.signInWithPassword({email:a.email,password:a.password}));
        if(first.error||!first.data.session||first.data.user.id!==a.owner)throw new Error('Reference browser hydration genuine seed failed');
        const values=new Map([[key,JSON.stringify(first.data.session)],['owned-unrelated','keep']]);
        const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),initial=Promise.withResolvers<void>();
        let held=false,passwordRequests=0;
        const client=window.supabase.createClient(base,anon,{
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
          events.push({event,owner:!session?'none':session.user.id===a.owner?'A':session.user.id===b.owner?'B':'other'});
          if(event==='INITIAL_SESSION')initial.resolve();
        }).data.subscription;
        let pending:ReturnType<typeof client.auth.signInWithPassword>|undefined;
        try{
          await bounded(ready.promise);
          pending=(async()=>{if(ordering==='awaited')await client.auth.initialize();return client.auth.signInWithPassword({email:b.email,password:b.password});})();
          const passwordRequestsBeforeRelease=passwordRequests;
          if(ordering==='awaited')release.resolve();
          const login=await bounded(pending);
          if(login.error||login.data.user?.id!==b.owner)throw new Error('Reference browser hydration genuine B login failed');
          release.resolve();if((await bounded(client.auth.initialize())).error)throw new Error('Reference browser initialization failed');await bounded(initial.promise);
          const cached=await bounded(client.auth.getSession()),validated=await bounded(client.auth.getUser()),rows=await bounded(Promise.resolve(client.from('todos').select('*')));
          const signedIn=events.filter(event=>event.event==='SIGNED_IN').map(event=>event.owner),newer=signedIn.indexOf('B'),row=rows.data?.[0];
          const observed={events:[...events],passwordRequests,passwordRequestsBeforeRelease,cachedB:!cached.error&&cached.data.session?.user.id===b.owner,validatedB:!validated.error&&validated.data.user?.id===b.owner,onlyBRow:Boolean(!rows.error&&rows.data?.length===1&&row&&beforeB&&Object.keys(row).length===Object.keys(beforeB).length&&Object.entries(beforeB).every(([field,value])=>row[field]===value)),storedB:JSON.parse(values.get(key)??'null')?.user?.id===b.owner,noStaleA:newer>=0&&!signedIn.slice(newer+1).includes('A')};
          subscription.unsubscribe();subscription.unsubscribe();const count=events.length;
          if((await bounded(client.auth.signOut({scope:'local'}))).error)throw new Error('Reference browser local cleanup failed');
          const cleared=await bounded(client.auth.getSession()),denied=await bounded(Promise.resolve(client.from('todos').select('*')));
          return {...observed,listenerSilent:events.length===count,ownedCleared:!cleared.error&&cleared.data.session===null&&!values.has(key),unrelatedPreserved:values.get('owned-unrelated')==='keep',anonymousDenied:Boolean(denied.error)&&denied.data===null};
        }finally{
          release.resolve();await Promise.allSettled(pending?[pending]:[]);subscription.unsubscribe();
          for(const owned of [client,seed])if((await bounded(owned.auth.signOut({scope:'local'}))).error)throw new Error('Reference browser final local cleanup failed');
        }
      },{base:env.supabaseUrl,anon:env.anonKey,key,ordering,a:{email:a.email,password:a.password,owner:a.user.id},b:{email:b.email,password:b.password,owner:b.user.id},beforeB:beforeB.data});
      const unchangedA=await a.client.from('todos').select('*').eq('id',aid).single(),unchangedB=await b.client.from('todos').select('*').eq('id',bid).single();
      expect(unchangedA).toEqual(beforeA);expect(unchangedB).toEqual(beforeB);
      await writeFile(`${env.directory}/reference-hydration-${ordering}-${browserName}.json`,JSON.stringify({ordering,browserName,...result,controlsUnchanged:true}),{mode:0o600});
      expect(result.passwordRequests).toBe(1);if(ordering==='awaited')expect(result.passwordRequestsBeforeRelease).toBe(0);
      for(const field of ['cachedB','validatedB','onlyBRow','storedB','listenerSilent','ownedCleared','unrelatedPreserved','anonymousDenied'] as const)expect(result[field],field).toBe(true);
      expect(result.noStaleA).toBe(true);
    }finally{
      for(const [account,id] of [[a,aid],[b,bid]] as const){expect((await account.client.from('todos').delete().eq('id',id)).error).toBeNull();expect((await account.client.auth.signOut({scope:'local'})).error).toBeNull();}
    }
  });
}
