import { it, expect } from 'vitest';
import { createClient, type AuthStorage } from '../../src/index.js';
const trailbase={tables:{todos:{api:'todos',primaryKey:'id',fields:{id:{type:'uuid' as const}}}}};
const now=Math.floor(Date.now()/1000),sub=Buffer.from('12345678123442348234123456789abc','hex').toString('base64url');
const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt=(session:string,expired=false,missing?:string)=>{const header:Record<string,unknown>={alg:'EdDSA'},claims:Record<string,unknown>={sub,email:'same-owner',iat:now-120,exp:now+(expired?-60:600),session};if(missing==='alg')delete header.alg;else if(missing)delete claims[missing];return `${encode(header)}.${encode(claims)}.signature`;};
const tokens=(session:string,expired=false,missing?:string)=>({auth_token:jwt(session,expired,missing),refresh_token:`refresh-${session}`,csrf_token:`csrf-${session}`});
const renewed=(session='C',missing?:string)=>({auth_token:jwt(session,false,missing),csrf_token:`renewed-${session}`});
const defer=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{resolve,promise};};
const memory=(data:Map<string,string>):AuthStorage=>({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);}});
const factory=(data:Map<string,string>,fetch:typeof globalThis.fetch,storage=memory(data))=>createClient('http://localhost:4000',undefined,{trailbase,auth:{persistSession:true,autoRefreshToken:false,storageKey:'owned',storage},global:{fetch}});
const stored=(expired=false)=>new Map([['owned',JSON.stringify({version:1,tokens:tokens('C',expired)})],['unrelated','keep']]);
const credentials={email:'placeholder',password:'placeholder'};

