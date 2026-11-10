import {expect,it} from 'vitest';
import {mkdtemp,open,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import * as native from '../../scripts/native-process.mjs';
import {createFixtureFiles} from '../../scripts/fixture-files.mjs';
import {createFixtureCli} from '../../scripts/fixture-cli.mjs';
import {baseline} from '../../scripts/tools.mjs';
it('L1-27/U27 actual command process joins original output EOF/wait and retains complete distinct stdout/stderr with no inherited log FDs',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'cli-split-process-')),out=await open(join(root,'stdout.log'),'wx',0o600),err=await open(join(root,'stderr.log'),'wx',0o600);let actor:any;
 try{
  const create=Reflect.get(native,'createCommandProcess');expect(typeof create).toBe('function');
  actor=create('/usr/bin/python3',['-I','-B','-S','-c','import os\nfor f in (3,4):\n try: os.fstat(f)\n except OSError: pass\n else: raise AssertionError("Inherited command log")\nos.write(1,b"x"*262144)\nos.write(2,b"y"*262144)\nraise SystemExit(17)'],{env:{PATH:'/usr/bin:/bin'},logFd:out.fd,stderrFd:err.fd});await actor.start();await actor.join();expect(actor.exitCode).toBe(17);expect(actor.inventory()).toMatchObject({joined:true,terminal:true,unknown:false});await out.sync();await err.sync();expect(await readFile(join(root,'stdout.log'))).toEqual(Buffer.alloc(262144,120));expect(await readFile(join(root,'stderr.log'))).toEqual(Buffer.alloc(262144,121));
 }finally{if(actor){await actor.stop();expect(actor.inventory().joined&&!actor.inventory().unknown).toBe(true);}await out.close();await err.close();await rm(root,{recursive:true});}
});
it('L1-27/U27 actual memory-only command output over 64KiB remains distinct/exact without writing privileged log bytes',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'cli-memory-process-')),out=await open(join(root,'stdout.log'),'wx',0o600),err=await open(join(root,'stderr.log'),'wx',0o600);let actor:any;
 try{
  actor=Reflect.get(native,'createCommandProcess')('/usr/bin/python3',['-I','-B','-S','-c','import os\nos.write(1,b"x"*262144)\nos.write(2,b"y"*262144)'],{env:{PATH:'/usr/bin:/bin'},logFd:out.fd,stderrFd:err.fd,memoryOutput:true});await actor.start();await actor.join();expect(actor.output()).toEqual({stdout:Buffer.alloc(262144,120),stderr:Buffer.alloc(262144,121)});expect(await readFile(join(root,'stdout.log'))).toHaveLength(0);expect(await readFile(join(root,'stderr.log'))).toHaveLength(0);
 }finally{if(actor){await actor.stop();expect(actor.inventory().joined&&!actor.inventory().unknown).toBe(true);}await out.close();await err.close();await rm(root,{recursive:true});}
});
it('L1-27/U27 actual official installed native CLI frontend version via retained command owner, no Docker/backend',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'cli-official-version-'));const files=await createFixtureFiles(join(root,'run'),{id:'owned'});
 // Actual command owns its original helper/FDs; teardown allowed only after known original command fence.
 const c=createFixtureCli(files,{...process.env});const result=await c.run('version',['--version']);expect(result.stdout.trim()).toBe(baseline.supabaseCli);await c.fence();expect((await c.inventory()).commands).toEqual([expect.objectContaining({name:'version',joined:true,sealed:true,unknown:false})]);await files.close();await rm(root,{recursive:true});
});
