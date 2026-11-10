import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {snapshotCommandInput} from './command-input.mjs';
import {fixtureServiceLaunch} from './fixture-service.mjs';
import {fixturePostgresLaunch} from './fixture-postgres-config.mjs';
const images=JSON.parse(readFileSync(new URL('../tests/fixtures/service-images.json',import.meta.url),'utf8')),versionImage=images.supabase_rest.repoDigests[0],serviceImage=images.supabase_inbucket.repoDigests[0];
// Diagnostic source boundaries only, never ownership, successful validation or settlement receipts.
export const fixtureCreationSteps=Object.freeze(['not-entered','daemon','name-check','image-command','image-validation','create-command','create-acknowledgement','verify-daemon','verify-id','verify-command','verify-configuration','creator-return']);
// Separate fixed-version probe; neither constructor adopts frontend-created IDs or starts a service.
export function createFixtureContainer(docker,runId,image){return originalContainer(docker,runId,image,false);}
export function createFixtureVersionContainer(docker,runId,image){assert.equal(image,versionImage,'Only pinned PostgREST version probe supported');return originalContainer(docker,runId,image,true);}
// Stopped writable-root fixture solely for opaque tar extraction; no service/start capability.
export function createFixtureArchiveContainer(docker,runId,image){assert.equal(image,versionImage,'Only pinned archive fixture supported');return originalContainer(docker,runId,image,false,true);}
// One generated no-exposure Mailpit service; original copy/start/stop/wait authority stays together.
export function createFixtureServiceContainer(docker,runId,image){assert.equal(image,serviceImage,'Only pinned Mailpit service supported');return originalContainer(docker,runId,image,false,true,true);}
// Fixed native PostgreSQL initialization in its original disposable layer, no preloaded depot.
export function createFixturePostgresContainer(docker,runId,image){assert.equal(image,images.supabase_db.repoDigests[0],'Only pinned PostgreSQL initialization supported');return originalContainer(docker,runId,image,false,true,true,true);}
function originalContainer(docker,runId,image,version,archive=false,service=false,postgres=false){
 const launch=postgres?fixturePostgresLaunch:fixtureServiceLaunch,user=postgres?'postgres':'1001:1002';
 assert(/^\d{13}-[a-f0-9]{12}$/.test(runId)&&typeof image==='string'&&/@sha256:[a-f0-9]{64}$/.test(image),'Pinned owned container input required');
 const name='trailbase-owned-'+runId;let phase='new',id,imageId,engine,busy=false,started=false,exitCode,entrypoint,copyAttempted=false,copyAcknowledged=false,stopAttempted=false,creationStep='not-entered';
 const command=async args=>(await docker.run(args)).stdout.trim();
 async function daemon(){const current=await command(['info','--format','{{.ID}}']);assert(/^[a-zA-Z0-9:_-]{1,128}$/.test(current),'Docker daemon observation missing');if(engine!==undefined)assert.equal(current,engine,'Docker daemon changed');return current;}
 async function ids(filter){const text=await command(['container','ls','-a','--no-trunc','--format','{{.ID}}','--filter',filter]);const values=text?text.split('\n'):[];assert(values.every(x=>/^[a-f0-9]{64}$/.test(x)),'Container inventory invalid');return values;}
 async function inspect(){
  if(phase==='creating')creationStep='verify-daemon';await daemon();
  if(phase==='creating')creationStep='verify-id';const found=await ids('id='+id);assert(found.length===0||found.length===1&&found[0]===id,'Original container ID mismatch');if(!found.length)return Object.freeze({id,exists:false,sqlSettled:false});
  if(phase==='creating')creationStep='verify-command';const raw=await command(['container','inspect','--format','{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"State":{"Status":{{json .State.Status}},"Running":{{json .State.Running}}},"HostConfig":{"NetworkMode":{{json .HostConfig.NetworkMode}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"PortBindings":{{json .HostConfig.PortBindings}}},"Mounts":{{json .Mounts}},"Config":{"Labels":{{json .Config.Labels}}}'+(version||archive?',"Probe":{"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}},"CapDrop":{{json (index .HostConfig "CapDrop")}},"SecurityOpt":{{json (index .HostConfig "SecurityOpt")}},"ExitCode":{{json .State.ExitCode}}'+(service?',"User":{{json .Config.User}},"Healthcheck":{{json (index .Config "Healthcheck")}},"RestartPolicy":{{json .HostConfig.RestartPolicy}},"AutoRemove":{{json .HostConfig.AutoRemove}},"Privileged":{{json .HostConfig.Privileged}},"StopSignal":{{json .Config.StopSignal}}':'')+'}':'')+'}',id]);
  if(phase==='creating')creationStep='verify-configuration';const v=JSON.parse(raw);
  assert.equal(v.Id,id);assert.equal(v.Image,imageId);assert.equal(v.Name,'/'+name);
  if(service&&started&&exitCode===undefined){assert(['running','exited'].includes(v.State?.Status),'Original service state unknown');assert.equal(v.State.Running,v.State.Status==='running');}else{assert.equal(v.State?.Status,exitCode===undefined?'created':'exited');assert.equal(v.State?.Running,false);}assert.equal(v.HostConfig?.NetworkMode,'none');assert.equal(v.HostConfig?.ReadonlyRootfs,!archive);assert.equal(Object.keys(v.HostConfig.PortBindings??{}).length,0);assert.deepEqual(v.Mounts,[]);assert.equal(v.Config?.Labels?.['trailbase-supabase.run'],runId);
  if(version){assert.deepEqual(v.Probe?.Entrypoint,[entrypoint]);assert.deepEqual(v.Probe?.Cmd,['--version']);if(exitCode!==undefined)assert.equal(v.Probe.ExitCode,exitCode,'Original container exit drift');}
  if(version||archive){assert.deepEqual(v.Probe?.CapDrop,['ALL']);assert(Array.isArray(v.Probe?.SecurityOpt)&&v.Probe.SecurityOpt.some(x=>x==='no-new-privileges'||x==='no-new-privileges=true'),'Owned fixture privilege drift');}
  if(service){assert.deepEqual(v.Probe?.Entrypoint,['/bin/sh']);assert.deepEqual(v.Probe?.Cmd,['-ec',launch]);assert.equal(v.Probe?.User,user);assert.deepEqual(v.Probe?.Healthcheck?.Test,['NONE']);assert.equal(v.Probe?.RestartPolicy?.Name,'no');assert.equal(v.Probe?.AutoRemove,false);assert.equal(v.Probe?.Privileged,false);assert.equal(v.Probe?.StopSignal,'SIGTERM');if(exitCode!==undefined)assert.equal(v.Probe.ExitCode,exitCode,'Original service exit drift');}
  return Object.freeze({id,exists:true,status:v.State.Status,...(service?{running:v.State.Running}:{}),...(exitCode===undefined?{}:{exitCode}),sqlSettled:false});
 }
 function enter(readonly=false){assert((phase==='owned'||readonly&&phase==='removed')&&!busy,'Original container ownership unavailable');busy=true;}
 return Object.freeze({
  get id(){assert(phase==='owned'&&id,'Original container creation unavailable');return id;},
  get creationStep(){return creationStep;},
  snapshot(){return Object.freeze({complete:false,id:id??null,phase,busy,started,waited:exitCode!==undefined&&phase==='owned',...(archive?{copyAcknowledged}:{} )});},
  async create(){assert.equal(phase,'new','Original container creation once-only');phase='creating';try{
   creationStep='daemon';engine=await daemon();creationStep='name-check';assert.deepEqual(await ids('name=^'+name+'$'),[],'Existing container refused');
   creationStep='image-command';const raw=await command(['image','inspect','--format','{"Id":{{json .Id}},"RepoDigests":{{json .RepoDigests}},"Volumes":{{json (index .Config "Volumes")}}'+(version||service?',"Entrypoint":{{json (index .Config "Entrypoint")}},"Cmd":{{json (index .Config "Cmd")}}'+(service?',"User":{{json (index .Config "User")}}':''):'')+'}',image]);
   creationStep='image-validation';const imageValue=JSON.parse(raw);
   assert(/^sha256:[a-f0-9]{64}$/.test(imageValue.Id));assert(Array.isArray(imageValue.RepoDigests)&&imageValue.RepoDigests.includes(image));assert.equal(Object.keys(imageValue.Volumes??{}).length,0,'Image volume declaration refused');imageId=imageValue.Id;
   if(version){const command=imageValue.Entrypoint??imageValue.Cmd;assert(Array.isArray(command)&&command.length===1&&['postgrest','/bin/postgrest'].includes(command[0]),'Pinned version entrypoint unsupported');entrypoint=command[0];}
   if(service){assert.deepEqual(imageValue.Entrypoint,[postgres?'docker-entrypoint.sh':'/mailpit'],'Pinned service entrypoint unsupported');if(postgres)assert.deepEqual(imageValue.Cmd,['postgres','-D','/etc/postgresql'],'Pinned PostgreSQL command unsupported');else assert(imageValue.Cmd==null||Array.isArray(imageValue.Cmd)&&imageValue.Cmd.length===0,'Pinned service command unsupported');assert(imageValue.User==null||imageValue.User==='','Pinned service user unsupported');}
   creationStep='create-command';const created=await command(['container','create','--pull=never','--network','none',...(archive?[]:['--read-only']),'--no-healthcheck','--label','trailbase-supabase.run='+runId,'--name',name,...(version||archive?['--cap-drop','ALL','--security-opt','no-new-privileges']:[]),...(version?['--entrypoint',entrypoint]:[]),...(service?['--entrypoint','/bin/sh','--user',user,'--stop-signal','SIGTERM','--restart','no']:[]),imageId,...(version?['--version']:[]),...(service?['-ec',launch]:[])]);creationStep='create-acknowledgement';assert(/^[a-f0-9]{64}$/.test(created),'Original create ID unknown');id=created;await inspect();phase='owned';creationStep='creator-return';
  }catch(error){phase='unknown';throw error;}},
  async copyArchive(input){assert(archive&&!postgres&&!copyAttempted,'Only original once-only archive copy supported');const stdin=snapshotCommandInput(input);enter();copyAttempted=true;try{
   assert.equal((await inspect()).exists,true,'Original container absent before copy');
   await docker.run(['cp','-',id+':/'],{input:stdin});
   assert.equal((await inspect()).exists,true,'Original container absent after copy');copyAcknowledged=true;return Object.freeze({acknowledged:true,sqlSettled:false});
  }catch(error){phase='unknown';throw error;}finally{busy=false;}},
  async start(){assert(service&&!started&&(postgres||copyAcknowledged),'Only original once-only copied service start supported');enter();try{
   assert.equal((await inspect()).exists,true,'Original service absent before start');started=true;phase='starting';
   assert.equal(await command(['container','start',id]),id,'Original service start acknowledgement unknown');
   const current=await inspect();assert.equal(current.exists,true,'Original service absent after start');phase='owned';return Object.freeze({started:true,status:current.status,sqlSettled:false});
  }catch(error){phase='unknown';throw error;}finally{busy=false;}},
  async stopAndWait(){assert(service&&started&&!stopAttempted,'Only original once-only service stop/wait supported');enter();stopAttempted=true;try{
   const current=await inspect();assert.equal(current.exists,true,'Original service absent before stop');
   if(current.running)assert.equal(await command(['container','stop','--timeout=-1',id]),id,'Original service stop acknowledgement unknown');
   const receipt=await command(['container','wait',id]);assert(/^(0|[1-9]\d{0,2})$/.test(receipt)&&Number(receipt)<=255,'Original service wait receipt unknown');exitCode=Number(receipt);
   assert.equal((await inspect()).exists,true,'Original service absent after wait');return Object.freeze({exitCode,containerExited:true,sqlSettled:false});
  }catch(error){phase='unknown';throw error;}finally{busy=false;}},
  async startAndWait(){assert(version&&!started,'Only original once-only fixed version start supported');enter();try{
   assert.equal((await inspect()).exists,true,'Original container absent before start');started=true;phase='starting';
   assert.equal(await command(['container','start',id]),id,'Original start acknowledgement unknown');
   const receipt=await command(['container','wait',id]);assert(/^(0|[1-9]\d{0,2})$/.test(receipt)&&Number(receipt)<=255,'Original container wait receipt unknown');exitCode=Number(receipt);
   assert.equal((await inspect()).exists,true,'Original container absent after wait');phase='owned';return Object.freeze({exitCode,containerExited:true,sqlSettled:false});
  }catch(error){phase='unknown';throw error;}finally{busy=false;}},
  async inventory(){enter(true);try{const removed=phase==='removed',value=await inspect();if(removed)assert.equal(value.exists,false,'Removed original container reappeared');return value;}catch(error){phase='unknown';throw error;}finally{busy=false;}},
  async remove(){assert(!service||!started||exitCode!==undefined,'Original service not stopped/waited; retain resources');enter();try{const before=await inspect();if(before.exists)await command(['container','rm',id]);await daemon();assert.deepEqual(await ids('id='+id),[],'Original container removal unconfirmed');phase='removed';}catch(error){phase='unknown';throw error;}finally{busy=false;}}
 });
}
