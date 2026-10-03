import { beforeAll,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { context,confirmedTrailUser,nativeUuid,deadline,type Context } from '../phase-a/helpers.js';
import { nativeSseProof } from '../proofs/native-sse.js';

let env:Context;
beforeAll(async()=>{
  env=await context();
  if(env.nativeAuthProfile!=='short-native-auth')throw new Error('Expiry tests require the explicit owned short-native-auth profile');
});
async function waitActualDenial(protectedRead:()=>Promise<Response>) {
  const expiresDeadline=Date.now()+80000;
  while(Date.now()<expiresDeadline) {
    const response=await protectedRead(),denied=response.status===401||response.status===403;
    await response.body?.cancel();if(denied)return;
    expect(response.status).toBe(200);await new Promise<void>(yes=>setTimeout(yes,500));
  }
  throw new Error('Actual native access expiry deadline exceeded');
}
describe('L1-27 G6/S07 actual native token expiry, NOT default fixture or reference/browser parity',()=>{
  it('an established stream must stop delivering protected rows after its genuine access token expires',async()=>{
    const account=await confirmedTrailUser(env,'actual-expiry');
    const response=await account.client.fetch('/api/records/v1/todos/subscribe/*');
    expect(response.ok).toBe(true);if(!response.body)throw new Error('Actual native stream missing');
    const original=account.client.tokens()!;
    const claims=JSON.parse(Buffer.from(original.auth_token.split('.')[1],'base64url').toString('utf8'));
    expect(claims.exp-claims.iat).toBe(3);
    const protectedRead=()=>fetch(`${env.trailUrl}/api/records/v1/todos`,{
      headers:{Authorization:`Bearer ${original.auth_token}`},signal:AbortSignal.timeout(5000)
    });
    const initial=await protectedRead();expect(initial.status).toBe(200);await initial.body?.cancel();
    const abort=new AbortController(),parser=nativeSseProof(response.body,{signal:abort.signal});
    try {
      // Genuine wall-clock expiry. No JWT editing, fake clock or revoked-token substitute.
      // The pinned server may allow clock-skew grace: observe actual denial, bounded at 80s.
      await waitActualDenial(protectedRead);
      expect(Date.now()/1000).toBeGreaterThan(claims.exp);
      const pending=parser.next();
      const id=nativeUuid(randomUUID());
      // The writer is freshly refreshed by the installed SDK; only the subscription keeps the old JWT.
      await account.client.records('todos').create({id,user_id:account.user.id,title:`after-expiry-${randomUUID()}`});
      const writerRead=await account.client.records('todos').list();expect(writerRead.records.map(row=>row.id)).toEqual([id]);
      const result=await deadline(pending,10000,'Observable expired-stream close/error');
      if(!result.done) {
        expect('Error' in result.value).toBe(true);
        if(!('Error' in result.value))throw new Error('Expired native subscriber received protected row data');
        expect(result.value.Error.status).toBe(1);
      }
    } finally {abort.abort();await parser.return(undefined).catch(()=>{});}
  },100000);
  it('standard client deadline abort stops local delivery at genuine JWT exp, NOT server authorization enforcement',async()=>{
    const account=await confirmedTrailUser(env,'client-expiry-deadline'),original=account.client.tokens()!;
    const claims=JSON.parse(Buffer.from(original.auth_token.split('.')[1],'base64url').toString('utf8'));
    expect(Number.isSafeInteger(claims.exp)).toBe(true);expect(claims.exp-claims.iat).toBe(3);
    expect(claims.exp*1000-Date.now()).toBeGreaterThan(0);
    const headers={Authorization:`Bearer ${original.auth_token}`};
    const protectedRead=()=>fetch(`${env.trailUrl}/api/records/v1/todos`,{headers,signal:AbortSignal.timeout(5000)});
    const initial=await protectedRead();expect(initial.status).toBe(200);await initial.body?.cancel();
    const response=await fetch(`${env.trailUrl}/api/records/v1/todos/subscribe/*`,{headers});
    expect(response.ok).toBe(true);if(!response.body)throw new Error('Real deadline stream missing');
    // Same-host genuine clock/profile only. This is an ordinary platform abort,
    // not a negotiated clock-skew, renewal scheduler or server authz fix.
    const signal=AbortSignal.timeout(Math.max(0,claims.exp*1000-Date.now()));
    const parser=nativeSseProof(response.body,{signal});
    try {
      await expect(deadline(parser.next(),10000,'Client JWT deadline abort')).rejects.toMatchObject({name:'AbortError'});
      expect(signal.aborted).toBe(true);expect(response.body.locked).toBe(false);
      expect(Date.now()).toBeGreaterThanOrEqual(claims.exp*1000);
      await waitActualDenial(protectedRead); // Do not substitute nominal exp for genuine server denial.
      const id=nativeUuid(randomUUID());
      await account.client.records('todos').create({id,user_id:account.user.id,title:`client-after-expiry-${randomUUID()}`});
      expect((await account.client.records('todos').list()).records.map(row=>row.id)).toEqual([id]);
      expect((await parser.next()).done).toBe(true); // No post-expiry protected event can leave this closed reader.
    } finally {await parser.return(undefined).catch(()=>{});}
  },100000);
});
