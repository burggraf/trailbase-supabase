import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixturePostgresReady} from './fixture-postgres-config.mjs';
import {fixtureCreationSteps} from './fixture-container.mjs';
import {fixturePostgresVaultApply,fixturePostgresVaultRead,fixturePostgresVaultExpected} from './fixture-postgres-bootstrap.mjs';
export const fixtureInspectionPublicFailure="printf 'PUBLIC_INSPECTION_FAILURE_STDOUT\\n'; printf 'PUBLIC_INSPECTION_FAILURE_STDERR\\n' >&2; exit 23";
export const fixtureInspectionPublicBuild='pg_config --version';
export const fixtureInspectionPublicLayout=`export LC_ALL=C
printf 'PUBLIC_EXTENSION_LAYOUT_V1\\n'
for t in wc tr sha256sum cut; do if ! command -v "$t" >/dev/null; then printf 'PUBLIC_EXTENSION_LOOKUP_ERROR required-public-tool-unavailable\\n' >&2; exit 44; fi; done
n=0
for f in /usr/share/postgresql/extension/supabase_vault*.sql /usr/share/postgresql/extension/pgsodium*.sql /usr/share/postgresql/extension/supabase_vault.control /usr/share/postgresql/extension/pgsodium.control; do
 if test -f "$f"; then printf '%s\\t' "$f"; wc -c < "$f" | tr -d ' \\n'; printf '\\t'; sha256sum "$f" | cut -d ' ' -f 1; n=$((n+1)); fi
done
if test "$n" -eq 0; then printf 'PUBLIC_EXTENSION_LOOKUP_ERROR no-public-extension-files\\n' >&2; exit 44; fi`;
const sourcePath=/^\/usr\/share\/postgresql\/extension\/(?:supabase_vault|pgsodium)(?:\.control|--[0-9][0-9.-]*\.sql)$/;
// Fixed public files observed on the pinned image, proc_da5b; no caller paths or manifest option.
const publicSourceFiles=Object.freeze(`supabase_vault--0.2.8--0.3.0.sql\t4092\t18bf044dbd51bb919a53c8602383051a8407dafce70a8b7c898cac691cc0f0e3
supabase_vault--0.2.8.sql\t2440\t1603a151c9cf7da411a95c249b3250d921b05da6283cdca4f54e69bedbb5d701
supabase_vault--0.3.0--0.3.1.sql\t27\tc601f01c7d384054536fafd5ebd5d570542360bdcf2f14bfafd4876aaa5d174a
supabase_vault--0.3.0.sql\t3676\tc3739f80d19e1fc18d114705a07ed9fc7c8e3750762abe51f8e9999716fdaff6
pgsodium--1.0.0--1.1.0.sql\t6275\t24234ee9213c1ce059febe6cf3eadc695d79f158f125420b0b4fffdf26acd302
pgsodium--1.0.0.sql\t4606\t49af64ce54bda4411ba7c6144edef598c94625be4238868b6bc6a5ca34b0cc29
pgsodium--1.1.0--1.1.1.sql\t59\t5f15b087b6c9c1df361fca68dd5a2b3df7b6f047b421ea7c657b2ecce0044199
pgsodium--1.1.1--1.2.0.sql\t6731\t162aa777fcabc1e139e4ec62f9ceb16055f4aab34bee3ac8479f74fbf5664af4
pgsodium--1.2.0--2.0.0.sql\t7076\t3483e7c517737feb06969833a3b181d828a1d3744b342702c258a469f8eaa12a
pgsodium--2.0.0--2.0.1.sql\t0\te3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
pgsodium--2.0.1--2.0.2.sql\t0\te3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
pgsodium--2.0.2--3.0.0.sql\t15979\t9e0ec1c696cc0aca25db9976983e46521dfe7e05e3f0ebdb6d6b714257fe50e3
pgsodium--3.0.0--3.0.2.sql\t265\t4b26131f03771f4ea5f2084adbc77888f17563c0d70f82725a83496647de2a35
pgsodium--3.0.2--3.0.3.sql\t150\t68664694af0577d7cae25281473516aa25cd4ab8a0c0365db425b90ac95d0c8d
pgsodium--3.0.3--3.0.4.sql\t2434\t998a7c3fbcf181014401c545aa9e7cab3824d4ab06858e631f58e527e591d7bd
pgsodium--3.0.4--3.0.5.sql\t28466\t9ad246eaaf29469c30ee358f0ecca56a032b4f9044fbcb22cbb115ebccbbb02c
pgsodium--3.0.5--3.0.6.sql\t2689\t455cb09cedeefe8023a5141c0eb8de640ca8081f8d248c91a761c4da90b4912a
pgsodium--3.0.6--3.0.7.sql\t5239\t9910e2db43674ad169032f214465d5a155c5a89cc38ceebb75cf871acedb8b6e
pgsodium--3.0.7--3.1.0.sql\t17568\t4ad1280144cd35adb1e0b08073157b807f8f90e0e3b77018f9968c6206ec10df
pgsodium--3.1.0--3.1.1.sql\t4542\te96a5f82866e5b1463d9026b6f28bdebbb7844e67679277658dde7515d22c5bc
pgsodium--3.1.1--3.1.2.sql\t223\t8ef5e701747933b58a51d982cf6e9dade46b6235ad4c9bd9a271fcefb5b470fc
pgsodium--3.1.2--3.1.3.sql\t364\t57fe2906ad0091da314488bdd8fcbaeceef8bd8c9b7dfcd868a13dfc95e4007b
pgsodium--3.1.3--3.1.4.sql\t96\t1c869a3a0c09812f9710541a77def789b4ca2a5c67a9f6d6b276ad9e668f5fb5
pgsodium--3.1.4--3.1.5.sql\t2655\t3441d3c1b1c58bab625e3a2fc60a5676bdf10a75129e4f2dd16fef9bd8ff746e
pgsodium--3.1.5--3.1.6.sql\t2655\t3441d3c1b1c58bab625e3a2fc60a5676bdf10a75129e4f2dd16fef9bd8ff746e
pgsodium--3.1.6--3.1.7.sql\t5185\t081e4e95c4a1898f9a3595b8d18abc4b995c373d079afc032bf94f5575127484
pgsodium--3.1.7--3.1.8.sql\t812\t5c3da58bfe43fca1c0a2fa93bc5af5923735939876952780a81c7a2e6dbaeebc
supabase_vault.control\t141\tdfb755bbdc9db9b49d6084697289aa197de1099b7af649ee610774a5e680215b
pgsodium.control\t140\t7d8c9fe5d81a6ea14662fedf85b674b6560f9c6f165ae4110a94a25c47054535`.split('\n').map(line=>{const[name,bytes,sha256]=line.split('\t');return Object.freeze({path:'/usr/share/postgresql/extension/'+name,bytes:Number(bytes),sha256});}));
assert(publicSourceFiles.every(f=>sourcePath.test(f.path)&&/^[a-f0-9]{64}$/.test(f.sha256)),'Fixed public source manifest required');
export const fixtureInspectionPublicSources=`export LC_ALL=C
printf 'PUBLIC_EXTENSION_SOURCES_V1\\n'
for t in base64 sha256sum; do if ! command -v "$t" >/dev/null; then printf 'PUBLIC_EXTENSION_LOOKUP_ERROR required-public-tool-unavailable\\n' >&2; exit 44; fi; done
for f in ${publicSourceFiles.map(f=>f.path).join(' ')}; do if ! test -r "$f"; then printf 'PUBLIC_EXTENSION_LOOKUP_ERROR expected-source-unreadable\\n' >&2; exit 46; fi; done
if ! sha256sum -c >/dev/null 2>/dev/null <<'PUBLIC_EXTENSION_SHA256'
${publicSourceFiles.map(f=>f.sha256+'  '+f.path).join('\n')}
PUBLIC_EXTENSION_SHA256
then printf 'PUBLIC_EXTENSION_LOOKUP_ERROR expected-source-identity-mismatch\\n' >&2; exit 45; fi
for f in ${publicSourceFiles.map(f=>f.path).join(' ')}; do
 printf 'PUBLIC_EXTENSION_FILE %s\\n' "$f"
 if ! base64 "$f"; then printf 'PUBLIC_EXTENSION_LOOKUP_ERROR expected-source-read-failed\\n' >&2; exit 47; fi
 printf 'PUBLIC_EXTENSION_END\\n'
done
printf 'PUBLIC_EXTENSION_SOURCES_END\\n'`;
const retained=new Set(),limit=4096,layoutLimit=32768,sourceLimit=1048576;
// Pure public-data decoder; the execution profile always uses the fixed observed manifest above.
export function decodePublicExtensionSources(text,expected){
  assert(typeof text==='string'&&Buffer.byteLength(text)<=sourceLimit&&Array.isArray(expected)&&expected.length>0&&expected.length<=256,'Bounded public sources required');
  const lines=text.split('\n'),seen=new Set(),result=[];let at=1;assert(lines[0]==='PUBLIC_EXTENSION_SOURCES_V1','Public sources header required');
  for(const f of expected){
    assert(sourcePath.test(f.path)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=sourceLimit&&/^[a-f0-9]{64}$/.test(f.sha256)&&!seen.has(f.path),'Fixed public source identity required');seen.add(f.path);
    assert(lines[at++]==='PUBLIC_EXTENSION_FILE '+f.path,'Public source order required');let encoded='';
    while(at<lines.length&&lines[at]!=='PUBLIC_EXTENSION_END'){assert(/^[A-Za-z0-9+/]+={0,2}$/.test(lines[at]),'Public source encoding required');encoded+=lines[at++];}
    assert(lines[at++]==='PUBLIC_EXTENSION_END','Complete public source required');const bytes=Buffer.from(encoded,'base64');
    assert(bytes.toString('base64')===encoded&&bytes.length===f.bytes&&createHash('sha256').update(bytes).digest('hex')===f.sha256,'Public source bytes/hash required');
    result.push(Object.freeze({...f,source:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}));
  }
  assert(lines[at++]==='PUBLIC_EXTENSION_SOURCES_END'&&lines[at++]===''&&at===lines.length,'Complete public sources packet required');return Object.freeze(result);
}
function publicLayout(text){
  assert(typeof text==='string'&&Buffer.byteLength(text)<=layoutLimit,'Bounded public layout required');
  const lines=text.split('\n');assert(lines.shift()==='PUBLIC_EXTENSION_LAYOUT_V1'&&lines.pop()===''&&lines.length<=256,'Public layout framing required');
  const names=new Set();for(const line of lines){const fields=line.split('\t');assert(fields.length===3&&/^\/usr\/share\/postgresql\/extension\/(?:supabase_vault|pgsodium)(?:\.control|--[0-9][0-9.-]*\.sql)$/.test(fields[0])&&/^(0|[1-9][0-9]*)$/.test(fields[1])&&Number(fields[1])<=20_000_000&&/^[a-f0-9]{64}$/.test(fields[2])&&!names.has(fields[0]),'Fixed public layout entry required');names.add(fields[0]);}
  return lines.length;
}
// Future fresh fixtures only: these are the original owners, never IDs or discovered resources.
/** @param {{files:any,docker:any,service:any,input?:import('node:stream').Readable,output?:import('node:stream').Writable,probe?:string}} options */
export function createFixtureInspection({files,docker,service,input=process.stdin,output=process.stdout,probe='failure'}){
  assert(['failure','build','extension-layout','extension-sources','vault-create'].includes(probe),'Fixed public inspection required');
  const inspectLimit=probe==='extension-layout'||probe==='vault-create'?layoutLimit:probe==='extension-sources'?sourceLimit:limit;
  const initial=service.snapshot();assert(initial.phase==='new'&&!initial.busy&&!initial.started&&!files.closed,'Fresh original inspection owners required');
  const state={phase:'prepared',stage:'prepared',reason:null,failure:null,owners:{files,docker,service},controlEof:false,disposed:false,disposition:null,publicSource:null};
  let attempted=false,disposing=false,buffer='',overflow=false,resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  // Capture only the original creator's cached getter; status never queries owners/resources.
  const creationStep=Object.getOwnPropertyDescriptor(service,'creationStep')?.get;
  const status=()=>{const step=creationStep?.();return Object.freeze({phase:state.phase,stage:state.stage,reason:state.reason,failure:state.failure,controlEof:state.controlEof,disposed:state.disposed,disposition:state.disposition,...(fixtureCreationSteps.includes(step)?{creationStep:step}:{}),...(state.publicSource?{publicSource:state.publicSource}:{})});};
  const hold=reason=>{if(state.phase!=='closed'&&state.phase!=='retained'){state.phase='retained';state.reason=reason;}return status();};
  retained.add(state);const keeper=setInterval(()=>{void state.phase;},60000);
  const reply=value=>{try{output.write(JSON.stringify(value)+'\n');}catch{hold('control-output-lost');}};
  const outputLost=()=>{hold('control-output-lost');};
  const ended=()=>{state.controlEof=true;buffer='';overflow=false;};
  async function dispatch(action){
    if(!['status','run','dispose'].includes(action)){reply({action:'refused',refused:true});return;}
    try{const value=action==='status'?status():await(action==='run'?run():dispose());reply({action,...value});}
    catch{reply({action,refused:true,...status()});}
  }
  const data=chunk=>{for(const ch of chunk.toString('utf8')){if(ch==='\n'){const action=overflow?'':buffer;buffer='';overflow=false;void dispatch(action);}else if(!overflow){if(buffer.length===32){buffer='';overflow=true;}else buffer+=ch;}}};
  // Register the actual control and retaining lifetime BEFORE run can launch any command.
  input.on('data',data);input.on('end',ended);input.on('error',ended);output.on('error',outputLost);
  async function fence(){
    await docker.fence();await files.admit();const s=service.snapshot();
    assert(s.phase==='owned'&&!s.busy&&s.started&&!s.waited,'Original inspection ownership unconfirmed');
  }
  async function run(){
    assert(state.phase==='prepared'&&!state.controlEof,'Original inspection run once-only/control unavailable');state.phase='running';
    try{
      state.stage='context';docker.bind(await docker.context());
      assert(state.phase==='running','Original inspection control lost');state.stage='create';await service.create();
      assert(state.phase==='running','Original inspection control lost');state.stage='start';await service.start();
      assert(state.phase==='running','Original inspection control lost');state.stage='ready';const ready=await docker.run(['container','exec',service.id,'/bin/sh','-ec',fixturePostgresReady],{maxBuffer:limit});
      if(probe==='vault-create'){
        try{
          const lines=ready.stdout.trimEnd().split('\n');assert.equal(lines.length,5);assert.deepEqual(lines.slice(0,4),['100','101','100:101:700','100:101:700']);const observed=JSON.parse(lines[4]);
          assert(typeof observed.systemIdentifier==='string'&&/^[1-9]\d{0,19}$/.test(observed.systemIdentifier),'Original store identity required');
          assert.deepEqual({...observed,systemIdentifier:null},{marker:'owned-postgres-sql-ready',user:'supabase_admin',database:'postgres',directory:'/tmp/owned-postgres/data',version:170011,listen:'',recovery:false,value:42,systemIdentifier:null});
        }catch{await fence();assert(state.phase==='running','Original inspection control lost');state.failure=Object.freeze({stage:state.stage,code:0,signal:null,joined:true,sealed:true,outputPolicy:'not-admitted',verification:'vault-readiness-mismatch'});state.phase='failed-known';return status();}
        await fence();assert(state.phase==='running','Original inspection control lost');const log=await files.openLog('inspection-readiness.log');writeFileSync(log.fd,ready.stdout);await log.close();await files.admit();
      }
      assert(state.phase==='running','Original inspection control lost');state.stage='inspect';let value=await docker.run(['container','exec',service.id,'/bin/sh','-ec',probe==='failure'?fixtureInspectionPublicFailure:probe==='build'?fixtureInspectionPublicBuild:probe==='extension-layout'?fixtureInspectionPublicLayout:probe==='extension-sources'?fixtureInspectionPublicSources:fixturePostgresVaultApply],{maxBuffer:inspectLimit});
      if(probe==='vault-create'){
        const observations=[],diagnostics=[];
        for(let n=0;n<2;n++){
          if(n){assert(state.phase==='running','Original inspection control lost');state.stage='vault-read';value=await docker.run(['container','exec',service.id,'/bin/sh','-ec',fixturePostgresVaultRead],{maxBuffer:inspectLimit});}
          try{assert(typeof value.stderr==='string'&&Buffer.byteLength(value.stdout)+Buffer.byteLength(value.stderr)<=inspectLimit,'Bounded Vault catalog required');assert.deepEqual(JSON.parse(value.stdout),fixturePostgresVaultExpected,'Fixed Vault catalog required');}
          catch{await fence();assert(state.phase==='running','Original inspection control lost');state.failure=Object.freeze({stage:state.stage,code:0,signal:null,joined:true,sealed:true,outputPolicy:'not-admitted',verification:'vault-catalog-mismatch'});state.phase='failed-known';return status();}
          observations.push(value.stdout.trim());diagnostics.push(Object.freeze({stderrBytes:Buffer.byteLength(value.stderr),stderrSha256:createHash('sha256').update(value.stderr).digest('hex')}));
        }
        await fence();assert(state.phase==='running','Original inspection control lost');const log=await files.openLog('inspection-public.log');writeFileSync(log.fd,observations.join('\n')+'\n');await log.close();await files.admit();assert(state.phase==='running','Original inspection control lost');
        const text=observations.join('\n')+'\n';state.publicSource=Object.freeze({profile:probe,log:'inspection-public.log',files:2,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),diagnostics:Object.freeze(diagnostics)});
      }
      if(probe==='extension-layout'||probe==='extension-sources'){
        try{
          assert(value.stderr==='','Public source stderr unconfirmed');const count=probe==='extension-layout'?publicLayout(value.stdout):decodePublicExtensionSources(value.stdout,publicSourceFiles).length;assert(count>0,'Public source layout empty');
          await fence();assert(state.phase==='running','Original inspection control lost');const log=await files.openLog('inspection-public.log');assert(state.phase==='running','Original inspection control lost');
          writeFileSync(log.fd,value.stdout);await log.close();await files.admit();assert(state.phase==='running','Original inspection control lost');
          state.publicSource=Object.freeze({profile:probe,log:'inspection-public.log',files:count,bytes:Buffer.byteLength(value.stdout),sha256:createHash('sha256').update(value.stdout).digest('hex')});
        }catch{return hold('public-source-output-or-ownership-unconfirmed');}
      }
      await fence();assert(state.phase==='running','Original inspection control lost');state.phase='succeeded';return status();
    }catch(error){
      const f=docker.failure(error);
      // Preserve available original metadata even when the stage cannot authorize disposition.
      if(f?.joined&&f?.sealed)state.failure=Object.freeze({stage:state.stage,code:f.code,signal:f.signal,joined:true,sealed:true,outputPolicy:'not-admitted'});
      if(!f||!['ready','inspect','vault-read'].includes(state.stage)||!f.joined||!f.sealed)return hold('command-or-ownership-unconfirmed');
      // A signaled Docker client is NOT proof that its daemon-side exec has finished.
      if(f.signal!==null||!Number.isInteger(f.code)||f.code<1||f.code>255)return hold('command-exit-unconfirmed');
      if(typeof f.stdout!=='string'||typeof f.stderr!=='string'||Buffer.byteLength(f.stdout)+Buffer.byteLength(f.stderr)>(state.stage==='inspect'||state.stage==='vault-read'?inspectLimit:limit))return hold('command-output-unconfirmed');
      const publicOutput=state.stage==='inspect'&&probe==='failure'&&f.code===23&&f.stdout==='PUBLIC_INSPECTION_FAILURE_STDOUT\n'&&f.stderr==='PUBLIC_INSPECTION_FAILURE_STDERR\n';
      let publicSourceFailure=false;
      if(state.stage==='inspect'&&probe==='extension-layout'&&f.code===44&&['PUBLIC_EXTENSION_LOOKUP_ERROR required-public-tool-unavailable\n','PUBLIC_EXTENSION_LOOKUP_ERROR no-public-extension-files\n'].includes(f.stderr)){try{publicLayout(f.stdout);publicSourceFailure=true;}catch{}}
      if(state.stage==='inspect'&&probe==='extension-sources'&&f.stdout==='PUBLIC_EXTENSION_SOURCES_V1\n'&&({44:'required-public-tool-unavailable',45:'expected-source-identity-mismatch',46:'expected-source-unreadable',47:'expected-source-read-failed'}[f.code])&&f.stderr==='PUBLIC_EXTENSION_LOOKUP_ERROR '+({44:'required-public-tool-unavailable',45:'expected-source-identity-mismatch',46:'expected-source-unreadable',47:'expected-source-read-failed'}[f.code])+'\n')publicSourceFailure=true;
      const diagnostic=Object.freeze({stage:state.stage,code:f.code,signal:f.signal,joined:true,sealed:true,outputPolicy:publicOutput?'fixed-public-probe':publicSourceFailure?'fixed-public-source':'not-admitted',...(publicOutput||publicSourceFailure?{stdout:f.stdout,stderr:f.stderr}:{})});
      state.failure=diagnostic;
      try{
        await fence();assert(state.phase==='running','Original inspection control lost');
        const log=await files.openLog('inspection-failure.log');writeFileSync(log.fd,JSON.stringify(diagnostic)+'\n');await log.close();await files.admit();
        assert(state.phase==='running','Original inspection control lost');state.phase='failed-known';return status();
      }catch{return hold('failure-diagnostic-or-ownership-unconfirmed');}
    }
  }
  async function dispose(){
    assert(['prepared','failed-known','succeeded'].includes(state.phase)&&!attempted&&!disposing,'Original inspection disposition unavailable; retain originals');
    attempted=true;disposing=true;const unlaunched=state.phase==='prepared';let stopped,current;state.phase='disposing';
    try{
      if(unlaunched){await docker.fence();await files.admit();assert(service.snapshot().phase==='new','Original inspection creation unconfirmed');}
      else{
        await fence();assert(state.phase==='disposing','Original inspection control lost');
        stopped=await service.stopAndWait();assert.equal(stopped.exitCode,0,'Original inspection stop/wait unconfirmed');
        assert(state.phase==='disposing','Original inspection control lost');await service.remove();
        current=await service.inventory();assert.equal(current.exists,false,'Original inspection removal unconfirmed');await docker.fence();
      }
      assert(state.phase==='disposing','Original inspection control lost');await files.close();state.disposition=Object.freeze({launched:!unlaunched,stopExitCode:stopped?.exitCode??null,removedAbsent:current?.exists===false,filesClosed:files.closed});state.disposed=true;state.phase='closed';
      clearInterval(keeper);input.removeListener('data',data);input.removeListener('end',ended);input.removeListener('error',ended);input.pause();retained.delete(state);resolveDone(status());return status();
    }catch{hold('disposition-unconfirmed');throw Error('Original inspection disposition unconfirmed; retain originals');}
    finally{disposing=false;}
  }
  return Object.freeze({run,dispose,status,done});
}
