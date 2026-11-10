import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {mkdir,open,lstat,rm} from 'node:fs/promises';
import {dirname,basename,isAbsolute} from 'node:path';
const retained=new Set();
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const directoryFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
// Inventory cannot adopt frontend label/name discoveries before original create handoff exists.
// No argv/env reads, daemon dispatch, subprocess or successful Docker response in this fixed leaf.
const frontendRefusal='#!/usr/bin/python3.12 -IBS\nimport os\nos.write(2,b"ORIGINAL_FRONTEND_CREATE_HANDOFF_REQUIRED\\n")\nos._exit(78)\n';
// Original descriptors, not a directory/owner JSON recovery constructor. Linux fixture only.
export async function createFixtureFiles(directory,initialOwner){
  assert(process.platform==='linux'&&isAbsolute(directory)&&basename(directory)!=='.','Original fixture directory required');
  const parentPath=dirname(directory),name=basename(directory),state={parent:null,dir:null,owner:null,logs:new Map(),frontend:null,unknown:false,closed:false,durable:false};
  let made=false,leafAttempted=false,busy=false,expected;
  const hold=error=>{state.failure??=error;state.unknown=true;return new Error('Original fixture files unknown; retain originals/data/lock',{cause:error});};
  const anchor=()=>`/proc/self/fd/${state.dir.fd}`;
  const child=name=>`${anchor()}/${name}`;
  retained.add(state); // Retain uncertainty even before a leaf acknowledgement; never lose the creator.
  try{
    await mkdir(parentPath,{recursive:true,mode:0o700});state.parent=await open(parentPath,directoryFlags);
    leafAttempted=true;await mkdir(`/proc/self/fd/${state.parent.fd}/${name}`,{mode:0o700});made=true;
    state.dir=await open(`/proc/self/fd/${state.parent.fd}/${name}`,directoryFlags);
    state.owner=await open(child('owner.json'),constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    expected=JSON.stringify(initialOwner);assert(typeof expected==='string'&&Buffer.byteLength(expected)<=65536,'Bounded owner record required');
    await writeOwnerBytes(expected);await state.dir.sync();await state.parent.sync();state.durable=true;
    await verify();
  }catch(error){
    if(leafAttempted&&!made&&error.code==='EEXIST'){
      try{await state.parent.close();}catch(closeError){hold(closeError);}
      if(!state.unknown){retained.delete(state);throw error;} // Definite noncreation, never adoption.
    }else hold(error);
    // Return only a retaining/refusing handle, NOT successful creation. Actual createHarness must
    // remain available to its original finalizer: start/cleanup refuse, so absence cannot erase a lock.
  }
  async function file(f,name,mode=0o600n){
    const own=await f.stat({bigint:true}),entry=await lstat(child(name),{bigint:true});
    assert(own.isFile()&&entry.isFile()&&same(own,entry)&&own.nlink===1n&&(own.mode&0o777n)===mode,'Original file identity/link/mode drift');
  }
  async function verify(){
    const parent=await state.parent.stat({bigint:true}),parentEntry=await lstat(parentPath,{bigint:true});
    const dir=await state.dir.stat({bigint:true}),entry=await lstat(directory,{bigint:true});
    assert(parentEntry.isDirectory()&&same(parent,parentEntry)&&entry.isDirectory()&&same(dir,entry)&&(dir.mode&0o777n)===0o700n,'Original directory identity/mode drift');
    await file(state.owner,'owner.json');
    const stat=await state.owner.stat();assert(stat.size===Buffer.byteLength(expected)&&stat.size<=65536,'Original owner size drift');
    const bytes=Buffer.alloc(stat.size);let offset=0;
    while(offset<bytes.length){const {bytesRead}=await state.owner.read(bytes,offset,bytes.length-offset,offset);assert(bytesRead>0,'Partial original owner');offset+=bytesRead;}
    assert(bytes.equals(Buffer.from(expected)),'Original owner bytes drift');
    for(const [name,log] of state.logs)await file(log.handle,name);
    if(state.frontend){
      const b=state.frontend,s=await b.dir.stat({bigint:true}),p=await lstat(child('frontend-bin'),{bigint:true});assert(b.durable&&p.isDirectory()&&same(s,p)&&(s.mode&0o777n)===0o700n,'Original frontend directory drift');
      for(const [name,record]of b.files){assert(!record.writer&&record.reader,'Original frontend executable handoff incomplete');const f=record.reader;await file(f,'frontend-bin/'+name,0o700n);assert.equal((await f.stat()).size,Buffer.byteLength(frontendRefusal),'Original frontend payload size drift');const bytes=Buffer.alloc(Buffer.byteLength(frontendRefusal));let offset=0;while(offset<bytes.length){const r=await f.read(bytes,offset,bytes.length-offset,offset);assert(r.bytesRead>0,'Partial original frontend payload');offset+=r.bytesRead;}assert(bytes.equals(Buffer.from(frontendRefusal)),'Original frontend payload drift');}
      assert.equal(b.files.size,2,'Original frontend executables incomplete');try{await lstat(child('frontend-bin/no-daemon.sock'));assert.fail('Unexpected frontend daemon endpoint');}catch(e){assert.equal(e.code,'ENOENT','Original frontend absence drift');}
    }
    assert(state.durable,'Original file durability unconfirmed');
  }
  async function writeOwnerBytes(value){
    const bytes=Buffer.from(value);let offset=0;
    while(offset<bytes.length){const {bytesWritten}=await state.owner.write(bytes,offset,bytes.length-offset,offset);assert(bytesWritten>0,'Partial original owner write');offset+=bytesWritten;}
    await state.owner.truncate(bytes.length);await state.owner.sync();
  }
  async function operate(fn){
    if(state.closed||state.unknown)throw Error('Original fixture file owner unavailable; retain resources',{cause:state.failure});
    if(busy)throw hold(Error('Concurrent original file operation'));
    busy=true;
    try{const result=await fn();if(state.unknown)throw Error('Original file outcome became unknown');return result;}
    catch(error){throw hold(error);}finally{busy=false;}
  }
  const admit=()=>operate(verify);
  return Object.freeze({
    get closed(){return state.closed;},admit,
    frontendInventoryBoundary:()=>operate(async()=>{
      await verify();assert(!state.frontend,'Original frontend boundary is once-only');await mkdir(child('frontend-bin'),{mode:0o700});
      const b=state.frontend={dir:await open(child('frontend-bin'),directoryFlags),files:new Map(),durable:false};
      for(const name of ['docker','podman']){
        const f=await open(`/proc/self/fd/${b.dir.fd}/${name}`,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o700),record={writer:f,reader:null};b.files.set(name,record);await f.writeFile(frontendRefusal);await f.sync();
        // Linux refuses exec while a writable description remains open (ETXTBSY). Transfer
        // through the ORIGINAL writer descriptor, never reopen/adopt an executable by name.
        record.reader=await open(`/proc/self/fd/${f.fd}`,constants.O_RDONLY);assert(same(await f.stat({bigint:true}),await record.reader.stat({bigint:true})),'Original frontend descriptor handoff drift');await f.close();record.writer=null;
      }
      await b.dir.sync();await state.dir.sync();b.durable=true;await verify();return Object.freeze({path:directory+'/frontend-bin',host:'unix://'+directory+'/frontend-bin/no-daemon.sock'});
    }),
    readOwner:async()=>{await admit();return JSON.parse(expected);},
    writeOwner:value=>operate(async()=>{
      await verify();const next=JSON.stringify(value);assert(typeof next==='string'&&Buffer.byteLength(next)<=65536,'Bounded owner record required');
      state.durable=false;await writeOwnerBytes(next);expected=next;await state.dir.sync();state.durable=true;await verify();
    }),
    openLog:(name,append=false)=>operate(async()=>{
      assert(typeof name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.log$/.test(name),'Fixed fixture log name required');await verify();
      let log=state.logs.get(name);
      if(log){assert(append&&log.sealed,'Original log lease still active or once-only');}
      else{
        const handle=await open(child(name),constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_APPEND,0o600);
        log={handle,sealed:true};state.logs.set(name,log);await handle.sync();await state.dir.sync();await file(handle,name);
      }
      log.sealed=false;let sealing;
      return Object.freeze({fd:log.handle.fd,
        close:()=>sealing??=operate(async()=>{await verify();await log.handle.sync();await file(log.handle,name);log.sealed=true;}),
        read:()=>operate(async()=>{
          await verify();assert(log.sealed,'Original log lease not sealed');const stat=await log.handle.stat();assert(stat.size<=20000000,'Original command log read bound');
          const bytes=Buffer.alloc(stat.size);let offset=0;
          while(offset<bytes.length){const {bytesRead}=await log.handle.read(bytes,offset,bytes.length-offset,offset);assert(bytesRead>0,'Partial original command log');offset+=bytesRead;}
          await verify();return bytes;
        })});
    }),
    inventory:async()=>{
      if(!state.closed&&!state.unknown)try{await admit();}catch{}
      return Object.freeze({complete:false,closed:state.closed,unknown:state.unknown,ownerDurable:state.durable,frontendInventoryBoundary:Object.freeze({complete:false,installed:Boolean(state.frontend?.durable)}),logs:Object.freeze([...state.logs].map(([name,log])=>Object.freeze({name,sealed:log.sealed})))});
    },
    removeData:()=>operate(async()=>{
      await verify();assert([...state.logs.values()].every(log=>log.sealed),'Original log leases not sealed');
      // A fresh failed flush must stop BEFORE destructive effects, not first be discovered after rm.
      await state.owner.sync();for(const log of state.logs.values())await log.handle.sync();await state.dir.sync();
      // Existing harness deletion list only, anchored to the ORIGINAL directory FH throughout each rm.
      for(const [name,recursive] of [['traildepot',true],['context.json',false],['sdk-package',true],['private-g1-upgrade-fixture.json',false]]){
        assert(!state.unknown,'Original file outcome unknown');await rm(child(name),{recursive,force:true});
      }
      await state.dir.sync();await verify();
    }),
    close:()=>operate(async()=>{
      await verify();assert([...state.logs.values()].every(log=>log.sealed),'Original log leases not sealed');
      // Owner writes and sealed leases already flushed; no new write/flush after the deletion fence.
      for(const log of state.logs.values())await log.handle.close();
      if(state.frontend){for(const f of state.frontend.files.values())await f.reader.close();await state.frontend.dir.close();}
      await state.owner.close();await state.dir.close();await state.parent.close();state.closed=true;retained.delete(state);
    }),
  });
}
