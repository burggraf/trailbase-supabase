import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Owned second-origin transport sink, NOT an auth server/acknowledgement.
// Retain only counts/credential-presence booleans, never header/body values.
export async function redirectSink() {
  const route=`/${randomUUID()}`;
  const seen={requests:0,getRequests:0,authorization:false,refresh:false,csrf:false,cookie:false,bodyBytes:0};
  const server=createServer((request,response)=>{
    if(request.url!==route){response.writeHead(404);response.end();return;}
    seen.requests++;
    seen.authorization ||= request.headers.authorization!==undefined;
    seen.refresh ||= request.headers['refresh-token']!==undefined;
    seen.csrf ||= request.headers['csrf-token']!==undefined;
    seen.cookie ||= request.headers.cookie!==undefined;
    request.on('data',bytes=>{seen.bodyBytes+=bytes.length;});
    if(request.method!=='GET'){response.writeHead(404);response.end();return;}
    seen.getRequests++;
    response.writeHead(200,{'access-control-allow-origin':'*','content-type':'text/plain'});
    response.end('Owned transport sink, not auth acknowledgement');
  });
  await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',no);yes();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Redirect sink did not bind owned loopback');
  return {
    url:`http://127.0.0.1:${address.port}${route}`,
    stats:()=>({...seen,listening:server.listening}),
    close:async()=>{
      const stopped=new Promise<void>((yes,no)=>server.close(error=>error?no(error):yes()));
      server.closeAllConnections();await stopped;
    }
  };
}
