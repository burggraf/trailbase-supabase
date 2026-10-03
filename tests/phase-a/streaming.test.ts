import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { initClient, type ChangeEvent } from 'trailbase';
import { context, confirmedTrailUser, confirmedSupabaseUser, nativeUuid, type Context } from './helpers.js';

let env: Context;
beforeAll(async () => { env = await context(); });
async function deadline<T>(promise: Promise<T>, milliseconds = 10000, label = 'Stream event'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_,no) => { timer = setTimeout(() => no(new Error(`${label} deadline exceeded`)), milliseconds); })]);
  } finally { clearTimeout(timer!); }
}
async function parseCapturedFrame(event: ChangeEvent, fragmented: boolean) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    if (fragmented) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const client = initClient(undefined, { transport: { fetch: async () => response } });
  const reader = (await client.records('todos').subscribeAll()).getReader();
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
    const id = nativeUuid(randomUUID()), title = `event-${randomUUID()}`;
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
      const whole = await parseCapturedFrame(insert,false);
      expect(whole.failed).toBe(false); expect(whole.events).toHaveLength(1);
      expect(whole.events[0]).toEqual(insert);
      const fragmented = await parseCapturedFrame(insert,true);
      expect(fragmented.failed || fragmented.events.length !== 1).toBe(true);
    } finally { await reader.cancel(); reader.releaseLock(); }
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
});
