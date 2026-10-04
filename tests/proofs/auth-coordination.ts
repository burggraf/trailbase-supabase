import type { Tokens } from 'trailbase';

export class StaleAuthProofOperation extends Error {
  constructor(readonly cleanupFailed=false,options?:ErrorOptions){super('Discarded stale proof auth operation',options);this.name='StaleAuthProofOperation';}
}
export class AuthProofHttpError extends Error {
  constructor(readonly status:number){super(`Native auth HTTP ${status}`);this.name='AuthProofHttpError';}
}

// Test-only state coordination over genuine native endpoints; no Supabase-shaped
// session/user synthesis, automatic timers/storage or production wrapper claim.
export function authCoordinationProof(forward:(path:string,init?:RequestInit)=>Promise<Response>) {
  let epoch=0,tokens:Tokens|undefined,pending:Promise<boolean>|undefined;
  const headers=(value=tokens):Record<string,string>=>({
    'content-type':'application/json',
    ...(value?{Authorization:`Bearer ${value.auth_token}`,'Refresh-Token':value.refresh_token??'','CSRF-Token':value.csrf_token??''}:{})
  });
  const check=(started:number)=>{if(epoch!==started)throw new StaleAuthProofOperation();};
  const clear=()=>{++epoch;tokens=undefined;pending=undefined;};
  async function revoke(refresh_token:Tokens['refresh_token']|undefined) {
    if(typeof refresh_token!=='string'||!refresh_token)throw new TypeError('Missing discarded-session refresh credential');
    const response=await forward('/api/auth/v1/logout',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',redirect:'error',body:JSON.stringify({refresh_token})});
    await response.body?.cancel();
    if(!response.ok)throw new AuthProofHttpError(response.status);
  }
  async function login(email:string,password:string) {
    clear();const started=epoch;
    const response=await forward('/api/auth/v1/login',{method:'POST',headers:headers(),body:JSON.stringify({email_or_username:email,password})});
    if(!response.ok){check(started);throw new AuthProofHttpError(response.status);}
    const actual:Tokens=await response.json();
    if(epoch!==started) {
      // Revoke only this newly decoded genuine session, never a newer cache or siblings.
      // Missing/undecodable responses cannot establish a remote-cleanup claim.
      try {await revoke(actual.refresh_token);}
      catch(cause){throw new StaleAuthProofOperation(true,{cause});}
      throw new StaleAuthProofOperation();
    }
    tokens=actual;
  }
  function refresh():Promise<boolean> {
    if(pending)return pending;
    const current=tokens,started=epoch;
    if(!current?.refresh_token)return Promise.resolve(false);
    const operation=(async()=>{
      const response=await forward('/api/auth/v1/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:current.refresh_token})});
      if(!response.ok){check(started);if(response.status===401)clear();throw new AuthProofHttpError(response.status);}
      const actual:Tokens=await response.json();check(started);
      // Pinned native refresh retains the original genuine refresh credential.
      tokens={...actual,refresh_token:current.refresh_token};return true;
    })();
    pending=operation;
    void operation.then(()=>{if(pending===operation)pending=undefined;},()=>{if(pending===operation)pending=undefined;});
    return operation;
  }
  async function validate() {
    const started=epoch,current=tokens;
    const response=await forward('/api/auth/v1/status',{headers:headers(current)});
    if(!response.ok){check(started);clear();throw new AuthProofHttpError(response.status);}
    const actual=await response.json();check(started);
    if(actual.auth_token)tokens=actual;else clear();
  }
  // Existing proof callers default to local; future public signOut defaults to global.
  async function logout(scope:'local'|'global'='local') {
    if(scope!=='local'&&scope!=='global')throw new TypeError('Unsupported proof logout scope');
    const current=tokens;clear();
    if(!current)return;
    if(scope==='local'){await revoke(current.refresh_token);return;}
    // Global candidate redirect following is investigated separately, not enabled here.
    const response=await forward('/api/auth/v1/logout',{method:'GET',headers:headers(current),redirect:'manual'});
    await response.body?.cancel();
    // Only the characterized root redirect counts as global success; never follow it.
    if(!response.ok&&!(scope==='global'&&[302,303].includes(response.status)&&response.headers.get('location')==='/'))throw new AuthProofHttpError(response.status);
  }
  return {login,refresh,validate,logout,tokens:()=>tokens,headers:()=>headers()};
}
