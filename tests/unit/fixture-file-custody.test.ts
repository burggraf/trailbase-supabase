import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {join} from 'node:path';
const state=vi.hoisted(()=>({handles:[] as any[],failSync:false}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return{...fs,open:async(...args:Parameters<typeof fs.open>)=>{const f=await fs.open(...args);state.handles.push(f);const sync=f.sync.bind(f);f.sync=async()=>{if(state.failSync)throw Error('Injected original fsync uncertainty');return sync();};return f;}};});
import {createFixtureFiles} from '../../scripts/fixture-files.mjs';
const fs=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let root:string, directory:string;
beforeEach(async()=>{state.handles=[];state.failSync=false;root=await fs.mkdtemp(join(process.env.TMPDIR!,'custody-unit-'));directory=join(root,'fresh');});
afterEach(async()=>{
 // This finite test owns EVERY original opened FH and replacement; zero actors/backend/SQL exist.
 // Directly close captured original test capabilities, never product recovery/adoption/retry.
 for(const f of state.handles)await f.close();await fs.rm(root,{recursive:true});
});
it('L1-27/U27 original exclusive owner and directory flushed; subsequent owner update uses same inode and positional bytes',async()=>{
 const c=await createFixtureFiles(directory,{id:'owned',long:'a'.repeat(64)});const before=await fs.stat(join(directory,'owner.json'));
 await c.writeOwner({id:'owned',pid:17});await c.admit();const after=await fs.stat(join(directory,'owner.json'));
 expect(after.ino).toBe(before.ino);expect(after.mode&0o777).toBe(0o600);expect((await fs.stat(directory)).mode&0o777).toBe(0o700);
 expect(JSON.parse(await fs.readFile(join(directory,'owner.json'),'utf8'))).toEqual({id:'owned',pid:17});expect((await c.inventory()).ownerDurable).toBe(true);
 await c.close();expect((await c.inventory()).closed).toBe(true);await expect(c.admit()).rejects.toThrow();
});
it('L1-27/U27 existing run directory never adopted or changed',async()=>{
 await fs.mkdir(directory,{mode:0o700});await fs.writeFile(join(directory,'owner.json'),'unrelated');await expect(createFixtureFiles(directory,{id:'owned'})).rejects.toThrow();expect(await fs.readFile(join(directory,'owner.json'),'utf8')).toBe('unrelated');
});
it.each(['owner-replace','owner-content','owner-hardlink','owner-mode','directory-replace'])('L1-27/U27 fresh original admission denies %s and remains unknown after correction',async kind=>{
 const c=await createFixtureFiles(directory,{id:'owned'});const path=join(directory,'owner.json');
 if(kind==='owner-replace'){await fs.rename(path,path+'.original');await fs.writeFile(path,'foreign');}
 if(kind==='owner-content')await fs.writeFile(path,'{partial');
 if(kind==='owner-hardlink')await fs.link(path,join(root,'alias'));
 if(kind==='owner-mode')await fs.chmod(path,0o644);
 if(kind==='directory-replace'){await fs.rename(directory,directory+'.original');await fs.mkdir(directory);await fs.writeFile(path,'foreign');}
 await expect(c.admit()).rejects.toThrow();expect((await c.inventory()).unknown).toBe(true);await expect(c.writeOwner({id:'changed'})).rejects.toThrow();await expect(c.close()).rejects.toThrow();
 if(kind==='owner-content')await fs.writeFile(path,JSON.stringify({id:'owned'}));await expect(c.admit()).rejects.toThrow();
 if(['owner-replace','directory-replace'].includes(kind))expect(await fs.readFile(path,'utf8')).toBe('foreign');
});
it('L1-27/U27 log append lease reuses original descriptor after seal; no live lease reuse or cleanup',async()=>{
 const c=await createFixtureFiles(directory,{id:'owned'});const log=await c.openLog('trail.log');await state.handles.find(f=>f.fd===log.fd).write('one');await expect(c.openLog('trail.log',true)).rejects.toThrow();
 // Concurrent lease refusal must retain the original, not grant a replacement or close it.
 expect((await fs.stat(join(directory,'trail.log'))).size).toBe(3);
});
it('L1-27/U27 sealed original log appends complete bytes and closes only with final fixture closure',async()=>{
 const c=await createFixtureFiles(directory,{id:'owned'});const first=await c.openLog('trail.log');const fd=first.fd;await state.handles.find(f=>f.fd===fd).write('one');await first.close();
 const second=await c.openLog('trail.log',true);expect(second.fd).toBe(fd);await state.handles.find(f=>f.fd===fd).write('two');await second.close();await c.close();expect(await fs.readFile(join(directory,'trail.log'),'utf8')).toBe('onetwo');
});
it.each(['regular','symlink','hardlink'])('L1-27/U27 never truncates/adopts preexisting %s log',async kind=>{
 const c=await createFixtureFiles(directory,{id:'owned'});const target=join(root,'foreign');await fs.writeFile(target,'unrelated');const log=join(directory,'trail.log');
 if(kind==='regular')await fs.writeFile(log,'unrelated');if(kind==='symlink')await fs.symlink(target,log);if(kind==='hardlink')await fs.link(target,log);
 await expect(c.openLog('trail.log',true)).rejects.toThrow();expect(await fs.readFile(target,'utf8')).toBe('unrelated');expect(await fs.readFile(log,'utf8')).toBe('unrelated');expect((await c.inventory()).unknown).toBe(true);
});
it('L1-27/U27 log path replacement cannot receive writes/seal/cleanup authority from original descriptor',async()=>{
 const c=await createFixtureFiles(directory,{id:'owned'});const log=await c.openLog('trail.log');await fs.rename(join(directory,'trail.log'),join(root,'original-log'));await fs.writeFile(join(directory,'trail.log'),'foreign');
 await state.handles.find(f=>f.fd===log.fd).write('original');await expect(log.close()).rejects.toThrow();await expect(c.close()).rejects.toThrow();expect(await fs.readFile(join(root,'original-log'),'utf8')).toBe('original');expect(await fs.readFile(join(directory,'trail.log'),'utf8')).toBe('foreign');
});
it('L1-27/U27 cleanup does not broaden a file-only deletion slot into recursive directory deletion',async()=>{
 const c=await createFixtureFiles(directory,{id:'owned'});await fs.mkdir(join(directory,'context.json'));await fs.writeFile(join(directory,'context.json','foreign'),'preserve');
 await expect(c.removeData()).rejects.toThrow();expect(await fs.readFile(join(directory,'context.json','foreign'),'utf8')).toBe('preserve');expect((await c.inventory()).unknown).toBe(true);
});
it('L1-27/U27 fresh cleanup file flush fence fails before any owned data deletion',async()=>{
 const c=await createFixtureFiles(directory,{id:'owned'});await fs.mkdir(join(directory,'traildepot'));await fs.writeFile(join(directory,'traildepot','data'),'preserve');state.failSync=true;
 await expect(c.removeData()).rejects.toThrow();expect(await fs.readFile(join(directory,'traildepot','data'),'utf8')).toBe('preserve');expect((await c.inventory()).unknown).toBe(true);
});
const boundary=async(c:any)=>{expect(typeof c.frontendInventoryBoundary).toBe('function');return c.frontendInventoryBoundary();};
it('L1-27/U27 frontend inventory executables held by original FHs, exact bytes/mode/durable admission and final closure',async()=>{const c=await createFixtureFiles(directory,{id:'owned'}),b=await boundary(c);expect(b.path).toBe(join(directory,'frontend-bin'));expect(b.host).toBe('unix://'+join(b.path,'no-daemon.sock'));for(const name of ['docker','podman']){const p=join(b.path,name);expect((await fs.stat(p)).mode&0o777).toBe(0o700);const s=await fs.readFile(p,'utf8');expect(s).toContain('ORIGINAL_FRONTEND_CREATE_HANDOFF_REQUIRED');expect(s).not.toMatch(/argv|environ|exec|socket|subprocess/);}await c.admit();expect((await c.inventory()).frontendInventoryBoundary).toMatchObject({installed:true,complete:false});await c.close();expect((await c.inventory()).closed).toBe(true);});
it.each(['content','mode','directory'])('L1-27/U27 original frontend inventory boundary %s drift retains originals without repair/adoption',async kind=>{const c=await createFixtureFiles(directory,{id:'owned'}),b=await boundary(c);if(kind==='content')await fs.writeFile(join(b.path,'docker'),'foreign');if(kind==='mode')await fs.chmod(join(b.path,'podman'),0o600);if(kind==='directory'){await fs.rename(b.path,b.path+'.original');await fs.mkdir(b.path,{mode:0o700});}await expect(c.admit()).rejects.toThrow();expect((await c.inventory()).unknown).toBe(true);await expect(c.close()).rejects.toThrow();});
it('L1-27/U27 preexisting frontend executable directory is never adopted or changed',async()=>{const c=await createFixtureFiles(directory,{id:'owned'});await fs.mkdir(join(directory,'frontend-bin'),{mode:0o700});await fs.writeFile(join(directory,'frontend-bin','docker'),'foreign');await expect(boundary(c)).rejects.toThrow();expect(await fs.readFile(join(directory,'frontend-bin','docker'),'utf8')).toBe('foreign');expect((await c.inventory()).unknown).toBe(true);});
it('L1-27/U27 failed original frontend executable flush cannot admit a CLI or release files',async()=>{const c=await createFixtureFiles(directory,{id:'owned'});state.failSync=true;await expect(boundary(c)).rejects.toThrow();state.failSync=false;await expect(c.admit()).rejects.toThrow();await expect(c.close()).rejects.toThrow();expect((await c.inventory()).unknown).toBe(true);});
it('L1-27/U27 fsync failure never grants durable admission or cleanup',async()=>{
 const c=await createFixtureFiles(directory,{id:'owned'});state.failSync=true;await expect(c.writeOwner({id:'owned',pid:29})).rejects.toThrow();expect((await c.inventory()).unknown).toBe(true);state.failSync=false;await expect(c.admit()).rejects.toThrow();await expect(c.close()).rejects.toThrow();
});
