import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resolve,join} from 'node:path';
const mock=vi.hoisted(()=>({exec:vi.fn(),create:vi.fn(),stop:vi.fn(),remove:vi.fn(),handles:[] as any[],actors:[] as any[],roots:[] as string[],binary:'/fixture/trail',ownerSyncFailure:false}));
vi.mock('../../scripts/tools.mjs',async original=>({...await original<typeof import('../../scripts/tools.mjs')>(),exec:mock.exec,installTrail:async()=>mock.binary}));
vi.mock('../../scripts/fixture-docker.mjs',async()=>{const m=await import('../fixtures/docker-command-model.js');return{localDockerTarget:m.localDockerTarget,createFixtureDocker:(_f:unknown,env:any)=>m.dockerCommandModel(mock.exec,env)};});
vi.mock('../../scripts/fixture-network.mjs',()=>({fixtureNetwork:()=>({id:'a'.repeat(64),create:async()=>{},inventory:async()=>({exists:true}),remove:mock.remove})}));
vi.mock('../../scripts/native-process.mjs',()=>({createNativeProcess:mock.create}));
// File/native scenarios keep the CLI modeled; separate actual CLI scenarios retain real original owners.
vi.mock('../../scripts/fixture-cli.mjs',()=>({createFixtureFrontendCli:(_files:unknown,env:unknown)=>({run:(_name:string,args:string[])=>mock.exec(resolve('node_modules/.bin/supabase'),args,{env,timeout:300000,maxBuffer:20000000}),fence:async()=>{},inventory:async()=>({complete:false,unknown:false,commands:[]})})}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return{...fs,open:async(...args:Parameters<typeof fs.open>)=>{const f=await fs.open(...args);mock.handles.push(f);if(String(args[0]).endsWith('/owner.json'))mock.roots.push(resolve(await fs.realpath('/proc/self/fd/'+f.fd),'..'));const sync=f.sync.bind(f);f.sync=async()=>{if(mock.ownerSyncFailure&&String(args[0]).endsWith('/owner.json'))throw Error('Injected owner fsync unknown');return sync();};return f;}};});
import {createHarness,cli} from '../../scripts/harness.mjs';
import {baseline} from '../../scripts/tools.mjs';
const fs=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const native=await vi.importActual<typeof import('../../scripts/native-process.mjs')>('../../scripts/native-process.mjs');
let h:Awaited<ReturnType<typeof createHarness>>,root:string;
beforeEach(async()=>{
 vi.clearAllMocks();mock.handles=[];mock.actors=[];mock.roots=[];mock.binary='/fixture/trail';mock.ownerSyncFailure=false;root=await fs.mkdtemp(join(process.env.TMPDIR!,'custody-harness-'));
 mock.remove.mockResolvedValue(undefined);mock.stop.mockResolvedValue(undefined);
 mock.create.mockReturnValue({pid:517,exited:false,exitCode:null,signalCode:null,start:async(record:(pid:number)=>Promise<void>)=>{await record(517);throw Error('Injected launch acknowledgement unknown');},stop:mock.stop,inventory:()=>({complete:false,pid:517,joined:false})});
 mock.exec.mockImplementation(async(file:string,args:string[])=>{
  if(file===cli&&args[0]==='--version')return{stdout:baseline.supabaseCli,stderr:''};
  if(file===cli&&args[0]==='status')return{stdout:JSON.stringify({ANON_KEY:'unit-not-a-credential'}),stderr:''};
  if(file==='docker'&&args[0]==='context')return{stdout:'unix:///fixture/docker.sock',stderr:''};
  return{stdout:args[0]==='--version'?'TrailBase v'+baseline.trailbase.version:'',stderr:''};
 });
 // Readiness-only flags modeled; no auth/data success bodies or actual HTTP/network operation.
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.includes('phase-a-owner.txt'))throw Error('No backend HTTP in file custody component');return{ok:true};}));h=await createHarness();
});
afterEach(async()=>{
 // Only generated resources. Test intercepts retain every ORIGINAL FH and native creating object.
 // Physically join all own finite actors before closing FHs/removing exclusively generated test trees.
 for(const actor of mock.actors){await actor.stop();expect(actor.inventory().joined&&!actor.inventory().unknown).toBe(true);}
 for(const f of mock.handles)await f.close();
 for(const own of mock.roots)await fs.rm(own,{recursive:true,force:true});
 await fs.rm(h.context.directory,{recursive:true,force:true});await fs.rm(h.context.directory+'.original',{recursive:true,force:true});await fs.rm(root,{recursive:true});vi.unstubAllGlobals();
});
it('L1-27/U27 initial owner flush uncertainty keeps an actual refusing harness so original finalizers cannot mistake absent allocation for cleanup',async()=>{
 await h.cleanup();mock.ownerSyncFailure=true;mock.remove.mockClear();h=await createHarness();
 expect((await h.inventoryResources() as any).files).toMatchObject({unknown:true,closed:false,ownerDurable:false});
 await expect(h.start()).rejects.toThrow();await expect(h.cleanup()).rejects.toThrow();expect(mock.exec).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();expect(mock.remove).not.toHaveBeenCalled();expect(mock.handles.some(f=>f.fd>=0)).toBe(true);
});
it('L1-27/U27 actual harness cannot truncate preexisting native log or create a native actor from it',async()=>{
 const path=resolve(h.context.directory,'trail.log');await fs.writeFile(path,'unrelated log');await expect(h.start()).rejects.toThrow();expect(await fs.readFile(path,'utf8')).toBe('unrelated log');expect(mock.create).not.toHaveBeenCalled();
 await expect(h.cleanup()).rejects.toThrow();expect(mock.remove).not.toHaveBeenCalled();expect((await fs.stat(resolve(h.context.directory,'traildepot'))).isDirectory()).toBe(true);
});
it('L1-27/U27 actual harness fresh start binding rejects equal-JSON replacement owner before CLI/native effects',async()=>{
 const path=resolve(h.context.directory,'owner.json'),bytes=await fs.readFile(path);await fs.rename(path,path+'.original');await fs.writeFile(path,bytes);
 await expect(h.start()).rejects.toThrow();expect(mock.exec).not.toHaveBeenCalled();expect(mock.create).not.toHaveBeenCalled();await expect(h.cleanup()).rejects.toThrow();expect(await fs.readFile(path)).toEqual(bytes);
});
it('L1-27/U27 actual harness never deletes a replacement directory after its original path moved',async()=>{
 await fs.rename(h.context.directory,h.context.directory+'.original');await fs.mkdir(h.context.directory);await fs.writeFile(resolve(h.context.directory,'owner.json'),await fs.readFile(resolve(h.context.directory+'.original','owner.json')));await fs.mkdir(resolve(h.context.directory,'traildepot'));await fs.writeFile(resolve(h.context.directory,'traildepot','foreign'),'unrelated');
 await expect(h.start()).rejects.toThrow();await expect(h.cleanup()).rejects.toThrow();expect(mock.exec).not.toHaveBeenCalled();expect(await fs.readFile(resolve(h.context.directory,'traildepot','foreign'),'utf8')).toBe('unrelated');
});
it('L1-27/U27 owner flush failure before GO retains data and original native containment without later CLI cleanup',async()=>{
 let go=false;mock.create.mockReturnValue({pid:517,start:async(record:(pid:number)=>Promise<void>)=>{mock.ownerSyncFailure=true;await record(517);go=true;},stop:mock.stop,inventory:()=>({complete:false,joined:false})});
 await expect(h.start()).rejects.toThrow();expect(go).toBe(false);mock.ownerSyncFailure=false;await expect(h.cleanup()).rejects.toThrow();expect(mock.stop).toHaveBeenCalledTimes(1);expect(mock.remove).not.toHaveBeenCalled();expect((await fs.stat(resolve(h.context.directory,'traildepot'))).isDirectory()).toBe(true);
});
it('L1-27/U27 actual harness + original real finite native preserves complete output and file handles through stop, closes after cleanup',async()=>{
 mock.binary=join(root,'finite-native');await fs.writeFile(mock.binary,'#!'+process.execPath+'\nprocess.stdout.write("fresh-file-native-out\\n");process.stderr.write("fresh-file-native-err\\n");setTimeout(()=>{},1000);\n',{mode:0o700,flag:'wx'});
 mock.create.mockImplementation((...args:Parameters<typeof native.createNativeProcess>)=>{const actor=native.createNativeProcess(...args);mock.actors.push(actor);return actor;});
 await expect(h.start()).rejects.toThrow();expect(mock.actors).toHaveLength(1);await mock.actors[0].join();expect(mock.actors[0].exitCode).toBe(0);
 await h.stopNative();const inventory=await h.inventoryResources();expect((inventory as any).files).toMatchObject({complete:false,closed:false,unknown:false,ownerDurable:true});expect((inventory as any).files.logs).toEqual([expect.objectContaining({name:'trail.log',sealed:true})]);
 const log=await fs.readFile(resolve(h.context.directory,'trail.log'),'utf8');expect(log).toContain('fresh-file-native-out\n');expect(log).toContain('fresh-file-native-err\n');expect(mock.handles.every(f=>f.fd>=0)).toBe(true);
 await h.cleanup();expect((await h.inventoryResources() as any).files.closed).toBe(true);expect(mock.handles.every(f=>f.fd===-1)).toBe(true);expect(await fs.readFile(resolve(h.context.directory,'trail.log'),'utf8')).toBe(log);
});
