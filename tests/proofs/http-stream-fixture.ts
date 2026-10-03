import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';

// Disposable loopback fault fixture, not a gateway/product. Forwards only genuine
// owned native response bytes; never copies auth/cookie headers to downstream clients.
export async function httpStreamFixture(upstream:(signal:AbortSignal)=>Promise<Response>, mode:'fragment'|'disconnect') {
  const route=`/${randomUUID()}`,controllers=new Set<AbortController>(),tasks=new Set<Promise<void>>();
  let cancelled=0,bytesWritten=0;
  const server=createServer((request,response)=>{
    if(request.method!=='GET'||request.url!==route){response.writeHead(404);response.end();return;}
    const abort=new AbortController();controllers.add(abort);
    request.socket.setNoDelay(true);
    response.on('close',()=>abort.abort());
    const task=(async()=>{
      let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
      try {
        const actual=await upstream(abort.signal);
        response.writeHead(actual.status,{'content-type':actual.headers.get('content-type')??'application/octet-stream'});
        response.flushHeaders();
        if(!actual.body)throw new Error('Actual upstream body missing');
        reader=actual.body.getReader();
        while(!abort.signal.aborted) {
          const chunk=await reader.read();if(chunk.done){response.end();break;}
          for(const byte of chunk.value) {
            if(abort.signal.aborted)break;
            // Actual HTTP writes separated by event-loop turns; the receiver observes
            // its own chunk boundaries. Do not claim one TCP packet per byte.
            await new Promise<void>((yes,no)=>response.write(new Uint8Array([byte]),error=>error?no(error):yes()));
            bytesWritten++;await nextTurn();
            if(mode==='disconnect'&&bytesWritten===32){response.destroy();return;}
          }
        }
      } catch {response.destroy();} // Client sees real transport failure; no fake success/error event.
      finally {
        abort.abort();
        if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();cancelled++;}
        controllers.delete(abort);
      }
    })();
    tasks.add(task);void task.then(()=>tasks.delete(task),()=>tasks.delete(task));
  });
  await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',no);yes();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Owned HTTP fixture did not bind loopback');
  return {
    url:`http://127.0.0.1:${address.port}${route}`,
    stats:()=>({active:controllers.size,cancelled,bytesWritten,listening:server.listening}),
    idle:async()=>{await Promise.allSettled([...tasks]);},
    close:async()=>{
      for(const controller of controllers)controller.abort();
      const stopped=new Promise<void>((yes,no)=>server.close(error=>error?no(error):yes()));
      server.closeAllConnections();await stopped;await Promise.allSettled([...tasks]);
    }
  };
}
