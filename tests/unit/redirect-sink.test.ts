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

it('L1-27/S01/S07 permissive owned sink accepts preflight without accepting credentials as an auth receipt',async()=>{
  // @ts-expect-error Runtime JS callers cannot opt in with arbitrary values.
  await expect(redirectSink('hosted')).rejects.toThrow('Invalid owned redirect sink preflight mode');
  const sink=await redirectSink(true);
  try{
    const preflight=await fetch(sink.url,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:1','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,refresh-token,csrf-token'},signal:AbortSignal.timeout(5000)});
    expect(preflight.status).toBe(204);expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toBe('authorization,content-type,refresh-token,csrf-token');expect(preflight.headers.has('access-control-allow-credentials')).toBe(false);
    expect(sink.stats()).toMatchObject({requests:1,getRequests:0,authorization:false,refresh:false,csrf:false,cookie:false,bodyBytes:0});
    const rejected=await fetch(sink.url,{method:'POST',body:'fixture-marker',signal:AbortSignal.timeout(5000)});expect(rejected.status).toBe(404);await rejected.body?.cancel();
    const received=await fetch(sink.url,{headers:{'Refresh-Token':'fixture-marker','CSRF-Token':'fixture-marker'},signal:AbortSignal.timeout(5000)});
    expect(received.status).toBe(200);expect(await received.text()).toBe('Owned transport sink, not auth acknowledgement');
    expect(sink.stats()).toEqual({requests:3,getRequests:1,authorization:false,refresh:true,csrf:true,cookie:false,bodyBytes:'fixture-marker'.length,listening:true});
  }finally{await sink.close();expect(sink.stats().listening).toBe(false);}
});
