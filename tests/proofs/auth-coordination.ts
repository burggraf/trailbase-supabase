import type { Tokens } from 'trailbase';

export class StaleAuthProofOperation extends Error {
  constructor(){super('Discarded stale proof auth operation');this.name='StaleAuthProofOperation';}
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
  async function login(email:string,password:string) {
    const started=++epoch;tokens=undefined;pending=undefined;
    const response=await forward('/api/auth/v1/login',{method:'POST',headers:headers(),body:JSON.stringify({email_or_username:email,password})});
    if(!response.ok){check(started);throw new AuthProofHttpError(response.status);}
    const actual:Tokens=await response.json();check(started);tokens=actual;
  }
  function refresh():Promise<boolean> {
    if(pending)return pending;
    const current=tokens,started=epoch;
    if(!current?.refresh_token)return Promise.resolve(false);
    const operation=(async()=>{
      const response=await forward('/api/auth/v1/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:current.refresh_token})});
      if(!response.ok){check(started);if(response.status===401)tokens=undefined;throw new AuthProofHttpError(response.status);}
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
    if(!response.ok){check(started);tokens=undefined;throw new AuthProofHttpError(response.status);}
    const actual=await response.json();check(started);
    tokens=actual.auth_token?actual:undefined;
  }
  async function logout() {
    const current=tokens;++epoch;tokens=undefined;pending=undefined;
    if(!current)return;
    const response=await forward('/api/auth/v1/logout',{method:'POST',headers:headers(current),body:JSON.stringify({refresh_token:current.refresh_token})});
    if(!response.ok)throw new AuthProofHttpError(response.status);
  }
  return {login,refresh,validate,logout,tokens:()=>tokens,headers:()=>headers()};
}
