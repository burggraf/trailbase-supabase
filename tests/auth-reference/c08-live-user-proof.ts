// Owned characterization template, deliberately not default .test.ts collection.
// Copy unchanged into an owned fixture test file; it uses genuine default3600s sessions.
// Reference live getUser is independent; the private SDK queues native credential-rotating validation instead.
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {assertLocalUrl} from '../../scripts/harness.mjs';
import {supabase,verificationLink,type Context} from '../phase-a/helpers.js';
import {identity,referenceContext,sessionState,account} from './helpers.js';
import {withCleanup} from '../sdk-browser/cleanup.js';
const raw=(env:Context,path:string,token:string,init:RequestInit={})=>fetch(new URL(path,env.supabaseUrl),{...init,redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:env.anonKey,'X-Supabase-Api-Version':'2024-01-01',authorization:'Bearer '+token,...init.headers}});
async function confirmed(env:Context,label:string){const value=identity(label);expect((await supabase(env).auth.signUp(value)).error).toBeNull();let target=await verificationLink(env,value.email);for(let n=0;n<5;n++){assertLocalUrl(target,env.origins);const r=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(10000)});expect([302,303]).toContain(r.status);const next=new URL(r.headers.get('location')!,target);assertLocalUrl(next.href,env.origins);const access=new URLSearchParams(next.hash.slice(1)).get('access_token');if(access){expect((await raw(env,'/auth/v1/logout?scope=local',access,{method:'POST'})).status).toBe(204);expect(await sessionState(env,value.email)).toMatchObject({sessions:0,activeRefreshTokens:0});return value;}target=next.href;}throw Error('Owned confirmation missing');}
for(const stage of ['before-delete','after-delete'] as const)it('L1-17/L1-19/C08-04 reference independent live-user '+stage+' observes actual user/status/state without assuming serialization',async()=>{
 const env=await referenceContext(),owner=await confirmed(env,'live-owner'),sibling=await confirmed(env,'live-control'),values=new Map<string,string>(),key='reference-live-'+randomUUID(),events:string[]=[];let enter!:()=>void,open!:()=>void,globalCalls=0,userCalls=0,userStatus=0,globalStatus=0;
 const arrival=new Promise<void>(yes=>{enter=yes;}),gate=new Promise<void>(yes=>{open=yes;});
 const client=createClient(env.supabaseUrl,env.anonKey,{auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storageKey:key,storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}}},global:{fetch:async(input,init)=>{const path=new URL(input instanceof Request?input.url:String(input)).pathname;if(path==='/auth/v1/user'){userCalls++;const actual=await fetch(input,init);userStatus=actual.status;return actual;}if(path!=='/auth/v1/logout')return fetch(input,init);if(stage==='before-delete'){enter();await gate;}globalCalls++;const actual=await fetch(input,init);globalStatus=actual.status;if(stage==='after-delete'){await actual.clone().arrayBuffer();enter();await gate;}return actual;}}});
 const b=supabase(env),c=supabase(env),rowId=randomUUID(),sub=client.auth.onAuthStateChange(event=>events.push(event)).data.subscription;let aAccess:string|undefined,bAccess:string|undefined,cAccess:string|undefined,pending:ReturnType<typeof client.auth.signOut>|undefined;
 await withCleanup(async()=>{
  const a=await client.auth.signInWithPassword(owner),second=await b.auth.signInWithPassword(owner),control=await c.auth.signInWithPassword(sibling);for(const value of[a,second,control])expect(value.error).toBeNull();aAccess=a.data.session!.access_token;bAccess=second.data.session!.access_token;cAccess=control.data.session!.access_token;
  expect((await c.from('todos').insert({id:rowId,user_id:control.data.user!.id,title:'live-'+rowId})).error).toBeNull();const rows=await c.from('todos').select('*').eq('id',rowId);expect(rows.error).toBeNull();expect(rows.data).toHaveLength(1);events.length=0;const original=values.get(key);pending=client.auth.signOut();
  let observed:Record<string,unknown>;
  try{
   await arrival;expect(values.get(key)).toBe(original);expect(events).toEqual([]);const accountBefore=[await account(env,owner.email),await account(env,sibling.email)],sessionsBefore=[await sessionState(env,owner.email),await sessionState(env,sibling.email)];
   const live=await client.auth.getUser();expect(userCalls).toBe(1);expect(userStatus).toBe(stage==='before-delete'?200:403);expect(live.error?.name??null).toBe(stage==='before-delete'?null:'AuthSessionMissingError');expect(values.get(key)).toBe(stage==='before-delete'?original:undefined);expect(events).toEqual(stage==='before-delete'?[]:['SIGNED_OUT']);
   if(live.error===null){expect(userStatus).toBe(200);expect(live.data.user?.id).toBe(a.data.user!.id);}else{expect(userStatus).toBeGreaterThanOrEqual(400);expect(live.data.user).toBeNull();}
   expect([await account(env,owner.email),await account(env,sibling.email)]).toEqual(accountBefore);expect([await sessionState(env,owner.email),await sessionState(env,sibling.email)]).toEqual(sessionsBefore);expect(await c.from('todos').select('*').eq('id',rowId)).toEqual(rows);
   observed={stage,userCalls,userStatus,userIsOwner:live.data.user?.id===a.data.user!.id,errorName:live.error?.name??null,errorCode:live.error&&'code'in live.error?live.error.code:null,storedPresent:values.has(key),ownedUnchanged:values.get(key)===original,eventsBeforeReceipt:[...events],globalCallsBeforeReceipt:globalCalls};
  }finally{open();}
  expect((await pending).error).toBeNull();expect(globalCalls).toBe(1);expect(globalStatus).toBe(204);expect(events).toEqual(stage==='before-delete'?['SIGNED_OUT']:['SIGNED_OUT','SIGNED_OUT']);expect(values.has(key)).toBe(false);expect(await sessionState(env,owner.email)).toMatchObject({sessions:0,activeRefreshTokens:0});expect(await sessionState(env,sibling.email)).toMatchObject({sessions:1,activeRefreshTokens:1});expect(await c.from('todos').select('*').eq('id',rowId)).toEqual(rows);
  await writeFile(resolve(env.directory,'reference-live-user-'+stage+'-observations-private.json'),JSON.stringify({...observed!,eventsAfterReceipt:[...events],cleanupPending:true,scope:'Strict pinned Node22 reference getUser characterization:200 before DELETE,403/missing-session and two SIGNED_OUT notifications after DELETE. Not candidate queue parity or signoff.'},null,2)+'\n',{mode:0o600});
 },[
  async()=>{open();if(pending)await pending;sub.unsubscribe();},
  async()=>{expect((await c.from('todos').delete().eq('id',rowId)).error).toBeNull();expect((await c.from('todos').select('*').eq('id',rowId)).data).toEqual([]);},
  ...[[owner.email,()=>bAccess??aAccess],[sibling.email,()=>cAccess]].map(([email,getAccess])=>async()=>{if((await sessionState(env,email as string)).sessions>0){const token=(getAccess as()=>string|undefined)();expect(token).toBeDefined();expect((await raw(env,'/auth/v1/logout?scope=global',token!,{method:'POST'})).status).toBe(204);}}),
  async()=>{for(const email of[owner.email,sibling.email])expect(await sessionState(env,email)).toMatchObject({sessions:0,activeRefreshTokens:0});},
 ]);
},60000);
