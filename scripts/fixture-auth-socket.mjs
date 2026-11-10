import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,pbkdf2Sync,createHmac,createHash} from 'node:crypto';
import {snapshotCommandInput} from './command-input.mjs';

const images=JSON.parse(readFileSync(new URL('../tests/fixtures/service-images.json',import.meta.url),'utf8'));
const pins={postgres:images.supabase_db.repoDigests[0],auth:images.supabase_auth.repoDigests[0]};
const idPattern=/^[a-f0-9]{64}$/,imagePattern=/^sha256:[a-f0-9]{64}$/;
const runPattern=/^\d{13}-[a-f0-9]{12}$/;
const socketDirectory='/tmp/owned-auth-socket',postgresDataDirectory='/tmp/owned-postgres/data';
const volumeOptions=Object.freeze({type:'tmpfs',device:'tmpfs',o:'uid=100,gid=101,mode=0710,size=1m,nodev,nosuid,noexec'});
const hba='local postgres supabase_auth_admin scram-sha-256\nlocal postgres supabase_admin peer map=owned-postgres-admin\nlocal all all reject\nlocal replication all reject\nhost all all all reject\nhost replication all all reject\n';
const ident='owned-postgres-admin postgres supabase_admin\n';
const postgresLaunch=`set -eu
PATH=/usr/bin:/bin; export PATH
umask 077
test "$(id -u):$(id -g):$(id -un)" = 100:101:postgres
test -d ${socketDirectory} && test ! -L ${socketDirectory}
test "$(stat -c '%u:%g:%a' ${socketDirectory})" = 100:101:710
test ! -e /tmp/owned-postgres
mkdir -m 700 /tmp/owned-postgres
/usr/bin/initdb -D ${postgresDataDirectory} -U supabase_admin --auth-local=peer --auth-host=reject --no-instructions
cat >${postgresDataDirectory}/pg_hba.conf <<'OWNED_HBA'
${hba}OWNED_HBA
cat >${postgresDataDirectory}/pg_ident.conf <<'OWNED_IDENT'
${ident}OWNED_IDENT
exec /usr/bin/postgres -D ${postgresDataDirectory} -c "listen_addresses=''" -c "unix_socket_directories='${socketDirectory}'" -c unix_socket_permissions=0620 -c password_encryption=scram-sha-256 -c "shared_preload_libraries=''" -c "session_preload_libraries=''" -c "local_preload_libraries=''"
`;
// Required for future delivery, NOT an admitted/executable invocation. Native errors may include URLs.
const configurationDelivery=Object.freeze({environment:'empty',configFile:'/dev/stdin',configDirectory:false,output:'discard',executionAdmitted:false});
export const authSocketProfile=Object.freeze({socketDirectory,postgresDataDirectory,postgresUser:'100:101',authUser:'1000:101',directoryMode:0o710,socketMode:0o620,volumeOptions,hba,ident,postgresLaunch,configurationDelivery});
// Nonsecret accidental-target guard; original family/peer/container references remain the authority.
const originalPostgresLaunch=runId=>postgresLaunch.trimEnd()+' -c fixture.auth_owner='+runId+'\n';
const imageFormat='{"Id":{{json .Id}},"RepoDigests":{{json .RepoDigests}},"Volumes":{{json (index .Config "Volumes")}}}';
// Never request Config.Env, file contents, daemon inventory or the host volume mountpoint.
const volumeFormat='{"Name":{{json .Name}},"Driver":{{json .Driver}},"Scope":{{json .Scope}},"Labels":{{json .Labels}},"Options":{{json .Options}}}';
const mountsFormat='[{{range $i, $m := .Mounts}}{{if $i}},{{end}}{"Type":{{json $m.Type}},"Name":{{json (index $m "Name")}},"Destination":{{json $m.Destination}},"RW":{{json $m.RW}}}{{end}}]';
const containerFormat='{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"State":{"Status":{{json .State.Status}},"Running":{{json .State.Running}}},"User":{{json .Config.User}},"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}},"Labels":{{json .Config.Labels}},"HostConfig":{{json .HostConfig}},"Mounts":'+mountsFormat+'}';
const info=['info','--format','{{.ID}}'];
const labels=runId=>['--label','trailbase-supabase.run='+runId,'--label','trailbase-supabase.fixture=auth-socket'];
const volumeCreate=runId=>['volume','create','--driver','local',...Object.entries(volumeOptions).flatMap(([k,v])=>['--opt',k+'='+v]),...labels(runId)];
const inspectVolume=name=>['volume','inspect','--format',volumeFormat,name];
const listVolume=name=>['volume','ls','--quiet','--filter','name=^'+name+'$'];
const inspectContainer=id=>['container','inspect','--format',containerFormat,id];
const listContainer=id=>['container','ls','-a','--no-trunc','--format','{{.ID}}','--filter','id='+id];
function createContainer(runId,kind,volume,image){
 const auth=kind==='auth';
 return ['container','create','--pull=never','--network','none',...(auth?['--read-only']:[]),'--no-healthcheck','--cap-drop','ALL','--security-opt','no-new-privileges','--ipc','private','--user',auth?'1000:101':'100:101','--restart','no',...labels(runId),'--label','trailbase-supabase.role='+kind,'--name','trailbase-auth-socket-'+runId+'-'+kind,'--mount',`type=volume,src=${volume},dst=${socketDirectory},volume-nocopy${auth?',readonly':''}`,'--entrypoint',auth?'/usr/local/bin/gotrue':'/bin/sh',image,...(auth?['migrate']:['-ec',originalPostgresLaunch(runId)])];
}
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
// Separate exact opt-in gate. It deliberately admits neither start/exec nor secret/stdin input.
export function authSocketCommandAllowed(runId,args){
 if(typeof runId!=='string'||!runPattern.test(runId)||!Array.isArray(args)||!args.every(x=>typeof x==='string'))return false;
 if(equal(args,info)||equal(args,volumeCreate(runId)))return true;
 for(const kind of ['postgres','auth'])if(equal(args,['image','inspect','--format',imageFormat,pins[kind]]))return true;
 const id=args.at(-1);
 if(typeof id==='string'&&idPattern.test(id)&&[inspectVolume(id),['volume','rm',id],inspectContainer(id),['container','rm',id]].some(v=>equal(v,args)))return true;
 const childFilter=typeof id==='string'?/^id=([a-f0-9]{64})$/.exec(id):null;
 const volumeFilter=typeof id==='string'?/^name=\^([a-f0-9]{64})\$$/.exec(id):null;
 if(childFilter&&equal(args,listContainer(childFilter[1]))||volumeFilter&&equal(args,listVolume(volumeFilter[1])))return true;
 for(const kind of ['postgres','auth']){
  const mount=args[args.indexOf('--mount')+1],image=args[args.indexOf('--entrypoint')+2];
  const volume=typeof mount==='string'?/^type=volume,src=([a-f0-9]{64}),/.exec(mount)?.[1]:undefined;
  if(volume&&typeof image==='string'&&imagePattern.test(image)&&equal(args,createContainer(runId,kind,volume,image)))return true;
 }
 return false;
}
const retained=new Set();
// One original resource family, never a constructor from saved IDs/names/receipts/discovery.
export function createFixtureAuthSocketTransport(docker,runId){
 assert(typeof runId==='string'&&runPattern.test(runId),'Owned socket run required');
 assert(typeof docker?.run==='function'&&typeof docker?.fence==='function','Original Docker owner required');
 const state={docker,phase:'new',reason:null,error:null,engine:undefined,volume:undefined,children:[],configuration:undefined};
 let configurationAttempted=false,configuration;
 const command=async args=>{assert(authSocketCommandAllowed(runId,args),'Fixed socket command required');return(await docker.run(args)).stdout.trim();};
 function hold(error,reason){state.reason??=reason;state.error??=error;state.phase='retained';}
 async function realm(){const engine=await command(info);assert(/^[a-zA-Z0-9:_-]{1,128}$/.test(engine),'Original daemon missing');if(state.engine===undefined)state.engine=engine;else assert.equal(engine,state.engine,'Original daemon changed');}
 function checkLabels(value,kind){assert.equal(value?.['trailbase-supabase.run'],runId);assert.equal(value?.['trailbase-supabase.fixture'],'auth-socket');if(kind)assert.equal(value?.['trailbase-supabase.role'],kind);}
 async function checkVolume(){
  await realm();const v=JSON.parse(await command(inspectVolume(state.volume)));
  assert.equal(v.Name,state.volume);assert.equal(v.Driver,'local');assert.equal(v.Scope,'local');checkLabels(v.Labels);assert.equal(v.Labels?.['com.docker.volume.anonymous'],'');assert.deepEqual(v.Options,volumeOptions);
 }
 async function checkChild(child){
  await realm();assert.equal(await command(listContainer(child.id)),child.id,'Original stopped child missing');
  const v=JSON.parse(await command(inspectContainer(child.id))),auth=child.kind==='auth',h=v.HostConfig;
  assert.equal(v.Id,child.id);assert.equal(v.Image,child.image);assert.equal(v.Name,'/trailbase-auth-socket-'+runId+'-'+child.kind);
  assert.deepEqual(v.State,{Status:'created',Running:false});assert.equal(v.User,auth?'1000:101':'100:101');assert.deepEqual(v.Entrypoint,[auth?'/usr/local/bin/gotrue':'/bin/sh']);assert.deepEqual(v.Cmd,auth?['migrate']:['-ec',originalPostgresLaunch(runId)]);checkLabels(v.Labels,child.kind);
  assert.equal(h.NetworkMode,'none');assert.equal(h.ReadonlyRootfs,auth);assert.equal(h.Privileged,false);assert.equal(h.AutoRemove,false);assert.equal(h.RestartPolicy?.Name,'no');assert.equal(Object.keys(h.PortBindings??{}).length,0);assert.deepEqual(h.CapDrop,['ALL']);assert.deepEqual(h.SecurityOpt,['no-new-privileges']);assert.equal(h.PidMode,'');assert.equal(h.IpcMode,'private');assert.equal(h.UsernsMode,'');
  for(const key of ['CapAdd','Binds','Devices','DeviceRequests','DeviceCgroupRules','VolumesFrom','GroupAdd'])assert(h[key]==null||Array.isArray(h[key])&&h[key].length===0,'Unexpected child resource');
  assert.equal(Object.keys(h.Tmpfs??{}).length,0,'Unexpected tmpfs resource');
  assert.equal(h.Mounts?.length,1);const spec=h.Mounts[0];assert.equal(spec.Type,'volume');assert.equal(spec.Source,state.volume);assert.equal(spec.Target,socketDirectory);assert.equal(spec.ReadOnly===true,auth);assert.equal(spec.VolumeOptions?.NoCopy,true);assert(spec.VolumeOptions.DriverConfig==null&&spec.BindOptions==null&&spec.TmpfsOptions==null,'Unexpected mount options');
  assert.equal(v.Mounts?.length,1);const mount=v.Mounts[0];assert.equal(mount.Type,'volume');assert.equal(mount.Name,state.volume);assert.equal(mount.Destination,socketDirectory);assert.equal(mount.RW,!auth);
 }
 const owner=Object.freeze({
  snapshot:()=>Object.freeze({phase:state.phase,reason:state.reason,volumeAcknowledged:state.volume!==undefined,childrenAcknowledged:state.children.length,resourcesRemoved:state.phase==='closed',configurationPrepared:configuration!==undefined,credentialProvisioned:false,migrationReady:false,logicalSettlement:false}),
  prepareAuthConfiguration(){
   assert(arguments.length===0,'Fixed Auth configuration required');
   assert(state.phase==='new'&&!configurationAttempted,'Original Auth configuration once-only');configurationAttempted=true;retained.add(state);
   try{configuration=configurationMaterial(owner,runId,()=>state.phase==='new'||state.phase==='prepared');state.configuration=configuration;return configuration.capsule;}
   catch(error){hold(error,'configuration-unconfirmed');throw Error('Original Auth configuration unconfirmed');}
  },
  async createStopped(){
   assert.equal(state.phase,'new','Original socket formation once-only');state.phase='preparing';retained.add(state);
   try{
    await docker.fence();await realm();
    const volume=await command(volumeCreate(runId));assert(idPattern.test(volume),'Original anonymous volume acknowledgement unknown');state.volume=volume;await checkVolume();
    for(const kind of ['postgres','auth']){
     const image=JSON.parse(await command(['image','inspect','--format',imageFormat,pins[kind]]));
     assert(imagePattern.test(image.Id)&&Array.isArray(image.RepoDigests)&&image.RepoDigests.includes(pins[kind]),'Pinned image binding unknown');assert.equal(Object.keys(image.Volumes??{}).length,0,'Image volume declaration refused');
     await realm();const id=await command(createContainer(runId,kind,state.volume,image.Id));assert(idPattern.test(id)&&!state.children.some(c=>c.id===id),'Original distinct child acknowledgement unknown');
     const child={id,image:image.Id,kind};state.children.push(child);await checkChild(child);
    }
    await checkVolume();await docker.fence();state.phase='prepared';
   }catch(error){hold(error,'formation-unconfirmed');throw error;}
  },
  async dispose(){
   assert.equal(state.phase,'prepared','Original socket family not disposable');state.phase='disposing';
   try{
    await docker.fence();await checkVolume();for(const child of state.children)await checkChild(child);
    for(const child of [...state.children].reverse()){
     await realm();assert.equal(await command(['container','rm',child.id]),child.id,'Original removal acknowledgement unknown');
     await realm();assert.equal(await command(listContainer(child.id)),'','Original child removal unconfirmed');
    }
    await checkVolume();await docker.fence();await realm();assert.equal(await command(['volume','rm',state.volume]),state.volume,'Original volume removal acknowledgement unknown');
    await realm();assert.equal(await command(listVolume(state.volume)),'','Original volume removal unconfirmed');await docker.fence();state.phase='closed';configuration?.release();retained.delete(state);
   }catch(error){hold(error,'disposition-unconfirmed');throw error;}
  }
 });
 return owner;
}

