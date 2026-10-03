import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { exec, } from '../../scripts/tools.mjs';
import { cli } from '../../scripts/harness.mjs';
import { context, confirmedTrailUser, confirmedSupabaseUser, nativeUuid, canonicalUuid, supabase, trailbase, type Context } from './helpers.js';

let env: Context;
let a: Awaited<ReturnType<typeof confirmedTrailUser>>;
let b: Awaited<ReturnType<typeof confirmedTrailUser>>;
let sa: Awaited<ReturnType<typeof confirmedSupabaseUser>>;
let sb: Awaited<ReturnType<typeof confirmedSupabaseUser>>;
beforeAll(async () => {
  env = await context();
  a = await confirmedTrailUser(env, 'db-a'); b = await confirmedTrailUser(env, 'db-b');
  sa = await confirmedSupabaseUser(env, 'db-a'); sb = await confirmedSupabaseUser(env, 'db-b');
});

describe('L1-27/I27/C27 cold-start fixtures (upstream, not SDK)', () => {
  it('pgTAP grants, RLS, security-invoker view and publication assertions', async () => {
    const { stdout } = await exec(cli, ['test','db','--workdir',env.directory,'--agent','no'], { timeout: 60000 });
    expect(stdout.includes('All tests successful') || stdout.includes('PASS')).toBe(true);
  });
  it('native UUID/owner/default/boolean/null fields round-trip and constraints hold', async () => {
    const id = randomUUID();
    const title = `native-${id}`;
    const records = a.client.records('todos');
    const before = (await records.list({ pagination:{limit:1000} })).records.length;
    const createdId = await records.create({ id: nativeUuid(id), user_id: a.user.id, title });
    const row = await records.read(createdId);
    expect(canonicalUuid(String(row.id))).toBe(id);
    expect(canonicalUuid(String(row.user_id))).toBe(canonicalUuid(a.user.id));
    expect(row.completed).toBe(0); expect(row.priority).toBe(0); expect(row.note).toBeNull();
    expect(Number.isSafeInteger(row.created_at)).toBe(true);
    for (const invalid of [
      { id: nativeUuid(randomUUID()), user_id: a.user.id, title },
      { id: nativeUuid(randomUUID()), user_id: a.user.id, title: null },
      { id: nativeUuid(randomUUID()), user_id: a.user.id, title: `invalid-${randomUUID()}`, completed: 2 },
      { id: nativeUuid(randomUUID()), user_id: a.user.id, title: `invalid-${randomUUID()}`, priority: -1 },
    ]) await expect(records.create(invalid)).rejects.toBeDefined();
    expect((await records.read(createdId)).title).toBe(title);
    expect((await records.list({ pagination:{limit:1000} })).records).toHaveLength(before+1);
  });
  it('reference UUID/owner/default/boolean/null fields round-trip and constraints hold', async () => {
    const id = randomUUID(), title = `reference-${id}`;
    const before = (await sa.client.from('todos').select('*')).data!.length;
    const inserted = await sa.client.from('todos').insert({ id, user_id: sa.user.id, title });
    expect(inserted.error === null).toBe(true); expect(inserted.data).toBeNull();
    const selected = await sa.client.from('todos').select('*').eq('id',id).single();
    expect(selected.error === null).toBe(true);
    expect(selected.data?.id).toBe(id); expect(selected.data?.user_id).toBe(sa.user.id);
    expect(selected.data?.completed).toBe(false); expect(selected.data?.priority).toBe(0); expect(selected.data?.note).toBeNull();
    expect(Number.isSafeInteger(selected.data?.created_at)).toBe(true);
    const invalidReferenceRows: Record<string, unknown>[] = [
      { id: randomUUID(), user_id: sa.user.id, title },
      { id: randomUUID(), user_id: sa.user.id, title: null },
      { id: randomUUID(), user_id: sa.user.id, title: `invalid-${randomUUID()}`, priority: -1 },
      { id: randomUUID(), user_id: randomUUID(), title: `invalid-${randomUUID()}` },
    ];
    for (const invalid of invalidReferenceRows) expect((await sa.client.from('todos').insert(invalid)).error !== null).toBe(true);
    expect((await sa.client.from('todos').select('title').eq('id',id).single()).data?.title).toBe(title);
    expect((await sa.client.from('todos').select('*')).data).toHaveLength(before+1);
  });
  it('native anonymous/B/spoof/reassignment denials leave A row intact; read-only view isolates owners', async () => {
    const id = nativeUuid(randomUUID()), title = `protected-${randomUUID()}`;
    await a.client.records('todos').create({ id, user_id: a.user.id, title });
    await expect(trailbase(env).records('todos').list()).rejects.toBeDefined();
    expect((await b.client.records('todos').list()).records).toHaveLength(0);
    await expect(b.client.records('todos').update(id,{ title: 'stolen' })).rejects.toBeDefined();
    await expect(b.client.records('todos').delete(id)).rejects.toBeDefined();
    await expect(b.client.records('todos').create({ id: nativeUuid(randomUUID()), user_id: a.user.id, title: `spoof-${randomUUID()}` })).rejects.toBeDefined();
    await expect(a.client.records('todos').update(id,{ user_id: b.user.id })).rejects.toBeDefined();
    expect((await a.client.records('todos').read(id)).title).toBe(title);
    expect((await a.client.records('todos').read(id)).user_id).toBe(a.user.id);
    expect((await b.client.records('todos_read').list()).records).toHaveLength(0);
    expect((await a.client.records('todos_read').list()).records.some(row => row.title === title)).toBe(true);
    await expect(a.client.records('todos_read').create({ id: nativeUuid(randomUUID()), user_id: a.user.id, title: 'view-write' })).rejects.toBeDefined();
  });
  it('reference anonymous/B/spoof/reassignment denials leave A row intact; view obeys RLS', async () => {
    const id = randomUUID(), title = `protected-${randomUUID()}`;
    expect((await sa.client.from('todos').insert({ id, user_id: sa.user.id, title })).error === null).toBe(true);
    expect((await supabase(env).from('todos').select('*')).error !== null).toBe(true);
    expect((await sb.client.from('todos').select('*')).data).toEqual([]);
    expect((await sb.client.from('todos').update({ title: 'stolen' }).eq('id',id)).error).toBeNull();
    expect((await sb.client.from('todos').delete().eq('id',id)).error).toBeNull();
    expect((await sb.client.from('todos').insert({ id: randomUUID(), user_id: sa.user.id, title: `spoof-${randomUUID()}` })).error !== null).toBe(true);
    expect((await sa.client.from('todos').update({ user_id: sb.user.id }).eq('id',id)).error !== null).toBe(true);
    const after = await sa.client.from('todos').select('*').eq('id',id).single();
    expect(after.data?.title).toBe(title); expect(after.data?.user_id).toBe(sa.user.id);
    expect((await sb.client.from('todos_read').select('*')).data).toEqual([]);
    expect((await sa.client.from('todos_read').select('*').eq('id',id)).data?.length).toBe(1);
    expect((await sa.client.from('todos_read').insert({ id: randomUUID(), user_id: sa.user.id, title: 'view-write' })).error !== null).toBe(true);
  });
  it('integer/nonstandard primary-key fixtures support ordinary owner-scoped CRUD', async () => {
    const key = 123456;
    await a.client.records('integer_todos').create({ todo_key: key, user_id: a.user.id, title: 'native key' });
    expect((await a.client.records('integer_todos').read(key)).todo_key).toBe(key);
    expect((await sa.client.from('integer_todos').insert({ todo_key: key, user_id: sa.user.id, title: 'reference key' })).error === null).toBe(true);
    expect((await sa.client.from('integer_todos').select('*').eq('todo_key',key).single()).data?.todo_key).toBe(key);
  });
});
