import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {baseline} from './tools.mjs';
import {createCommandProcess} from './native-process.mjs';
import {snapshotCommandInput} from './command-input.mjs';
const require=createRequire(import.meta.url),retained=new Set();
export function fixtureCliBinary(){
  assert(process.platform==='linux','Original CLI creating owner requires Linux');
  const metadata=require.resolve(`@supabase/cli-${process.platform}-${process.arch}/package.json`);
  assert.equal(JSON.parse(readFileSync(metadata,'utf8')).version,baseline.supabaseCli,'Installed CLI package drift');
  const binary=resolve(dirname(metadata),'bin/supabase');assert(lstatSync(binary).isFile(),'Official CLI frontend missing');return binary;
}
// Direct official native frontend, not the npm Node signal-forwarding wrapper or Go fallback.
// Captures the direct command's original process only; Docker descendants/containers remain incomplete.
export function createFixtureCli(files,env,binary=fixtureCliBinary()){
  const owner=createFixtureCommandOwner(files,env,binary);
  return Object.freeze({...owner,async run(name,args){
    assert(['version','start','status','stop'].includes(name)&&Array.isArray(args)&&args[0]===(name==='version'?'--version':name),'Fixed fixture CLI command required');
    const memoryOutput=name==='start'||name==='status';
    return owner.run(name,args,memoryOutput);
  }});
}
// Connect actual h status to an owned child boundary, not label/name-derived service adoption.
// Other original CLI commands are unchanged and remain unqualified for descendant custody.
export async function createFixtureFrontendCli(files,env,binary=fixtureCliBinary()){
  const boundary=await files.frontendInventoryBoundary(),inventoryEnv={...env,PATH:boundary.path,DOCKER_HOST:boundary.host};delete inventoryEnv.DOCKER_CONTEXT;
  const normal=createFixtureCli(files,env,binary),status=createFixtureCli(files,inventoryEnv,binary);let busy=false,refusalObserved=false;
  const fence=async()=>{assert(!busy,'Original frontend CLI command pending');await normal.fence();await status.fence();};
  return Object.freeze({fence,async run(name,args){await fence();assert(!busy,'Original frontend CLI command pending');busy=true;try{return await(name==='status'?status:normal).run(name,args);}catch(e){if(name==='status'&&typeof e.stderr==='string'&&e.stderr.includes('ORIGINAL_FRONTEND_CREATE_HANDOFF_REQUIRED'))refusalObserved=true;throw e;}finally{busy=false;}},
    async inventory(){const a=await normal.inventory(),b=await status.inventory();return Object.freeze({complete:false,unknown:a.unknown||b.unknown,commands:Object.freeze([...a.commands,...b.commands]),frontendInventory:Object.freeze({complete:false,originalCreateHandoff:false,refusalObserved})});}
  });
}
// Shared fixture-only original command mechanism, not a backend abstraction/public SDK API.
export function createFixtureCommandOwner(files,env,binary,label='CLI'){
  const records=[],failures=new WeakMap(),environment={...env};let busy=false;
  const unknown=()=>records.some(r=>r.unknown);
  const fence=async()=>{assert(!busy&&!unknown()&&records.every(r=>r.joined&&r.sealed),`Original ${label} unsettled; retain resources/data/lock`);};
  async function run(name,args,memoryOutput=false,timeoutMs=baseline.startupTimeoutMs,input){
    const stdin=input===undefined?undefined:snapshotCommandInput(input);
    assert(typeof name==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(name)&&Array.isArray(args)&&args.every(x=>typeof x==='string'),'Fixed fixture command required');
    assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=baseline.startupTimeoutMs,'Invalid fixture command deadline');
    assert(!busy&&!unknown()&&!records.some(r=>r.name===name),`Original ${label} unavailable/once-only; retain resources`);
    busy=true;const record={name,owner:null,stdout:null,stderr:null,joined:false,sealed:false,unknown:false};records.push(record);retained.add(record);
    let timer;
    const deadline=new Promise((_,no)=>{timer=setTimeout(()=>{record.unknown=true;no(Error(`Original ${label} wait deadline; owner retained`));},timeoutMs);});
    const operation=(async()=>{
      record.stdout=await files.openLog(name+'.log');record.stderr=await files.openLog(name+'.stderr.log');
      record.owner=createCommandProcess(binary,args,{env:environment,logFd:record.stdout.fd,stderrFd:record.stderr.fd,memoryOutput,...(stdin===undefined?{}:{input:stdin})});
      await record.owner.start(()=>files.admit());await record.owner.join();
      const value=record.owner.inventory();assert(value.joined&&!value.unknown&&value.terminal&&!record.unknown,`Original ${label} wait/EOF unconfirmed`);record.joined=true;
      if(stdin!==undefined){const receipt=record.owner.inputResult();assert(receipt.complete&&receipt.bytesWritten===stdin.length,'Original command input incomplete; retain resources/data/lock');}
      await record.stdout.close();await record.stderr.close();
      const output=memoryOutput?record.owner.output():{stdout:await record.stdout.read(),stderr:await record.stderr.read()};
      const stdout=new TextDecoder('utf-8',{fatal:true}).decode(output.stdout);
      const stderr=new TextDecoder('utf-8',{fatal:true}).decode(output.stderr);record.sealed=true;
      if(record.owner.exitCode!==0||record.owner.signalCode!==null){
        const failure=Object.freeze({name,code:record.owner.exitCode,signal:record.owner.signalCode,stdout,stderr,joined:true,sealed:true});
        const error=Object.assign(Error(`Original fixture ${label} command failed`),{code:failure.code,signal:failure.signal,stdout,stderr});failures.set(error,failure);throw error;
      }
      return{stdout,stderr};
    })();
    // A late join after deadline cannot convert uncertainty into release. No implicit STOP or replay.
    record.operation=operation;operation.catch(()=>{});
    try{return await Promise.race([operation,deadline]);}
    catch(error){if(!record.joined||!record.sealed)record.unknown=true;throw error;}
    finally{clearTimeout(timer);busy=false;if(!record.unknown)retained.delete(record);}
  }
  return Object.freeze({run,fence,failure:error=>failures.get(error)??null,inventory:async()=>Object.freeze({complete:false,unknown:unknown(),commands:Object.freeze(records.map(r=>Object.freeze({name:r.name,pid:r.owner?.pid??null,joined:r.joined,sealed:r.sealed,unknown:r.unknown})))})});
}
