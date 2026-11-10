// Fixed generated-fixture configuration loader, not a general exec or user-script interface.
export const fixtureServiceLaunch='set -a; . /owned-input.txt; exec /mailpit';
export const fixtureServiceReady='set -a; . /owned-input.txt; exec /mailpit readyz';
// Only public generated configuration and its private nonroot-writable directory; never user archives.
export function fixtureServiceArchive(runId){
 if(!/^\d{13}-[a-f0-9]{12}$/.test(runId))throw Error('Generated service run ID required');
 const payload=Buffer.from('# Generated public owned service '+runId+'\nMP_DATABASE=/owned-service/mailpit.db\nMP_UI_BIND_ADDR=127.0.0.1:28125\nMP_SMTP_BIND_ADDR=127.0.0.1:11025\n');
 function entry(name,mode,size,type){const h=Buffer.alloc(512);h.write(name,0,100,'ascii');for(const[o,n,v]of[[100,8,mode],[108,8,1001],[116,8,1002],[124,12,size],[136,12,0]])h.write(v.toString(8).padStart(n-1,'0'),o,n,'ascii');h.fill(32,148,156);h[156]=type;h.write('ustar',257,6,'ascii');h.write('00',263,2,'ascii');h.write(h.reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');return h;}
 return{payload,archive:Buffer.concat([entry('owned-service/',0o700,0,53),entry('owned-input.txt',0o640,payload.length,48),payload,Buffer.alloc((512-payload.length%512)%512),Buffer.alloc(1024)])};
}
