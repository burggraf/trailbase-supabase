import { it, expect } from 'vitest';
import { createClient } from '../../src/index.js';
it('L1-18/P18 32 distinct same-owner refresh vectors retain only original genuine credential', async () => {
  const now=Math.floor(Date.now()/1000),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  for(let index=0;index<32;index++){
    const id=`12345678-1234-4234-8234-${index.toString(16).padStart(12,'0')}`,sub=Buffer.from(id.replaceAll('-',''),'hex').toString('base64url');
    const jwt=`${encode({alg:'EdDSA'})}.${encode({sub,email:null,iat:now-60,exp:now+600})}.signature`,old={auth_token:jwt,refresh_token:`original-${index}`,csrf_token:'old'},fresh={auth_token:jwt,csrf_token:`new-${index}`};
    const data=new Map([['owned',JSON.stringify({version:1,tokens:old})]]);
    const client=createClient('http://localhost:4000',undefined,{trailbase:{tables:{todos:{api:'todos',primaryKey:'id',fields:{id:{type:'uuid'}}}}},auth:{persistSession:true,autoRefreshToken:false,storageKey:'owned',storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);}}},global:{fetch:async()=>Response.json(fresh)}});
    const result=await client.auth.refreshSession();expect(result.error).toBeNull();expect(result.data.user?.id).toBe(id);expect(result.data.session?.refresh_token).toBe(old.refresh_token);expect(JSON.parse(data.get('owned')!).tokens).toEqual({...fresh,refresh_token:old.refresh_token});
  }
});
