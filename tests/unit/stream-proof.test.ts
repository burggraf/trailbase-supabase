import { describe,it,expect,vi } from 'vitest';
import { nativeSseProof } from '../proofs/native-sse.js';

const event={seq:1,Insert:{id:'fixture-key',title:'雪é-e\u0301 &+%'}};
const encode=(text:string)=>new TextEncoder().encode(text);
function body(chunks:Uint8Array[],cancel?:()=>void) {
  return new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();},cancel});
}
async function collect(chunks:Uint8Array[],onLoss?:()=>void) {
  const result=[];for await(const value of nativeSseProof(body(chunks),{onLoss}))result.push(value);return result;
}
const frame=`data: ${JSON.stringify(event)}\n\n`;
describe('L1-27 G5 proof parser unit/property checks, NOT real network or production SDK',()=>{
  it('preserves UTF-8 at every single split and byte-fragmentation boundary',async()=>{
    const bytes=encode(frame);
    for(let i=0;i<=bytes.length;i++)expect(await collect([bytes.slice(0,i),bytes.slice(i)])).toEqual([event]);
    expect(await collect([...bytes].map(byte=>new Uint8Array([byte])))).toEqual([event]);
  });
  it('accepts byte-split CRLF, multiline data and keepalive comments',async()=>{
    const text=`: keepalive\r\n\r\nevent: ignored\r\ndata: {"seq":1,\r\ndata: "Insert":{"title":"雪"}}\r\n\r\n`;
    expect(await collect([...encode(text)].map(byte=>new Uint8Array([byte])))).toEqual([{seq:1,Insert:{title:'雪'}}]);
  });
  it('keeps sequence state across chunks and signals gaps, duplicate/reordered sequence and explicit loss',async()=>{
    let losses=0;
    const events=[event,{...event,seq:3},{...event,seq:3},{...event,seq:2},{Error:{status:2,message:'Fixture loss'}}];
    expect(await collect(events.map(value=>encode(`data: ${JSON.stringify(value)}\n\n`)),()=>losses++)).toEqual(events);
    expect(losses).toBe(4);
  });
  it('does not signal gaps for consecutive frames or absent sequence metadata',async()=>{
    let losses=0;
    const events=[event,{...event,seq:2},{Update:{title:'fixture'}},{...event,seq:3}];
    expect(await collect([encode(events.map(value=>`data: ${JSON.stringify(value)}\n\n`).join(''))],()=>losses++)).toEqual(events);
    expect(losses).toBe(0);
  });
  it('fails closed on malformed, truncated, unsafe-integer and invalid event/sequence/status frames',async()=>{
    for(const text of ['data: {\n\n','data: {}\n\n','data: {"Insert":null}\n\n','data: {"Insert":{},"Delete":{}}\n\n',
      'data: {"seq":-1,"Insert":{}}\n\n','data: {"Error":{"status":9}}\n\n',
      'data: {"Insert":{"value":9007199254740993}}\n\n',frame.slice(0,-1)]) {
      await expect(collect([encode(text)])).rejects.toBeDefined();
    }
    await expect(collect([new Uint8Array([0xff])])).rejects.toBeDefined();
    await expect(collect([new Uint8Array([0xe9])])).rejects.toBeDefined();
  });
  it('enforces the declared proof buffer ceiling',async()=>{
    await expect(collect([encode('data: '+ 'x'.repeat(65536))])).rejects.toThrow('buffer limit');
  });
  it('consumer return cancels an open source and releases its reader lock',async()=>{
    let cancelled=0;
    const source=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encode(frame));},cancel(){cancelled++;}});
    const parser=nativeSseProof(source);
    expect((await parser.next()).value).toEqual(event);
    await parser.return(undefined);expect(cancelled).toBe(1);expect(source.locked).toBe(false);
  });
  it('100 alternating return/abort lifecycles cancel once, detach abort listeners and never deliver after close',async()=>{
    for(let cycle=0;cycle<100;cycle++){
      let cancelled=0;
      const source=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encode(frame));},cancel(){cancelled++;}});
      const abort=new AbortController(),added=vi.spyOn(abort.signal,'addEventListener'),removed=vi.spyOn(abort.signal,'removeEventListener');
      const parser=nativeSseProof(source,{signal:abort.signal});
      expect((await parser.next()).value).toEqual(event);
      if(cycle%2===0){const pending=parser.next();abort.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});}
      else await parser.return(undefined);
      await parser.return(undefined);abort.abort();
      expect(await parser.next()).toEqual({done:true,value:undefined});
      expect(cancelled).toBe(1);expect(source.locked).toBe(false);
      expect(added).toHaveBeenCalledTimes(1);expect(removed).toHaveBeenCalledTimes(1);
      expect(removed.mock.calls[0]).toEqual(added.mock.calls[0].slice(0,2));
      added.mockRestore();removed.mockRestore();
    }
  });
  it('abort unblocks a pending read, surfaces AbortError and cancels once',async()=>{
    let cancelled=0;
    const source=new ReadableStream<Uint8Array>({cancel(){cancelled++;}}),controller=new AbortController();
    const parser=nativeSseProof(source,{signal:controller.signal}),pending=parser.next();
    controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(cancelled).toBe(1);expect(source.locked).toBe(false);
  });
});
