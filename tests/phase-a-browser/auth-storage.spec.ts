import { test,expect,type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
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