it('L1-18/S08 C refresh started after login B invocation cannot overwrite/remove same-user B or dispatch old waiting data',async()=>{
  for(const status of [200,401]){
    const data=stored(true),loginHeld=defer<Response>(),refreshHeld=defer<Response>(),loginReady=defer<void>(),refreshReady=defer<void>();let removals=0,reads=0;
    const client=factory(data,async input=>{const path=new URL(String(input)).pathname;if(path.endsWith('/login')){loginReady.resolve();return loginHeld.promise;}if(path.endsWith('/refresh')){refreshReady.resolve();return refreshHeld.promise;}reads++;return Response.json({records:[]});},{...memory(data),removeItem:k=>{removals++;data.delete(k);}});
    const login=client.auth.signInWithPassword(credentials);await loginReady.promise;const refresh=client.auth.refreshSession(),waiting=Promise.resolve(client.from('todos').select());await refreshReady.promise;
    loginHeld.resolve(Response.json(tokens('B')));expect((await login).error).toBeNull();const diskB=data.get('owned');refreshHeld.resolve(status===200?Response.json(renewed()):new Response('Rejected',{status}));
    expect((await refresh).error?.name).toBe('AuthStaleOperationError');expect((await waiting).error?.name).toBe('AuthStaleOperationError');expect(reads).toBe(0);expect(removals).toBe(0);expect(data.get('owned')).toBe(diskB);expect((await client.auth.getSession()).data.session?.refresh_token).toBe('refresh-B');
  }
});
it('L1-18/S08 queued refresh install checks captured baseline after same-generation B commits before its write',async()=>{
  const data=stored(),loginHeld=defer<Response>(),refreshHeld=defer<Response>(),loginReady=defer<void>(),refreshReady=defer<void>(),writeHeld=defer<void>(),writeReady=defer<void>();let refreshWrites=0;
  const storage={...memory(data),setItem:async(k:string,v:string)=>{if(JSON.parse(v).tokens.refresh_token==='refresh-B'){data.set(k,v);writeReady.resolve();await writeHeld.promise;}else{refreshWrites++;data.set(k,v);}}};
  const client=factory(data,async input=>{if(new URL(String(input)).pathname.endsWith('/login')){loginReady.resolve();return loginHeld.promise;}refreshReady.resolve();return refreshHeld.promise;},storage);
  const login=client.auth.signInWithPassword(credentials);await loginReady.promise;const refresh=client.auth.refreshSession();await refreshReady.promise;loginHeld.resolve(Response.json(tokens('B')));await writeReady.promise;refreshHeld.resolve(Response.json(renewed()));await new Promise<void>(yes=>setImmediate(yes));writeHeld.resolve();await login;
  expect((await refresh).error?.name).toBe('AuthStaleOperationError');expect(refreshWrites).toBe(0);expect(JSON.parse(data.get('owned')!).tokens.refresh_token).toBe('refresh-B');
});
it('L1-18/S07 terminal invalidation during same-generation held login write cannot remove good B or restore rejected C',async()=>{
  for(const succeeds of [false,true]){
    const data=stored(),loginHeld=defer<Response>(),refreshHeld=defer<Response>(),loginReady=defer<void>(),refreshReady=defer<void>(),writeHeld=defer<void>(),writeReady=defer<void>();const writes:string[]=[];
    const storage={...memory(data),setItem:async(k:string,v:string)=>{writes.push(JSON.parse(v).tokens.refresh_token);data.set(k,v);if(JSON.parse(v).tokens.refresh_token==='refresh-B'){writeReady.resolve();await writeHeld.promise;if(!succeeds)throw new Error('Write rejected');}}};
    const client=factory(data,async input=>{if(new URL(String(input)).pathname.endsWith('/login')){loginReady.resolve();return loginHeld.promise;}refreshReady.resolve();return refreshHeld.promise;},storage);
    const login=client.auth.signInWithPassword(credentials);await loginReady.promise;const refresh=client.auth.refreshSession();await refreshReady.promise;loginHeld.resolve(Response.json(tokens('B')));await writeReady.promise;refreshHeld.resolve(new Response(null,{status:401}));await new Promise<void>(yes=>setImmediate(yes));writeHeld.resolve();
    const result=await login;if(succeeds)expect(result.error).toBeNull();else expect(result.error?.name).toBe('AuthStorageWriteError');expect(writes).toEqual(['refresh-B']);expect((await refresh).error?.status).toBe(401);expect(data.has('owned')).toBe(succeeds);expect((await client.auth.getSession()).data.session?.refresh_token??null).toBe(succeeds?'refresh-B':null);expect(data.get('unrelated')).toBe('keep');
  }
});
it('L1-18/S07 delivered401 ignores rejecting/held text, aborts/cancels resources and settles joined operations without body release',async()=>{
  for(const heldText of [false,true]){
    const data=stored(true),responseHeld=defer<Response>(),ready=defer<void>();let texts=0,cancels=0,signal:AbortSignal|null|undefined;
    const response=new Response(new ReadableStream({cancel(){cancels++;throw new Error('private-cancel-error');}}),{status:401});response.text=()=>{texts++;return heldText?new Promise<string>(()=>{}):Promise.reject(new Error('private-body-error'));};
    const client=factory(data,async(_input,init)=>{signal=init?.signal;ready.resolve();return responseHeld.promise;});const refresh=client.auth.refreshSession(),waiting=Promise.resolve(client.from('todos').select()),cached=client.auth.getSession();await ready.promise;responseHeld.resolve(response);
    for(const result of [await refresh,await waiting,await cached]){expect(result.error?.status).toBe(401);expect(result.error?.message).not.toContain('private');}expect(texts).toBe(0);expect(cancels).toBe(1);expect(signal?.aborted).toBe(true);expect(data.has('owned')).toBe(false);
  }
});
it('L1-18/S07 redirected or opaque-redirect401 is not native terminal rejection and preserves C',async()=>{
  for(const [property,value] of [['redirected',true],['type','opaqueredirect']] as const){
    const data=stored(),before=data.get('owned'),held=defer<Response>(),ready=defer<void>();let removals=0,reads=0,texts=0,cancels=0,signal:AbortSignal|null|undefined;
    const response=new Response(new ReadableStream({cancel(){cancels++;throw new Error('Synthetic cancellation failure');}}),{status:401});
    Object.defineProperty(response,property,{value});response.text=async()=>{texts++;throw new Error('Body must not be read');};
    const client=factory(data,async(input,init)=>{if(new URL(String(input)).pathname.endsWith('/refresh')){signal=init?.signal;ready.resolve();return held.promise;}reads++;return Response.json({records:[]});},{...memory(data),removeItem:k=>{removals++;data.delete(k);}});
    const refresh=client.auth.refreshSession(),waiting=Promise.resolve(client.from('todos').select()),cached=client.auth.getSession();await ready.promise;held.resolve(response);
    for(const result of [await refresh,await waiting,await cached])expect(result.error?.name).toBe('AuthRedirectError');
    expect(removals).toBe(0);expect(reads).toBe(0);expect(texts).toBe(0);expect(cancels).toBe(1);expect(signal?.aborted).toBe(true);expect(data.get('owned')).toBe(before);expect(data.get('unrelated')).toBe('keep');expect((await client.auth.getSession()).data.session?.refresh_token).toBe('refresh-C');
  }
});
it('L1-18/U18 own JWT alg/sub/iat/exp required in login/hydration/refresh despite prototype values, no waiting dispatch',async()=>{
  for(const field of ['alg','sub','iat','exp']){
    const original=Object.getOwnPropertyDescriptor(Object.prototype,field),value={alg:'EdDSA',sub,iat:now-120,exp:now+600}[field as 'alg'|'sub'|'iat'|'exp'];
    try{Object.defineProperty(Object.prototype,field,{configurable:true,value});const data=stored(),before=data.get('owned');let reads=0;const client=factory(data,async input=>{if(new URL(String(input)).pathname.endsWith('/login'))return Response.json(tokens('bad',false,field));if(new URL(String(input)).pathname.endsWith('/refresh'))return Response.json(renewed('C',field));reads++;return Response.json({records:[]});});
      expect((await client.auth.signInWithPassword(credentials)).error).not.toBeNull();expect(data.get('owned')).toBe(before);expect((await client.auth.getSession()).data.session?.refresh_token).toBe('refresh-C');
      const refresh=client.auth.refreshSession(),waiting=Promise.resolve(client.from('todos').select());expect((await refresh).error).not.toBeNull();expect((await waiting).error).not.toBeNull();expect(reads).toBe(0);expect(data.get('owned')).toBe(before);
      const corrupt=stored();corrupt.set('owned',JSON.stringify({version:1,tokens:tokens('bad',false,field)}));expect((await factory(corrupt,async()=>{throw new Error('No wire');}).auth.getSession()).error?.name).toBe('AuthInvalidStoredSessionError');
    }finally{if(original)Object.defineProperty(Object.prototype,field,original);else Reflect.deleteProperty(Object.prototype,field);}
  }
});
it('L1-18/U18 exact-body201/202 refresh are observable failures, unchanged C and no waiting data',async()=>{
  for(const status of [201,202]){const data=stored(),before=data.get('owned');let reads=0;const client=factory(data,async input=>{if(new URL(String(input)).pathname.endsWith('/refresh'))return Response.json(renewed(),{status});reads++;return Response.json({records:[]});});const refresh=client.auth.refreshSession(),waiting=Promise.resolve(client.from('todos').select());expect((await refresh).error?.status).toBe(status);expect((await waiting).error?.status).toBe(status);expect(reads).toBe(0);expect(data.get('owned')).toBe(before);expect((await client.auth.getSession()).data.session?.refresh_token).toBe('refresh-C');}
});
it('L1-18/U18 expired data/getSession initiate one renewal without manual refresh and persist before one original dispatch',async()=>{
  const data=stored(true),held=defer<Response>(),ready=defer<void>();let renewals=0,reads=0;const client=factory(data,async(input,init)=>{if(new URL(String(input)).pathname.endsWith('/refresh')){renewals++;ready.resolve();return held.promise;}reads++;expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${renewed().auth_token}`);return Response.json({records:[]});});
  const waiting=Promise.resolve(client.from('todos').select()),cached=client.auth.getSession();await ready.promise;held.resolve(Response.json(renewed()));expect((await waiting).error).toBeNull();expect((await cached).error).toBeNull();expect(renewals).toBe(1);expect(reads).toBe(1);expect(JSON.parse(data.get('owned')!).tokens.csrf_token).toBe('renewed-C');
});
