import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {join} from 'node:path';
const model=vi.hoisted(()=>({create:vi.fn(),handles:[] as any[]}));
vi.mock('../../scripts/native-process.mjs',()=>({createCommandProcess:model.create}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return{...fs,open:async(...args:Parameters<typeof fs.open>)=>{const f=await fs.open(...args);model.handles.push(f);return f;}};});
import {createFixtureCli,createFixtureCommandOwner,fixtureCliBinary} from '../../scripts/fixture-cli.mjs';
import {createFixtureFiles} from '../../scripts/fixture-files.mjs';
import {baseline} from '../../scripts/tools.mjs';
const fs=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let root:string,files:Awaited<ReturnType<typeof createFixtureFiles>>,code:number|null,signal:string|null,failJoin:boolean,hold:boolean,invalid:boolean,startError:boolean,done:()=>void,started:Promise<void>,stop:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
 vi.clearAllMocks();model.handles=[];root=await fs.mkdtemp(join(process.env.TMPDIR!,'cli-owner-unit-'));files=await createFixtureFiles(join(root,'run'),{id:'owned'});code=0;signal=null;failJoin=false;hold=false;invalid=false;startError=false;stop=vi.fn();started=new Promise(r=>{done=r;});
 model.create.mockImplementation((_file:string,_args:string[],options:any)=>({pid:711,exitCode:code,signalCode:signal,stop,
  start:async(record:(pid:number)=>Promise<void>)=>{await record(711);if(!options.memoryOutput){await model.handles.find(f=>f.fd===options.logFd).write(invalid?Buffer.from([255]):Buffer.from('{"value":7}\n'));await model.handles.find(f=>f.fd===options.stderrFd).write('separate warning\n');}done();if(startError)throw Error('Original creation acknowledgement unknown');},
  output:()=>({stdout:invalid?Buffer.from([255]):Buffer.from('{"value":7}\n'),stderr:Buffer.from('separate warning\n')}),
  join:async()=>{if(hold)await new Promise(()=>{});if(failJoin)throw Error('Original helper EOF missing');},inventory:()=>({complete:false,pid:711,terminal:!hold,joined:!hold&&!failJoin,unknown:failJoin})}));
});
afterEach(async()=>{vi.useRealTimers();for(const f of model.handles)await f.close();await fs.rm(root,{recursive:true});});
it('L1-27/U27 CLI frontend resolves installed pinned native frontend, not npm/Go/ambient override',()=>{
 vi.stubEnv('SUPABASE_CLI_BINARY_OVERRIDE','/foreign/override');try{expect(fixtureCliBinary()).toBe(join(process.cwd(),'node_modules/@supabase/cli-linux-x64/bin/supabase'));}finally{vi.unstubAllEnvs();}
});
it('L1-27/U27 original CLI keeps separate original output/log handles after joined command until final fixture cleanup',async()=>{
 const c=createFixtureCli(files,{PATH:'/usr/bin:/bin'},'/owned/cli');expect((await c.inventory()).complete).toBe(false);expect(await c.run('status',['status'])).toEqual({stdout:'{"value":7}\n',stderr:'separate warning\n'});await c.fence();
 expect(model.create.mock.calls[0][2].stderrFd).not.toBe(model.create.mock.calls[0][2].logFd);expect(stop).not.toHaveBeenCalled();expect((await c.inventory()).commands).toEqual([expect.objectContaining({name:'status',joined:true,sealed:true,unknown:false})]);expect(model.handles.every(f=>f.fd>=0)).toBe(true);await files.close();expect(model.handles.every(f=>f.fd<0)).toBe(true);
});
it.each(['nonzero','signal'])('L1-27/U27 original CLI %s remains operational failure after known join, not settlement or a retry',async kind=>{
 if(kind==='nonzero')code=7;else{code=null;signal='SIGTERM';}const c=createFixtureCli(files,{},'/owned/cli');await expect(c.run('start',['start'])).rejects.toMatchObject({code,signal,stdout:'{"value":7}\n',stderr:'separate warning\n'});await c.fence();await expect(c.run('start',['start'])).rejects.toThrow();expect(model.create).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();
});
it.each(['join','birth','utf8'])('L1-27/U27 CLI %s uncertainty is sticky and never closes logs or authorizes later commands',async kind=>{
 failJoin=kind==='join';startError=kind==='birth';invalid=kind==='utf8';const c=createFixtureCli(files,{},'/owned/cli');await expect(c.run('start',['start'])).rejects.toThrow();await expect(c.fence()).rejects.toThrow();await expect(c.run('stop',['stop'])).rejects.toThrow();expect(model.create).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();expect(model.handles.every(f=>f.fd>=0)).toBe(true);expect((await c.inventory()).unknown).toBe(true);
});
it('L1-27/U27 overlapping CLI launch refused; deadline retains original command without signal/retry/late release',async()=>{
 hold=true;const c=createFixtureCli(files,{},'/owned/cli');vi.useFakeTimers();const p=c.run('start',['start']);const rejected=expect(p).rejects.toThrow();await started;await expect(c.run('status',['status'])).rejects.toThrow();await expect(c.fence()).rejects.toThrow();await vi.advanceTimersByTimeAsync(baseline.startupTimeoutMs+1);await rejected;expect(stop).not.toHaveBeenCalled();expect(model.create).toHaveBeenCalledTimes(1);await expect(c.run('stop',['stop'])).rejects.toThrow();expect(model.handles.every(f=>f.fd>=0)).toBe(true);
});
it.each(['factory','seal'])('L1-27/U27 CLI %s failure retains originals and forbids later effects',async fault=>{
 if(fault==='factory')model.create.mockImplementationOnce(()=>{throw Error('Injected creator failure');});else{const create=model.create.getMockImplementation()!;model.create.mockImplementationOnce((...args:any[])=>{const actor=Reflect.apply(create,null,args),join=actor.join;actor.join=async()=>{await join();model.handles.find(f=>f.fd===args[2].logFd).sync=async()=>{throw Error('Injected original log fsync failure');};};return actor;});}
 const c=createFixtureCli(files,{},'/owned/cli');await expect(c.run('version',['--version'])).rejects.toThrow();await expect(c.fence()).rejects.toThrow();await expect(c.run('stop',['stop'])).rejects.toThrow();expect(stop).not.toHaveBeenCalled();expect(model.handles.every(f=>f.fd>=0)).toBe(true);expect((await c.inventory()).unknown).toBe(true);
});
it.each(['start','status'])('L1-27/U27 %s privileged output stays memory-only rather than crossing existing RR privacy boundary',async name=>{
 const c=createFixtureCli(files,{},'/owned/cli');expect(await c.run(name,[name])).toEqual({stdout:'{"value":7}\n',stderr:'separate warning\n'});expect(await fs.readFile(join(root,'run',name+'.log'))).toHaveLength(0);expect(await fs.readFile(join(root,'run',name+'.stderr.log'))).toHaveLength(0);expect(model.create.mock.calls[0][2].memoryOutput).toBe(true);
});
it('L1-27/IC01 known failure provenance belongs to this original owner, not mutable error fields or a copied receipt',async()=>{
 code=23;const c=createFixtureCommandOwner(files,{},'/owned/cli');let error:any;try{await c.run('public-failure',[],true);}catch(e){error=e;}expect(error).toBeInstanceOf(Error);const failure=Reflect.get(c,'failure');expect(typeof failure).toBe('function');const captured=failure(error);expect(captured).toEqual({name:'public-failure',code:23,signal:null,stdout:'{"value":7}\n',stderr:'separate warning\n',joined:true,sealed:true});error.stdout='PRIVATE DO NOT SERIALIZE';error.code=0;expect(failure(error)).toEqual(captured);expect(Object.isFrozen(captured)).toBe(true);expect(failure({...error})).toBeNull();expect(createFixtureCommandOwner(files,{},'/owned/other').failure(error)).toBeNull();await c.fence();await files.close();
});
it.each(['join','utf8','seal'])('L1-27/IC02 %s uncertainty never receives known-failure provenance',async kind=>{
 code=23;failJoin=kind==='join';invalid=kind==='utf8';if(kind==='seal'){const create=model.create.getMockImplementation()!;model.create.mockImplementationOnce((...args:any[])=>{const a=Reflect.apply(create,null,args),join=a.join;a.join=async()=>{await join();model.handles.find(f=>f.fd===args[2].logFd).sync=async()=>{throw Error('seal unknown');};};return a;});}const c=createFixtureCommandOwner(files,{},'/owned/cli');let error;try{await c.run('public-failure',[],true);}catch(e){error=e;}expect(typeof Reflect.get(c,'failure')).toBe('function');expect(c.failure(error)).toBeNull();await expect(c.fence()).rejects.toThrow();
});
it('L1-27/U27 preexisting CLI log never adopted/truncated and no process created',async()=>{
 await fs.writeFile(join(root,'run/start.log'),'unrelated');const c=createFixtureCli(files,{},'/owned/cli');await expect(c.run('start',['start'])).rejects.toThrow();expect(await fs.readFile(join(root,'run/start.log'),'utf8')).toBe('unrelated');expect(model.create).not.toHaveBeenCalled();await expect(c.fence()).rejects.toThrow();
});
