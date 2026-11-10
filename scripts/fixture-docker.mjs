import assert from 'node:assert/strict';
import {fixtureInspectionPublicFailure,fixtureInspectionPublicBuild,fixtureInspectionPublicLayout,fixtureInspectionPublicSources} from './fixture-inspection.mjs';
import {resolve} from 'node:path';
import {authSocketCommandAllowed} from './fixture-auth-socket.mjs';
import {createFixtureCommandOwner} from './fixture-cli.mjs';
import {snapshotCommandInput,commandInputLimit} from './command-input.mjs';
import {fixtureServiceReady} from './fixture-service.mjs';
import {fixturePostgresReady,fixturePostgresRead,fixturePostgresBootstrapInspection,fixturePostgresBootstrapSources} from './fixture-postgres-config.mjs';
import {fixturePostgresAuthBaseApply,fixturePostgresAuthBaseRead,fixturePostgresVaultApply,fixturePostgresVaultRead,fixturePostgresMigrationSources,fixturePostgresVaultInspection,fixturePostgresVaultPrerequisites} from './fixture-postgres-bootstrap.mjs';
export function localDockerTarget(host){assert(typeof host==='string'&&host.startsWith('unix:///')&&!/[\0\r\n?#]/.test(host)&&resolve(host.slice(7))===host.slice(7),'Invalid local Docker endpoint');return host;}
// This is direct command custody, not daemon attestation or container adoption authority.
export function createFixtureDocker(files,env,binary='/usr/bin/docker'){return originalDocker(files,env,binary,null);}
// Explicit launch-inert fixture factory; no inherited environment or Docker credential/context files.
export function createFixtureAuthSocketDocker(files,runId){
 assert(authSocketCommandAllowed(runId,['info','--format','{{.ID}}']),'Owned socket run required');
 return originalDocker(files,{PATH:'/usr/bin:/bin',HOME:'/dev/null',DOCKER_CONFIG:'/dev/null'},'/usr/bin/docker',args=>authSocketCommandAllowed(runId,args));
}
function originalDocker(files,env,binary,admission){
 const environment={...env};delete environment.DOCKER_HOST;delete environment.DOCKER_CONTEXT;
 const owner=createFixtureCommandOwner(files,environment,binary,'Docker');let host,sequence=0,pending=0,unknown=false,tail=Promise.resolve();
 const issue=(args,timeout=10000,maxBuffer=20_000_000,input)=>{
  const name='docker-'+sequence++;pending++;
  const result=tail.then(async()=>{assert(!unknown,'Original Docker output unknown; retain resources');const value=await owner.run(name,args,true,timeout,input);if(Buffer.byteLength(value.stdout)+Buffer.byteLength(value.stderr)>maxBuffer){unknown=true;throw Error('Original Docker caller output bound; retain resources');}return value;});tail=result.then(()=>{},()=>{});
  return result.finally(()=>{pending--;});
 };
 const allowed=args=>['info','logs','ps','inspect'].includes(args[0])||({network:['ls','inspect','create','rm'],image:['inspect'],container:['ls','inspect','create','rm','start','wait'],volume:['ls']}[args[0]]??[]).includes(args[1]);
 return Object.freeze({
  async context(){assert(!admission,'Socket profile requires explicit original local target');assert(host===undefined,'Docker target already bound');return(await issue(['context','inspect','--format','{{.Endpoints.docker.Host}}'],10000,4096)).stdout.trim();},
  bind(value){assert(host===undefined&&pending===0,'Original Docker target is once-only');host=localDockerTarget(value);},
  /**
   * @param {string[]} args
   * @param {{timeout?:number,maxBuffer?:number,input?:Uint8Array,maxInputBytes?:number}} options
   */
  async run(args,{timeout=10000,maxBuffer=1048576,input,maxInputBytes=commandInputLimit}={}){
   assert(host&&Array.isArray(args)&&args.every(x=>typeof x==='string'),'Bound fixed Docker command required');
   const copy=args.length===3&&args[0]==='cp'&&(args[1]==='-'&&/^[a-f0-9]{64}:\/$/.test(args[2])&&input!==undefined||/^[a-f0-9]{64}:\/owned-input\.txt$/.test(args[1])&&args[2]==='-'&&input===undefined);
   const serviceControl=args[0]==='container'&&(args.length===4&&args[1]==='stop'&&args[2]==='--timeout=-1'&&/^[a-f0-9]{64}$/.test(args[3])||args[1]==='exec'&&/^[a-f0-9]{64}$/.test(args[2])&&(args.length===6&&args[3]==='/bin/sh'&&args[4]==='-ec'&&[fixtureServiceReady,fixturePostgresReady,fixturePostgresRead,fixturePostgresBootstrapInspection,fixturePostgresBootstrapSources,fixturePostgresAuthBaseApply,fixturePostgresAuthBaseRead,fixturePostgresVaultApply,fixturePostgresVaultRead,fixturePostgresMigrationSources,fixturePostgresVaultInspection,fixturePostgresVaultPrerequisites,fixtureInspectionPublicFailure,fixtureInspectionPublicBuild,fixtureInspectionPublicLayout,fixtureInspectionPublicSources].includes(args[5])||args.length===5&&args[3]==='/mailpit'&&args[4]==='readyz'));
   assert(admission?input===undefined&&admission(args):allowed(args)&&input===undefined||copy||serviceControl&&input===undefined,'Bound fixed Docker command required');
   assert(Number.isSafeInteger(maxBuffer)&&maxBuffer>0&&maxBuffer<=20_000_000,'Invalid Docker output bound');
   assert(Number.isSafeInteger(maxInputBytes)&&maxInputBytes>=0&&maxInputBytes<=commandInputLimit,'Invalid Docker input bound');
   const stdin=input===undefined?undefined:snapshotCommandInput(input,maxInputBytes);return issue(['--host',host,...args],timeout,maxBuffer,stdin);
  },
  failure:error=>owner.failure(error),
  async fence(){assert(!unknown,'Original Docker output unknown; retain resources');assert.equal(pending,0,'Original Docker commands pending; retain resources');await owner.fence();},
  async inventory(){const value=await owner.inventory();return Object.freeze({...value,pending,unknown:unknown||value.unknown});}
 });
}