// Fixture-only private producer: no caller seed/password/SQL/path/config/command API.
function configurationMaterial(owner,runId,available){
 const copies=[];
 function entropy(size){const raw=randomBytes(size),copy=snapshotCommandInput(raw,size);assert.equal(copy.length,size,'Fixed entropy size required');copies.push(copy);return copy;}
 let role,auth;
 try{
  const password=entropy(32).toString('base64url'),salt=entropy(16),jwt=entropy(32).toString('base64url');
  const salted=pbkdf2Sync(password,salt,4096,32,'sha256');copies.push(salted);
  const client=createHmac('sha256',salted).update('Client Key').digest();copies.push(client);
  const stored=createHash('sha256').update(client).digest(),server=createHmac('sha256',salted).update('Server Key').digest();copies.push(stored,server);
  const verifier='SCRAM-SHA-256$4096:'+salt.toString('base64')+'$'+stored.toString('base64')+':'+server.toString('base64');
  const query=new URLSearchParams({host:socketDirectory,port:'5432',sslmode:'disable',passfile:'/dev/null',search_path:'auth'});
  const url='postgres://supabase_auth_admin:'+password+'@localhost/postgres?'+query;
  auth=Buffer.from('GOTRUE_DB_DRIVER=postgres\nGOTRUE_DB_DATABASE_URL='+url+'\nDB_NAMESPACE=auth\nGOTRUE_JWT_SECRET='+jwt+'\nGOTRUE_SITE_URL=http://127.0.0.1\nAPI_EXTERNAL_URL=http://127.0.0.1\nGOTRUE_LOG_LEVEL=error\nGOTRUE_DB_MAX_POOL_SIZE=1\n');
  role=Buffer.from(roleProvisioningInput(runId,verifier));
 }finally{for(const b of copies)b.fill(0);}
 let roleInputTaken=false,authInputTaken=false,released=false;
 function check(original,count){if(original!==owner)throw Error('Original configuration owner required');assert(count===1&&available()&&!released,'Original configuration unavailable');}
 const release=()=>{role.fill(0);auth.fill(0);released=true;};
 const capsule=Object.freeze({
  snapshot:()=>Object.freeze({prepared:true,ownerBound:true,roleInputTaken,authInputTaken,released,executionAdmitted:false,credentialProvisioned:false,migrationReady:false,logicalSettlement:false}),
  roleInput(original){check(original,arguments.length);assert(!roleInputTaken,'Original role input once-only');roleInputTaken=true;const result=snapshotCommandInput(role,16384);role.fill(0);return result;},
  authInput(original){check(original,arguments.length);assert(!authInputTaken,'Original Auth input once-only');authInputTaken=true;const result=snapshotCommandInput(auth,16384);auth.fill(0);return result;}
 });
 // Best-effort clearing of owned buffers only, NOT guaranteed JS string/consumer-copy erasure.
 return {capsule,release};
}
function roleProvisioningInput(runId,verifier){
 return `BEGIN;
SET LOCAL log_statement = none;
SET LOCAL log_min_error_statement = panic;
SET LOCAL search_path = pg_catalog;
DO $owned_auth_guard$
BEGIN
 IF current_database() <> 'postgres' OR current_user <> 'supabase_admin' OR session_user <> 'supabase_admin'
 OR current_setting('server_version_num') <> '170011'
 OR current_setting('data_directory') <> '/tmp/owned-postgres/data'
 OR current_setting('unix_socket_directories') <> '/tmp/owned-auth-socket'
 OR current_setting('port') <> '5432' OR current_setting('listen_addresses') <> ''
 OR current_setting('shared_preload_libraries') <> '' OR current_setting('session_preload_libraries') <> '' OR current_setting('local_preload_libraries') <> ''
 OR current_setting('password_encryption') <> 'scram-sha-256'
 OR current_setting('fixture.auth_owner', true) IS DISTINCT FROM '${runId}'
 THEN RAISE EXCEPTION 'Fresh original Auth store required'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin')
 OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')
 OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
 OR NOT EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname='postgres' AND r.rolname='supabase_admin')
 THEN RAISE EXCEPTION 'Fresh Auth namespace and role required'; END IF;
END;
$owned_auth_guard$;
CREATE ROLE supabase_auth_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD '${verifier}';
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin IN DATABASE postgres SET search_path = auth;
DO $owned_auth_check$
DECLARE r record;
BEGIN
 SELECT oid,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolcanlogin,rolconnlimit INTO STRICT r FROM pg_roles WHERE rolname='supabase_auth_admin';
 IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls OR NOT r.rolcanlogin OR r.rolconnlimit <> 4
 OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
 OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=r.oid)
 OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth' AND nspowner=r.oid)
 OR NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase WHERE d.datname='postgres' AND s.setrole=r.oid AND s.setconfig=ARRAY['search_path=auth'])
 THEN RAISE EXCEPTION 'Auth role isolation unconfirmed'; END IF;
END;
$owned_auth_check$;
COMMIT;
`;
}
