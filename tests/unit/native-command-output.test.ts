import {beforeEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';import{PassThrough}from'node:stream';
const model=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),spawn:model.spawn}));
import{createCommandProcess}from'../../scripts/native-process.mjs';
let child:any,actor:any,input:string;
const frame=(value:object)=>child.stdout.write(JSON.stringify(value)+'\n');
const close=()=>{child.stdout.end();child.stderr.end();child.emit('close',0,null);};
const joined=()=>{frame({type:'terminal'});frame({type:'joined',code:0,signal:null});};
const output=(bytes:Buffer,stream='out')=>frame({type:'output',stream,data:bytes.toString('base64')});
beforeEach(()=>{input='';child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.on('data',(b:Buffer)=>{input+=b.toString();});child.kill=vi.fn(()=>{throw Error('Numeric signal forbidden');});model.spawn.mockReset().mockReturnValue(child);actor=createCommandProcess('/owned/cli',[],{env:{PATH:'/usr/bin:/bin'},logFd:19,stderrFd:20,memoryOutput:true});});
it('L1-27/U27 memory-only original output survives chunked base64/binary and requires final original join/EOF',async()=>{
 const p=actor.start();frame({type:'created',pid:517});await p;expect(()=>actor.output()).toThrow();const bytes=Buffer.alloc(65536,255);for(let n=0;n<4;n++)output(bytes);output(Buffer.from('stderr'),'err');joined();expect(()=>actor.output()).toThrow();close();await actor.join();expect(actor.output()).toEqual({stdout:Buffer.alloc(262144,255),stderr:Buffer.from('stderr')});expect(input).not.toContain('STOP\n');expect(child.kill).not.toHaveBeenCalled();
});
it.each(['encoding','stream','after-join','partial','frame-bound','aggregate-bound','before-birth'])('L1-27/U27 original command %s output protocol uncertainty never yields captured success or cleanup authority',async fault=>{
 const p=actor.start();if(fault==='before-birth'){output(Buffer.from('x'));frame({type:'created',pid:517});await expect(p).rejects.toThrow();}else{frame({type:'created',pid:517});await p;}
 const failure=expect(actor.join()).rejects.toThrow();
 if(fault==='encoding')frame({type:'output',stream:'out',data:'!'});if(fault==='stream')output(Buffer.from('x'),'other');if(fault==='after-join'){joined();output(Buffer.from('x'));}if(fault==='partial')child.stdout.write('{"type":"output"');if(fault==='frame-bound')output(Buffer.alloc(100000));if(fault==='aggregate-bound')for(let n=0;n<306;n++)output(Buffer.alloc(65536));
 if(fault!=='after-join'&&fault!=='partial')joined();close();await failure;expect(actor.inventory()).toMatchObject({joined:false,unknown:true});expect(()=>actor.output()).toThrow();expect(input).not.toContain('STOP\n');expect(child.kill).not.toHaveBeenCalled();expect(model.spawn).toHaveBeenCalledTimes(1);
});
