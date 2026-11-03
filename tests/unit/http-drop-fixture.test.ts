import { createServer } from 'node:http';
import { it, expect } from 'vitest';
import { httpStreamFixture } from '../proofs/http-stream-fixture.js';

it('L1-19/OGL05 owned native GET wire fixture forwards real bytes or loses/truncates them without accepting a POST or replaying', async () => {
  for (const mode of ['fragment', 'truncate', 'disconnect', 'drop'] as const) {
    let calls = 0;
    const fixture = await httpStreamFixture(async () => { calls++; return new Response('logged out', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); }, mode, '/api/auth/v1/logout');
    try {
      const refused = await fetch(fixture.url, { method: 'POST', signal: AbortSignal.timeout(5000) }); expect(refused.status).toBe(404); await refused.body?.cancel(); expect(calls).toBe(0);
      const delivery = fetch(fixture.url, { signal: AbortSignal.timeout(5000) }).then(response => { expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8'); return response.text(); });
      if (mode === 'fragment' || mode === 'truncate') expect(await delivery).toBe(mode === 'fragment' ? 'logged out' : 'logge');
      else await expect(delivery).rejects.toBeInstanceOf(TypeError);
      await fixture.idle(); expect(calls).toBe(1); expect(fixture.stats()).toMatchObject({ active: 0, bytesWritten: mode === 'drop' ? 0 : mode === 'fragment' ? 10 : 5 });
    } finally { await fixture.close(); expect(fixture.stats()).toMatchObject({ active: 0, listening: false }); }
  }
});

it('L1-27/U27/S05 owned HTTP drop completes one upstream POST but delivers no response and closes resources',async()=>{
  let calls=0,status=0;
  const server=createServer((request,response)=>{
    if(request.method!=='POST'||request.url!=='/owned'){response.writeHead(404);response.end();return;}
    calls++;request.resume();response.writeHead(201,{'content-type':'application/json'});response.end('{"fixture":"completed"}');
  });
  await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',no);yes();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Owned unit upstream missing');
  let fixture:Awaited<ReturnType<typeof httpStreamFixture>>|undefined;
  try {
    fixture=await httpStreamFixture(async signal=>{
      const actual=await fetch(`http://127.0.0.1:${address.port}/owned`,{method:'POST',body:'fixture',signal});status=actual.status;return actual;
    },'drop');
    await expect(fetch(fixture.url,{signal:AbortSignal.timeout(5000)})).rejects.toBeInstanceOf(TypeError);
    await fixture.idle();expect(calls).toBe(1);expect(status).toBe(201);
    expect(fixture.stats()).toMatchObject({active:0,bytesWritten:0,listening:true});
  } finally {
    if(fixture){await fixture.close();expect(fixture.stats()).toMatchObject({active:0,listening:false});}
    const stopped=new Promise<void>((yes,no)=>server.close(error=>error?no(error):yes()));server.closeAllConnections();await stopped;
  }
});
