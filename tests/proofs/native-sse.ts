import type { ChangeEvent } from 'trailbase';

// Phase A proof only. LF/CRLF native SSE, 64Ki UTF-16 pending-buffer ceiling;
// no production SDK, reconnection, schema mapping or sequence replay guarantee.
export async function* nativeSseProof(body: ReadableStream<Uint8Array>, options: {
  signal?: AbortSignal; onLoss?: () => void;
} = {}): AsyncGenerator<ChangeEvent> {
  const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',previous:number|undefined;
  const abort=()=>{void reader.cancel().catch(()=>{});};
  options.signal?.addEventListener('abort',abort,{once:true});
  try {
    while(true) {
      if(options.signal?.aborted)throw new DOMException('Stream aborted','AbortError');
      const chunk=await reader.read();
      if(options.signal?.aborted)throw new DOMException('Stream aborted','AbortError');
      buffer+=chunk.done?decoder.decode():decoder.decode(chunk.value,{stream:true});
      buffer=buffer.replaceAll('\r\n','\n');
      if(buffer.length>65536)throw new Error('Proof SSE buffer limit exceeded');
      let boundary:number;
      while((boundary=buffer.indexOf('\n\n'))>=0) {
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const lines=frame.split('\n').filter(line=>line.startsWith('data:'));
        if(!lines.length)continue; // Native keepalive/comments; not application data.
        let event:ChangeEvent;
        try {
          event=JSON.parse(lines.map(line=>line.slice(5).replace(/^ /,'')).join('\n'),(_key,value)=>{
            if(typeof value==='number'&&(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value))))throw new Error('Unsupported scalar');
            return value;
          });
        } catch {throw new Error('Invalid/unsupported native SSE JSON');}
        if(!event||typeof event!=='object'||Array.isArray(event)||['Insert','Update','Delete','Error'].filter(key=>key in event).length!==1)throw new Error('Unknown native SSE event');
        const kind=['Insert','Update','Delete','Error'].find(key=>key in event)!;
        const payload=(event as unknown as Record<string,unknown>)[kind];
        if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid native SSE payload');
        if('Error' in event&&![0,1,2].includes(event.Error.status))throw new Error('Invalid native SSE status');
        const sequence=event.seq;
        if(sequence!==undefined) {
          if(!Number.isSafeInteger(sequence)||sequence<0)throw new Error('Invalid SSE sequence');
          if(previous!==undefined&&sequence!==previous+1)options.onLoss?.();
          previous=sequence;
        }
        if('Error' in event&&event.Error.status===2)options.onLoss?.();
        yield event;
      }
      if(chunk.done) {
        if(buffer.trim())throw new Error('Truncated native SSE frame');
        return;
      }
    }
  } finally {
    options.signal?.removeEventListener('abort',abort);
    await reader.cancel().catch(()=>{});reader.releaseLock();
  }
}
