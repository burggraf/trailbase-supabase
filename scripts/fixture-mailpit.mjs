import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createFixtureFiles} from './fixture-files.mjs';
import {createFixtureDocker} from './fixture-docker.mjs';
import {createFixtureServiceContainer} from './fixture-container.mjs';
import {fixtureServiceArchive,fixtureServiceReady} from './fixture-service.mjs';
import {createFixtureCommandOwner} from './fixture-cli.mjs';
const parseConfiguration='import sys,tarfile,io,json,hashlib\nwith tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read())) as t:\n m=t.getmember("owned-input.txt")\n assert m.isfile()\n data=t.extractfile(m).read()\n print(json.dumps(dict(name=m.name,uid=m.uid,gid=m.gid,mode=m.mode,size=len(data),sha256=hashlib.sha256(data).hexdigest())))';
const image=JSON.parse(readFileSync(new URL('../tests/fixtures/service-images.json',import.meta.url),'utf8')).supabase_inbucket.repoDigests[0];
// One actual h profile, not full bootstrap or a recovered/discovered resource controller.
export async function createOwnedMailpitHarness(env){
 const id=Date.now()+'-'+randomUUID().replaceAll('-','').slice(0,12),directory=resolve('.runtime/runs',id),context={id,directory,profile:'owned-mailpit',setupStage:'allocated',ready:false};
 const files=await createFixtureFiles(directory,{id,profile:'owned-mailpit'}),docker=createFixtureDocker(files,env),service=createFixtureServiceContainer(docker,id,image),verify=createFixtureCommandOwner(files,env,'/usr/bin/python3','MailpitConfiguration');
 const generated=fixtureServiceArchive(id),expected={name:'owned-input.txt',uid:1001,gid:1002,mode:0o640,size:generated.payload.length,sha256:createHash('sha256').update(generated.payload).digest('hex')};
 let attempted=false,starting=false,sealed=false,unknown=false,stop,stopped,cleanupFlight,lastService=null,configuration=null,reads=0;
 async function fence(){assert(!unknown,'Original service h outcome unknown; retain resources');const f=await files.inventory();assert(!f.unknown&&!f.closed,'Original service file outcome unknown; retain resources');await files.admit();await docker.fence();await verify.fence();}
 async function readConfiguration(){const archive=(await docker.run(['cp',service.id+':/owned-input.txt','-'])).stdout;const result=await verify.run('configuration-'+(++reads),['-I','-B','-S','-c',parseConfiguration],true,10000,Buffer.from(archive));const value=JSON.parse(result.stdout);assert.deepEqual(value,expected,'Original generated service configuration drift');configuration=value;}
 async function inventoryResources(){
  try{if(!files.closed){await fence();if(service.snapshot().phase!=='new')lastService=await service.inventory();}return{complete:false,profile:'owned-mailpit',service:{snapshot:service.snapshot(),current:lastService,configuration,observedBeforeFileClosure:files.closed},files:await files.inventory(),docker:await docker.inventory(),verification:await verify.inventory(),native:null,network:null,cli:null};}
  catch(error){unknown=true;throw error;}
 }
 async function start(){assert(!attempted&&!sealed,'Original service h start is once-only/sealed');attempted=true;starting=true;
  try{await fence();docker.bind(await docker.context());await service.create();await service.copyArchive(generated.archive);await readConfiguration();await service.start();lastService=await service.inventory();
   if(lastService.running){await docker.run(['container','exec',service.id,'/bin/sh','-ec',fixtureServiceReady]);lastService=await service.inventory();}
   await readConfiguration();context.ready=lastService.running;context.setupStage=context.ready?'service-running':'service-exited';return context;
  }catch(error){unknown=true;throw error;}finally{starting=false;}
 }
 function stopNative(){sealed=true;return stop??=(async()=>{try{assert(!starting,'Original service h start pending; retain resources');await fence();const s=service.snapshot();if(s.phase==='new')stopped={containerExited:false,neverStarted:true,sqlSettled:false};else{assert(s.phase==='owned','Original service state unknown; retain resources');stopped=s.started?await service.stopAndWait():{containerExited:false,neverStarted:true,sqlSettled:false};await readConfiguration();}context.ready=false;context.setupStage='service-contained';return stopped;}catch(error){unknown=true;throw error;}})();}
 function cleanup(){return cleanupFlight??=(async()=>{try{assert(stopped&&!starting,'Original service must be stopped/waited before joined cleanup');await fence();if(service.snapshot().phase!=='new'){await service.remove();lastService=await service.inventory();assert.equal(lastService.exists,false,'Original service removal unconfirmed');}await docker.fence();await verify.fence();await files.close();context.ready=false;context.setupStage='service-closed';return inventoryResources();}catch(error){unknown=true;throw error;}})();}
 return Object.freeze({context,start,inventoryResources,stopNative,cleanup,finishAfterAuditorJoin:cleanup});
}
