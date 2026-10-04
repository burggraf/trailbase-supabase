import { it,expect } from 'vitest';
import { redirectSink } from '../proofs/redirect-sink.js';

it('L1-27/S01/S07 owned redirect sink rejects other routes and records only credential-presence booleans',async()=>{
  const sink=await redirectSink();
  try {
    expect(new URL(sink.url).hostname).toBe('127.0.0.1');
    const denied=await fetch(new URL('/wrong',sink.url),{signal:AbortSignal.timeout(5000)});
    expect(denied.status).toBe(404);await denied.body?.cancel();expect(sink.stats().requests).toBe(0);
    const preflight=await fetch(sink.url,{method:'OPTIONS',signal:AbortSignal.timeout(5000)});
    expect(preflight.status).toBe(404);await preflight.body?.cancel();
    expect(sink.stats()).toMatchObject({requests:1,getRequests:0,authorization:false,refresh:false,csrf:false,cookie:false});
    const response=await fetch(sink.url,{headers:{Authorization:'Bearer fixture-marker','Refresh-Token':'fixture-marker','CSRF-Token':'fixture-marker',Cookie:'fixture=marker'},signal:AbortSignal.timeout(5000)});
    expect(response.status).toBe(200);await response.body?.cancel();
    expect(sink.stats()).toEqual({requests:2,getRequests:1,authorization:true,refresh:true,csrf:true,cookie:true,bodyBytes:0,listening:true});
  } finally {await sink.close();expect(sink.stats().listening).toBe(false);}
});
