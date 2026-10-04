import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { initClient, type ChangeEvent } from 'trailbase';
import { context, confirmedTrailUser, confirmedSupabaseUser, nativeUuid, deadline, type Context } from './helpers.js';

let env: Context;
beforeAll(async () => { env = await context(); });
async function parseCapturedFrames(input: ChangeEvent[], mode: 'whole'|'bytes'|'frames', onLoss?: () => void) {
  const frames = input.map(event => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  const bytes = Buffer.concat(frames);
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    if (mode === 'bytes') for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else if (mode === 'frames') for (const frame of frames) controller.enqueue(frame);
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const client = initClient(undefined, { transport: { fetch: async () => response } });
  const reader = (await client.records('todos').subscribeAll({onLoss})).getReader();
  const events: ChangeEvent[] = [];
  let failed = false;
  try { while (true) { const value = await deadline(reader.read()); if (value.done) break; events.push(value.value); } }
  catch { failed = true; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return { failed, events };
}

describe('L1-27 G5/G6 streaming characterization (not full SDK/security signoff)', () => {
  it('native real Insert/Update/Delete and installed-parser fragmentation defect', async () => {
    const account = await confirmedTrailUser(env,'stream');
    const api = account.client.records('todos');
    const reader = (await api.subscribeAll()).getReader();
    const id = nativeUuid(randomUUID()), title = `event-${randomUUID()}-雪é-e\u0301-&+%`;
    try {
      const inserted = reader.read();
      await api.create({ id, user_id:account.user.id, title });
      const insert = (await deadline(inserted)).value!;
      expect('Insert' in insert).toBe(true);
      if (!('Insert' in insert)) throw new Error('Unexpected native insert event');
      expect((insert.Insert as Record<string,unknown>).title).toBe(title);
      const updated = reader.read();
      await api.update(id,{ title:`${title}-updated` });
      const update = (await deadline(updated)).value!;
      expect('Update' in update).toBe(true);
      if (!('Update' in update)) throw new Error('Unexpected native update event');
      expect((update.Update as Record<string,unknown>).title).toBe(`${title}-updated`);
      const deleted = reader.read();
      await api.delete(id);
      const deletion = (await deadline(deleted)).value!;
      expect('Delete' in deletion).toBe(true);
      if (!('Delete' in deletion)) throw new Error('Unexpected native delete event');
      expect((deletion.Delete as Record<string,unknown>).id).toBe(id);
      expect((await api.list()).records).toEqual([]);
      // Replay a captured REAL native event through the installed SDK's deterministic transport boundary.
      // This is parser characterization, not proof of network fragmentation or a working fallback.
      const whole = await parseCapturedFrames([insert],'whole');
      expect(whole.failed).toBe(false); expect(whole.events).toHaveLength(1);
      expect(whole.events[0]).toEqual(insert);
      const fragmented = await parseCapturedFrames([insert],'bytes');
      expect(fragmented.failed || fragmented.events.length !== 1).toBe(true);
      // Synthetic sequence/error metadata over a captured real payload: deterministic parser
      // characterization only, NOT proof of native network loss, expiry or a working fallback.
      const gap = [{...insert,seq:100},{...update,seq:102}];
      let losses=0;
      const combined=await parseCapturedFrames(gap,'whole',()=>losses++);
      expect(combined.failed).toBe(false); expect(combined.events).toEqual(gap); expect(losses).toBe(1);
      losses=0;
      const separated=await parseCapturedFrames(gap,'frames',()=>losses++);
      expect(separated.failed).toBe(false); expect(separated.events).toEqual(gap);
      expect(losses).toBe(0); // Installed parser resets sequence state for each transport chunk.
      losses=0;
      const loss: ChangeEvent={Error:{status:2,message:'Fixture loss notification'}};
      expect((await parseCapturedFrames([loss],'whole',()=>losses++)).events).toEqual([loss]);
      expect(losses).toBe(1);
    } finally { await reader.cancel(); expect((await reader.read()).done).toBe(true); reader.releaseLock(); }
  });
  it('reference real INSERT/UPDATE/DELETE, key-only delete payload, and channel cleanup', async () => {
    const account = await confirmedSupabaseUser(env,'stream');
    const id = randomUUID(), title = `reference-event-${randomUUID()}`;
    const queue: { eventType: string; new: Record<string,unknown>; old: Record<string,unknown> }[] = [];
    let notify: (() => void) | undefined;
    // Reference SUBSCRIBED defaults to a channel join, not CDC readiness. Use its documented
    // wait option for this upstream probe; this does not add an option to the future SDK contract.
    const channel = account.client.channel(`probe-${randomUUID()}`, { config: { postgres_changes_options: { wait: true } } }).on('system', {}, event => {
      console.info('Private reference CDC diagnostic', event.status, event.extension, event.message);
    }).on('postgres_changes', { event:'*',schema:'public',table:'todos' }, event => {
      queue.push({ eventType:event.eventType, new:event.new, old:event.old }); notify?.();
    });
    try {
      await deadline(new Promise<void>((yes,no) => channel.subscribe(status => {
        if (status === 'SUBSCRIBED') yes();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') no(new Error('Reference channel startup failed'));
      })));
      async function take(eventType: string) {
        if (!queue.length) await deadline(new Promise<void>(yes => { notify = yes; }),10000,`Reference ${eventType} event`);
        notify = undefined;
        const event = queue.shift();
        if (!event) throw new Error('Missing reference event');
        return event;
      }
      expect((await account.client.from('todos').insert({ id,user_id:account.user.id,title })).error).toBeNull();
      const insert = await take('INSERT'); expect(insert.eventType).toBe('INSERT'); expect(insert.new.title).toBe(title);
      expect((await account.client.from('todos').update({ title:`${title}-updated` }).eq('id',id)).error).toBeNull();
      const update = await take('UPDATE'); expect(update.eventType).toBe('UPDATE'); expect(update.new.title).toBe(`${title}-updated`);
      expect((await account.client.from('todos').delete().eq('id',id)).error).toBeNull();
      const deletion = await take('DELETE'); expect(deletion.eventType).toBe('DELETE'); expect(deletion.old.id).toBe(id);
      expect(Object.keys(deletion.old)).toEqual(['id']);
      expect((await account.client.from('todos').select('*')).data).toEqual([]);
    } finally {
      expect(await account.client.removeChannel(channel)).toBe('ok');
      expect(account.client.getChannels()).toHaveLength(0);
    }
  });
  it('G6/S09 reference 100 CDC-ready channel cycles leave no retired callbacks or registry entries and explicitly disconnect',async()=>{
    const account=await confirmedSupabaseUser(env,'ref-cycles'),client=account.client,id=randomUUID(),controlId=randomUUID();
    const queue:{eventType:string;new:Record<string,unknown>;old:Record<string,unknown>}[]=[];
    let notify:(()=>void)|undefined;
    const retired:number[]=[],control=client.channel(`control-${randomUUID()}`,{config:{postgres_changes_options:{wait:true}}})
      .on('postgres_changes',{event:'*',schema:'public',table:'todos'},event=>{queue.push(event);notify?.();});
    const ready=(channel:typeof control)=>deadline(new Promise<void>((yes,no)=>channel.subscribe(status=>{
      if(status==='SUBSCRIBED')yes();
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')no(new Error('Reference lifecycle CDC startup failed'));
    })));
    const take=async()=>{
      if(!queue.length)await deadline(new Promise<void>(yes=>{notify=yes;}));notify=undefined;
      const event=queue.shift();if(!event)throw new Error('Reference lifecycle control missing');return event;
    };
    try {
      await ready(control);
      // Readiness is not a commit-time cutoff: seed only after joining and consume
      // both genuine seed events instead of ignoring pending WAL changes.
      expect((await client.from('todos').insert({id,user_id:account.user.id,title:`ref-cycles-${randomUUID()}`})).error).toBeNull();
      expect(await take()).toMatchObject({eventType:'INSERT',new:{id,user_id:account.user.id}});
      expect((await client.from('todos').insert({id:controlId,user_id:account.user.id,title:`ref-control-${randomUUID()}`,note:'unchanged'})).error).toBeNull();
      expect(await take()).toMatchObject({eventType:'INSERT',new:{id:controlId,user_id:account.user.id,note:'unchanged'}});
      const before=await client.from('todos').select('*').eq('id',controlId).single();expect(before.error).toBeNull();
      for(let cycle=0;cycle<100;cycle++){
        retired.push(0);const eventReady=Promise.withResolvers<Record<string,unknown>>();
        const channel=client.channel(`cycle-${randomUUID()}`,{config:{postgres_changes_options:{wait:true}}})
          .on('postgres_changes',{event:'UPDATE',schema:'public',table:'todos'},event=>{retired[cycle]++;eventReady.resolve(event.new);});
        try {
          await ready(channel);expect(client.getChannels()).toEqual([control,channel]);
          const note=`cycle-${cycle}`;
          expect((await client.from('todos').update({note}).eq('id',id)).error).toBeNull();
          expect(await deadline(eventReady.promise)).toMatchObject({id,user_id:account.user.id,note});
          expect(await take()).toMatchObject({eventType:'UPDATE',new:{id,user_id:account.user.id,note}});
          expect(await deadline(client.removeChannel(channel))).toBe('ok');
          expect(await deadline(client.removeChannel(channel))).toBe('ok');
          expect(client.getChannels()).toEqual([control]);expect(client.realtime.isConnected()).toBe(true);
          const closedNote=`closed-${cycle}`;
          expect((await client.from('todos').update({note:closedNote}).eq('id',id)).error).toBeNull();
          expect(await take()).toMatchObject({eventType:'UPDATE',new:{id,user_id:account.user.id,note:closedNote}});
          // A live correlated event after acknowledged leave, not a sleep-based absence assertion.
          expect(retired).toEqual(Array(cycle+1).fill(1));
        }finally{await deadline(client.removeChannel(channel));}
      }
      expect((await client.from('todos').select('*').eq('id',id).single()).data).toMatchObject({id,user_id:account.user.id,note:'closed-99'});
      expect((await client.from('todos').delete().eq('id',id)).error).toBeNull();
      expect(await take()).toMatchObject({eventType:'DELETE',new:{},old:{id}});
      expect(queue).toEqual([]);expect(retired).toEqual(Array(100).fill(1));
      const rows=await client.from('todos').select('*');expect(rows.error).toBeNull();expect(rows.data).toEqual([before.data]);
    }finally{
      expect(await deadline(client.removeAllChannels())).toEqual(['ok']);
      expect(client.getChannels()).toEqual([]);expect(client.realtime.isConnected()).toBe(false);
      expect(await deadline(client.removeAllChannels())).toEqual([]);
    }
    // Explicit SDK disconnect/registry evidence, not service-internal resource or timer accounting.
  },180000);
  it('G6/S07 native two-owner INSERT/UPDATE/DELETE isolation with own-event barriers and reader cancellation',async()=>{
    const owner=await confirmedTrailUser(env,'isolation-owner'),other=await confirmedTrailUser(env,'isolation-other');
    const api=owner.client.records('todos'),foreign=other.client.records('todos');
    const reader=(await api.subscribeAll()).getReader();
    const ownId=nativeUuid(randomUUID()),foreignId=nativeUuid(randomUUID());
    try {
      let pending=reader.read();
      await foreign.create({id:foreignId,user_id:other.user.id,title:`foreign-${randomUUID()}`});
      await api.create({id:ownId,user_id:owner.user.id,title:`own-${randomUUID()}`});
      let event=(await deadline(pending)).value!;
      expect('Insert' in event).toBe(true);
      if(!('Insert' in event))throw new Error('Missing own insert barrier');
      expect((event.Insert as Record<string,unknown>).id).toBe(ownId);
      await expect(api.read(foreignId)).rejects.toBeDefined();
      pending=reader.read();
      await foreign.update(foreignId,{title:`foreign-update-${randomUUID()}`});
      await api.update(ownId,{title:`own-update-${randomUUID()}`});
      event=(await deadline(pending)).value!;
      expect('Update' in event).toBe(true);
      if(!('Update' in event))throw new Error('Missing own update barrier');
      expect((event.Update as Record<string,unknown>).id).toBe(ownId);
      pending=reader.read();
      await foreign.delete(foreignId);
      await api.delete(ownId);
      event=(await deadline(pending)).value!;
      expect('Delete' in event).toBe(true);
      if(!('Delete' in event))throw new Error('Missing own delete barrier');
      expect((event.Delete as Record<string,unknown>).id).toBe(ownId);
      expect((await api.list()).records).toEqual([]); expect((await foreign.list()).records).toEqual([]);
    } finally {await reader.cancel(); expect((await reader.read()).done).toBe(true); reader.releaseLock();}
  });
  it('G6/S07 reference two-owner INSERT/UPDATE isolation and approved key-only foreign DELETE visibility',async()=>{
    const owner=await confirmedSupabaseUser(env,'isolation-owner'),other=await confirmedSupabaseUser(env,'isolation-other');
    const ownId=randomUUID(),foreignId=randomUUID();
    const queue: {eventType:string;new:Record<string,unknown>;old:Record<string,unknown>}[]=[];
    let notify:(()=>void)|undefined;
    const channel=owner.client.channel(`isolation-${randomUUID()}`,{config:{postgres_changes_options:{wait:true}}})
      .on('postgres_changes',{event:'*',schema:'public',table:'todos'},event=>{queue.push(event);notify?.();});
    async function take() {
      if(!queue.length)await deadline(new Promise<void>(yes=>{notify=yes;}));
      notify=undefined;
      const event=queue.shift(); if(!event)throw new Error('Missing own reference barrier');return event;
    }
    try {
      await deadline(new Promise<void>((yes,no)=>channel.subscribe(status=>{
        if(status==='SUBSCRIBED')yes();
        if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')no(new Error('Reference isolation channel startup failed'));
      })));
      expect((await other.client.from('todos').insert({id:foreignId,user_id:other.user.id,title:`foreign-${randomUUID()}`})).error).toBeNull();
      expect((await owner.client.from('todos').insert({id:ownId,user_id:owner.user.id,title:`own-${randomUUID()}`})).error).toBeNull();
      let event=await take();expect(event.eventType).toBe('INSERT');expect(event.new.id).toBe(ownId);
      const invisible=await owner.client.from('todos').select('*').eq('id',foreignId);
      expect(invisible.error).toBeNull();expect(invisible.data).toEqual([]);
      expect((await other.client.from('todos').update({title:`foreign-update-${randomUUID()}`}).eq('id',foreignId)).error).toBeNull();
      expect((await owner.client.from('todos').update({title:`own-update-${randomUUID()}`}).eq('id',ownId)).error).toBeNull();
      event=await take();expect(event.eventType).toBe('UPDATE');expect(event.new.id).toBe(ownId);
      expect((await other.client.from('todos').delete().eq('id',foreignId)).error).toBeNull();
      expect((await owner.client.from('todos').delete().eq('id',ownId)).error).toBeNull();
      const ownerRows=await owner.client.from('todos').select('*'),otherRows=await other.client.from('todos').select('*');
      expect(ownerRows.error).toBeNull();expect(otherRows.error).toBeNull();
      expect(ownerRows.data).toEqual([]);expect(otherRows.data).toEqual([]);
      // Supabase DELETE keys are explicitly non-confidential; protected row values remain forbidden.
      for(const expectedId of [foreignId,ownId]) {
        event=await take();expect(event.eventType).toBe('DELETE');
        expect(event.old).toEqual({id:expectedId});expect(event.new).toEqual({});
      }
      expect(queue).toEqual([]);
    } finally {
      expect(await deadline(owner.client.removeChannel(channel))).toBe('ok');
      expect(owner.client.getChannels()).toHaveLength(0);
    }
  });
});
