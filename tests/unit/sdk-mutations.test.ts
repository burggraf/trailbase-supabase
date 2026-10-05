import { expect, it } from 'vitest';
import { createClient, type TrailBaseMapping } from '../../src/index.js';

const id = '550e8400-e29b-41d4-a716-446655440000';
const mapping = { tables: {
  todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' }, title: { type: 'text' }, completed: { type: 'boolean' }, note: { type: 'text', nullable: true } } },
  integer_todos: { api: 'integer_todos', primaryKey: 'todo_key', fields: { todo_key: { type: 'integer' }, title: { type: 'text' } } },
  todos_read: { api: 'todos_read', primaryKey: 'id', readOnly: true, fields: { id: { type: 'uuid' }, title: { type: 'text' } } },
} } satisfies TrailBaseMapping;
function setup(respond: () => Response | Promise<Response> = () => Response.json({ ids: ['VQ6EAOKbQdSnFkRmVUQAAA=='] })) {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const client = createClient('http://trailbase.test', undefined, { trailbase: mapping, global: { fetch: async (input, init) => {
    requests.push({ url: new URL(String(input)), init }); return respond();
  } } });
  return { client, requests };
}

it('L1-06/U06 L1-07/U07 L1-08/U08 lazy one-record writes return null without reads', async () => {
  const { client, requests } = setup();
  const insert = client.from('todos').insert({ id, title: 'a&b', completed: true, note: null });
  expect(requests).toHaveLength(0);
  expect(await insert).toEqual({ data: null, error: null });
  expect(await client.from('todos').update({ title: 'changed' }).eq('id', id)).toEqual({ data: null, error: null });
  expect(await client.from('todos').delete().eq('id', id)).toEqual({ data: null, error: null });
  expect(requests.map(r => r.init?.method)).toEqual(['POST', 'PATCH', 'DELETE']);
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({ id: 'VQ6EAOKbQdSnFkRmVUQAAA==', title: 'a&b', completed: 1, note: null });
  expect(JSON.parse(String(requests[1].init?.body))).toEqual({ title: 'changed' });
  expect(decodeURIComponent(requests[1].url.pathname)).toBe('/api/records/v1/todos/VQ6EAOKbQdSnFkRmVUQAAA==');
});

it('L1-07/U07 L1-08/U08 exactly one explicit primary-key eq, including nonstandard integer keys', async () => {
  const { client, requests } = setup();
  for (const query of [client.from('todos').update({ title: 'x' }), client.from('todos').delete()]) {
    expect((await query).error?.name).toBe('UnsupportedFeatureError');
    expect(() => query.eq('title', 'x')).toThrow('primary-key');
    query.eq('id', id);
    expect(() => query.eq('id', id)).toThrow('exactly one');
    expect(() => query.eq('id', '9b2f7d5a-d8b3-4a6b-8c21-9a03d74351ef')).toThrow('exactly one');
    for (const name of ['neq', 'gt', 'gte', 'lt', 'lte', 'order', 'limit', 'range', 'select', 'single', 'maybeSingle']) {
      expect(() => Reflect.apply(Reflect.get(query, name), query, ['id', id])).toThrow('Unsupported');
    }
  }
  expect(requests).toHaveLength(0);
  expect(await client.from('integer_todos').update({ title: 'int' }).eq('todo_key', 0)).toEqual({ data: null, error: null });
  expect(requests[0].url.pathname).toBe('/api/records/v1/integer_todos/0');
});

it('L1-06/U06 L1-07/U07 S02 rejects shapes, fields, key changes, options and read-only writes before wire', () => {
  const { client, requests } = setup();
  const table = client.from('todos');
  for (const values of [[], [ { title: 'x' } ], null, new Date(), new Uint8Array(2), Object.create({ title: 'inherited' }), { typo: 'x' }, { title: undefined }, { title: {} }, { completed: 1 }, { note: new Date() }]) {
    expect(() => Reflect.apply(table.insert, table, [values])).toThrow();
    expect(() => Reflect.apply(table.update, table, [values])).toThrow();
  }
  expect(() => table.update({ id })).toThrow('primary key');
  for (const method of ['insert', 'update', 'delete']) {
    expect(() => Reflect.apply(Reflect.get(table, method), table, method === 'delete' ? [{}] : [{ title: 'x' }, { returning: 'representation' }])).toThrow('Unsupported');
    expect(() => Reflect.apply(Reflect.get(client.from('todos_read'), method), client.from('todos_read'), method === 'delete' ? [] : [{ title: 'x' }])).toThrow('read-only');
  }
  expect(() => Reflect.apply(Reflect.get(table, 'upsert'), table, [{ title: 'x' }])).toThrow('Unsupported');
  expect(() => Reflect.apply(table.select, table, ['*', { count: 'exact' }])).toThrow('Unsupported');
  expect(() => table.select().eq('toString', 'x')).toThrow('Unmapped');
  expect(() => table.select().order('constructor')).toThrow('Unmapped');
  expect(requests).toHaveLength(0);
});

it('L1-04/U04 L1-06/U06 L1-07/U07 L1-08/U08 every await is fresh, isolated and never replayed on failure', async () => {
  let calls = 0;
  const { client, requests } = setup(() => ++calls === 2 ? new Response('duplicate native', { status: 400 }) : Response.json({ ids: ['VQ6EAOKbQdSnFkRmVUQAAA=='] }));
  const table = client.from('todos');
  const input = { title: 'first' };
  const query = table.insert(input);
  input.title = 'later';
  expect((await query).error).toBeNull();
  const failed = await query;
  expect(failed.data).toBeNull(); expect(failed.error).toMatchObject({ status: 400 }); expect(failed.error?.message).toContain('duplicate native'); expect(failed.error?.code).toBeUndefined();
  const left = table.update({ title: 'left' }).eq('id', id);
  const right = table.delete();
  expect((await right).error).not.toBeNull();
  await left; await left;
  expect(requests).toHaveLength(4);
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({ title: 'first' });
  const lost = setup(() => { throw new TypeError('lost response'); });
  const result = await lost.client.from('todos').insert({ title: 'unknown outcome' });
  expect(result).toEqual({ data: null, error: { name: 'TypeError', message: 'lost response' } });
  expect(lost.requests).toHaveLength(1);
});
