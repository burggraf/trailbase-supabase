import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {context,confirmedTrailUser,confirmedSupabaseUser,nativeUuid} from '../phase-a/helpers.js';

for(const backend of ['trailbase','supabase'] as const)test(`G2/G3/S02 ${backend} browser installed-client Date/bytes wire and atomic rejection`,async({page})=>{
  const env=await context(),native=backend==='trailbase';
  const a=native?await confirmedTrailUser(env,'browser-shapes-a'):await confirmedSupabaseUser(env,'browser-shapes-a');
  const b=native?await confirmedTrailUser(env,'browser-shapes-b'):await confirmedSupabaseUser(env,'browser-shapes-b');
  const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  await page.context().route('**/*',route=>env.origins.includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  try{
    await page.goto(env.trailUrl);
    if(!native)await page.addScriptTag({url:`${env.trailUrl}/fixtures/supabase.js`});
    expect(await page.evaluate(async({native,base,anon,accounts,ids,canonical})=>{
      const check=(ok:unknown,label:string)=>{if(!ok)throw new Error(`Browser raw-shape postcondition: ${label}`);};
      const wire:{method:string;body:Record<string,unknown>}[]=[];
      const transport:typeof fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        if((url.pathname==='/api/records/v1/todos'||url.pathname.startsWith('/api/records/v1/todos/')||url.pathname==='/rest/v1/todos')&&['POST','PATCH'].includes(init?.method??''))wire.push({method:init!.method!,body:JSON.parse(String(init!.body))});
        return fetch(input,{...init,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
      };
      const module:typeof import('trailbase')|undefined=native?await import(`${base}/fixtures/trailbase.js`):undefined;
      const nativeTransport={fetch:(path:string,init?:RequestInit)=>transport(new URL(path,base),init)};
      const aNative=module?.initClient(base,{transport:nativeTransport}),bNative=module?.initClient(base,{transport:nativeTransport});
      const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}};
      const aReference=native?undefined:window.supabase.createClient(base,anon,options),bReference=native?undefined:window.supabase.createClient(base,anon,options);
      let refresh:string|undefined;
      try{
        if(native){await aNative!.login(accounts[0].email,accounts[0].password);await bNative!.login(accounts[1].email,accounts[1].password);check(aNative!.user()?.id===accounts[0].owner&&bNative!.user()?.id===accounts[1].owner,'genuine A/B login');refresh=bNative!.tokens()!.refresh_token??undefined;check(refresh,'genuine B refresh');}
        else{for(const [i,client] of [aReference!,bReference!].entries()){const result=await client.auth.signInWithPassword(accounts[i]);check(!result.error&&result.data.user?.id===accounts[i].owner,'genuine A/B login');}}
        if(native){await aNative!.records('todos').create({id:ids[0],user_id:accounts[0].owner,title:'target-control'});await bNative!.records('todos').create({id:ids[1],user_id:accounts[1].owner,title:'foreign-control'});}
        else{check(!(await aReference!.from('todos').insert({id:ids[0],user_id:accounts[0].owner,title:'target-control'})).error,'A seed');check(!(await bReference!.from('todos').insert({id:ids[1],user_id:accounts[1].owner,title:'foreign-control'})).error,'B seed');}
        wire.length=0;
        const date=new Date('2024-01-02T03:04:05.000Z'),bytes=Uint8Array.from(canonical.replaceAll('-','').match(/../g)!,pair=>parseInt(pair,16));
        const invalidDate=new Date(Number.NaN);
        if(native){let status=0;try{await aNative!.records('todos').create({id:ids[3],user_id:accounts[0].owner,title:invalidDate});}catch(error){status=(error as {status:number}).status;}check(status===400,'native invalid Date-to-null NOT NULL rejection');}
        else{const invalid=await aReference!.from('todos').insert({id:ids[3],user_id:accounts[0].owner,title:invalidDate});check(invalid.status===400&&invalid.error?.code==='23502'&&invalid.data===null,'reference invalid Date-to-null NOT NULL rejection');}
        if(native){check(await aNative!.records('todos').create({id:ids[2],user_id:accounts[0].owner,title:date})===ids[2],'Date text insert');check((await aNative!.records('todos').read(ids[2])).title===date.toISOString(),'literal ISO text');}
        else{check(!(await aReference!.from('todos').insert({id:ids[2],user_id:accounts[0].owner,title:date})).error,'Date text insert');const row=await aReference!.from('todos').select('*').eq('id',ids[2]).single();check(!row.error&&row.data?.title===date.toISOString(),'literal ISO text');}
        const state=async()=>{
          const snapshots=[];
          for(const [i,table] of ['todos','todo_audit','todos','todo_audit'].entries()){
            if(native){const client=i<2?aNative!:bNative!;snapshots.push((await client.records(table).list({order:[table==='todos'?'+id':'+audit_key'],pagination:{limit:1000}})).records);}
            else{const result=await(i<2?aReference!:bReference!).from(table).select('*').order(table==='todos'?'id':'audit_key');check(!result.error&&result.data,'complete rows/audit');snapshots.push(result.data);}
          }
          check(snapshots[0]!.length===2&&snapshots[2]!.length===1,'owner-only visible rows');
          return JSON.stringify(snapshots);
        };
        const before=await state();
        const rejected=async(shape:'date'|'bytes',update:boolean)=>{
          const values:Record<string,unknown>=update?(shape==='date'?{created_at:date,note:'must-not-persist'}:{priority:bytes,note:'must-not-persist'}):(shape==='date'?{id:ids[3],user_id:accounts[0].owner,title:'rejected-date',created_at:date}:{id:bytes,user_id:accounts[0].owner,title:'rejected-bytes'});
          if(native){let status=0;try{if(update)await aNative!.records('todos').update(ids[0],values);else await aNative!.records('todos').create(values);}catch(error){status=(error as {status:number}).status;}check(status===400,'native invalid type HTTP 400');}
          else{const result=update?await aReference!.from('todos').update(values).eq('id',ids[0]):await aReference!.from('todos').insert(values);check(result.status===400&&result.error?.code==='22P02'&&result.data===null,'reference invalid type 400/22P02/null');}
          check(await state()===before,'no partial row/audit effects; B unchanged');
        };
        await rejected('date',false);await rejected('date',true);await rejected('bytes',false);await rejected('bytes',true);
        check(JSON.stringify(wire.map(call=>call.method))===JSON.stringify(['POST','POST','POST','PATCH','POST','PATCH']),'exactly six mutation requests, no replay');
        check(wire[0].body.title===null&&wire[1].body.title===date.toISOString()&&wire[2].body.created_at===date.toISOString()&&wire[3].body.created_at===date.toISOString(),'actual outgoing null and ISO values');
        check(JSON.stringify(wire[4].body.id)===JSON.stringify(bytes)&&JSON.stringify(wire[5].body.priority)===JSON.stringify(bytes),'actual outgoing byte objects');
        return true;
      }finally{
        if(native){
          for(const client of [aNative!,bNative!]){if(!client.user())continue;for(const row of (await client.records('todos').list()).records)await client.records('todos').delete(String(row.id));check((await client.records('todos').list()).records.length===0,'native owned rows removed');await client.logout();check(!client.user()&&!client.tokens(),'native local state cleared');}
          if(refresh)check((await fetch(`${base}/api/auth/v1/refresh`,{method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(10000)})).status===401,'native exact B refresh revoked');
        }else{for(const [i,client] of [aReference!,bReference!].entries()){check(!(await client.from('todos').delete().eq('user_id',accounts[i].owner)).error,'reference owned rows removed');const rows=await client.from('todos').select('*');check(!rows.error&&rows.data?.length===0,'reference empty rows');check(!(await client.auth.signOut({scope:'local'})).error&&(await client.auth.getSession()).data.session===null,'reference local session cleared');client.realtime.disconnect();}}
      }
    },{native,base:native?env.trailUrl:env.supabaseUrl,anon:env.anonKey,accounts:[a,b].map(account=>({email:account.email,password:account.password,owner:account.user.id})),ids:native?ids.map(nativeUuid):ids,canonical:ids[2]})).toBe(true);
  }finally{
    // Node setup sessions are separate from real browser logins; revoke both owned scopes.
    if(native){await (a as Awaited<ReturnType<typeof confirmedTrailUser>>).client.logout();await (b as Awaited<ReturnType<typeof confirmedTrailUser>>).client.logout();}
    else{expect((await(a as Awaited<ReturnType<typeof confirmedSupabaseUser>>).client.auth.signOut({scope:'local'})).error).toBeNull();expect((await(b as Awaited<ReturnType<typeof confirmedSupabaseUser>>).client.auth.signOut({scope:'local'})).error).toBeNull();}
  }
});
