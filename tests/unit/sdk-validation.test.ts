import { expect, it } from 'vitest';
import { createClient, type TrailBaseMapping } from '../../src/index.js';

function setup() {
  const requests: string[] = [];
  const mapping: TrailBaseMapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' }, completed: { type: 'boolean' }, title: { type: 'text' }, priority: { type: 'integer' } } } } };
  const client = createClient('http://trailbase.test', undefined, { trailbase: mapping, global: { fetch: async input => { requests.push(String(input)); return Response.json({ ids: ['VQ6EAOKbQdSnFkRmVUQAAA=='] }); } } });
  return { client, requests, mapping };
}
it('L1-03/U03 S02 mutation UUID codec has 1000 deterministic round trips through real native serialization', async () => {
  let state = 0x12345678;
  function byte() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state >>> 24; }
  function uuid() {
    const bytes = Uint8Array.from({ length: 16 }, byte);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Buffer.from(bytes).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const encode = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex').toString('base64').replaceAll('+', '-').replaceAll('/', '_');
  const generated = new Set<string>();
  const requests: { url: URL; method: string; body?: Record<string, unknown> }[] = [];
  let nativeRow: Record<string, unknown> = {};
  const client = createClient('http://trailbase.test', undefined, {
    trailbase: { tables: { ids: { api: 'ids', primaryKey: 'id', fields: {
      id: { type: 'uuid' }, owner: { type: 'uuid' }, completed: { type: 'boolean' }, priority: { type: 'integer' },
      title: { type: 'text' }, note: { type: 'text', nullable: true },
    } } } },
    global: { fetch: async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: new URL(String(input)), method: init?.method ?? 'GET', body });
      if (init?.method === 'POST') { nativeRow = body; return Response.json({ ids: [nativeRow.id] }); }
      return Response.json({ records: [nativeRow] });
    } },
  });
  for (let index = 0; index < 1000; index++) {
    const id = uuid(), owner = uuid(); generated.add(id); generated.add(owner);
    const priority = [Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER][index % 5];
    const row = { id, owner, completed: index % 2 === 0, priority, title: `literal-${index}-é&+/?#`, note: index % 2 ? null : `note-${index}` };
    const expectedNative = { ...row, id: encode(id), owner: encode(owner), completed: row.completed ? 1 : 0 };
    expect(await client.from('ids').insert(row)).toEqual({ data: null, error: null });
    expect(requests[index * 2].body).toEqual(expectedNative);
    const result = await client.from('ids').select().eq('id', id).eq('owner', owner).eq('completed', row.completed).eq('priority', priority).eq('title', row.title).single();
    expect(result).toEqual({ data: row, error: null });
    const url = requests[index * 2 + 1].url;
    for (const column of ['id', 'owner', 'completed', 'priority', 'title'] as const) {
      expect(url.searchParams.get(`filter[${column}][$eq]`)).toBe(String(expectedNative[column]));
    }
  }
  expect(generated.size).toBe(2000);
  expect(requests).toHaveLength(2000);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1000);
});
it('L1-03/U03 S02 rejects nonportable mutation values and inherited/getter/symbol fields before requests', () => {
  const { client, requests } = setup();
  const table = client.from('todos');
  for (const [column, values] of [
    ['id', ['', '550e8400-e29b-11d4-a716-446655440000', new Uint8Array(16), null]],
    ['completed', [0, 1, 'true', null]],
    ['priority', [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, new Date(), null]],
    ['title', [{}, [], new Date(), null]],
  ] as const) for (const value of values) expect(() => table.insert({ [column]: value })).toThrow(TypeError);
  for (const value of [Object.assign(Object.create({ priority: 7 }), { title: 'x' }), { [Symbol('title')]: 'x' }, Object.defineProperty({}, 'title', { get: () => 'x', enumerable: true }), Object.defineProperty({}, 'title', { value: 'x' })]) expect(() => table.insert(value)).toThrow(TypeError);
  expect(requests).toHaveLength(0);
});
it('L1-01/U01 L1-03/U03 S02 mapping is owned and inherited/malformed mapping shapes are rejected', async () => {
  const { client, requests, mapping } = setup();
  mapping.tables.todos.readOnly = true; mapping.tables.todos.api = 'changed'; mapping.tables.todos.fields.title.type = 'integer';
  expect((await client.from('todos').insert({ title: 'snapshot' })).error).toBeNull();
  expect(requests[0]).toBe('http://trailbase.test/api/records/v1/todos');
  expect(() => Reflect.apply(client.from, client, [Object.create({ toString: () => 'todos' })])).toThrow();
  for (const table of [Object.create({ api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' } } }), { api: 'todos', primaryKey: 'id', fields: Object.create({ id: { type: 'integer' } }) }, { api: 'todos', primaryKey: 'id', fields: { id: Object.create({ type: 'integer' }) } }, { api: 'todos', primaryKey: 'id', readOnly: 'false', fields: { id: { type: 'integer' } } }]) {
    expect(() => Reflect.apply(createClient, undefined, ['http://trailbase.test', undefined, { trailbase: { tables: { todos: table } } }])).toThrow(TypeError);
  }
});
it('L1-03/U03 L1-04/U04 rejects unmapped/incomplete or invalid native response shapes', async () => {
  for (const records of [[{ id: 1 }], [{ id: 1, title: 'ok', completed: 2 }], [{ id: 1, title: 'ok', completed: 0, extra: 'leak' }], [null], 'invalid']) {
    const client = createClient('http://trailbase.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' }, title: { type: 'text' }, completed: { type: 'boolean' } } } } }, global: { fetch: async () => Response.json({ records }) } });
    const result = await client.from('todos').select().single();
    expect(result.data).toBeNull(); expect(result.error?.name).toBe('TypeError');
  }
});
it('L1-06/U06 L1-07/U07 L1-08/U08 S02 unsupported key codecs and adversarial keys cannot reach mutation endpoints', () => {
  let requests = 0;
  for (const field of [{ type: 'text' }, { type: 'boolean' }, { type: 'uuid', nullable: true }, { type: 'integer', nullable: true }] as const) {
    const client = createClient('http://trailbase.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'key', fields: { key: field, title: { type: 'text' } } } } }, global: { fetch: async () => { requests++; return Response.json({ ids: ['ignored'] }); } } });
    expect(() => client.from('todos').insert({ title: 'x' })).toThrow('primary-key');
    expect(() => client.from('todos').update({ title: 'x' })).toThrow('primary-key');
    expect(() => client.from('todos').delete()).toThrow('primary-key');
  }
  const { client, requests: actual } = setup();
  for (const value of ['../other', 'x?filter=x', '#fragment', 'id/child', '', {}, null, undefined]) {
    expect(() => client.from('todos').delete().eq('id', value)).toThrow(TypeError);
  }
  expect(requests).toBe(0); expect(actual).toHaveLength(0);
});
it('L1-03/U03 own scalar fields with prototype-like names retain their values on wire and reads', async () => {
  let sent: Record<string, unknown> = {};
  const fields = JSON.parse('{"id":{"type":"integer"},"__proto__":{"type":"text"}}');
  const client = createClient('http://trailbase.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } }, global: { fetch: async (_input, init) => {
    if (init?.method === 'POST') { sent = JSON.parse(String(init.body)); return Response.json({ ids: ['1'] }); }
    return Response.json({ records: [sent] });
  } } });
  const row = JSON.parse('{"id":1,"__proto__":"literal"}');
  expect((await client.from('todos').insert(row)).error).toBeNull();
  expect(Object.hasOwn(sent, '__proto__')).toBe(true); expect(sent.__proto__).toBe('literal');
  const result = await client.from('todos').select().single();
  expect(result.error).toBeNull(); expect(result.data).toEqual(row); expect(Object.hasOwn(result.data!, '__proto__')).toBe(true);
});
it('L1-09/U09 L1-07/U07 L1-08/U08 S02 extra predicate arguments are not silently ignored', () => {
  const { client, requests } = setup();
  const read = client.from('todos').select();
  for (const name of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']) {
    expect(() => Reflect.apply(Reflect.get(read, name), read, ['priority', 1, { ignored: true }])).toThrow('Unsupported');
  }
  const write = client.from('todos').delete();
  expect(() => Reflect.apply(write.eq, write, ['id', '550e8400-e29b-41d4-a716-446655440000', {}])).toThrow('Unsupported');
  expect(requests).toHaveLength(0);
});

it('L1-03/U03 L1-09/U09 S02 scalar boundary vectors fail writes and filters before any request', () => {
  const { client, requests } = setup();
  for (const [column, values] of [
    ['id', [undefined, 1, false, {}, [], new Date(0), new Uint8Array(16), '', '550e8400-e29b-11d4-a716-446655440000', null]],
    ['completed', [undefined, 0, 1, 'false', {}, new Date(0), new Uint8Array(1), null]],
    ['priority', [undefined, '1', true, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, new Date(0), new Uint8Array(1), null]],
    ['title', [undefined, 1, false, {}, [], new Date(0), new Uint8Array(1), null]],
  ] as const) for (const value of values) {
    expect(() => client.from('todos').insert({ [column]: value })).toThrow();
    const read = client.from('todos').select();
    for (const method of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']) expect(() => Reflect.apply(Reflect.get(read, method), read, [column, value])).toThrow();
  }
  expect(requests).toHaveLength(0);
});
it('L1-03/U03 S02 invalid native UUID/scalar response vectors never fabricate data', async () => {
  const validId = 'VQ6EAOKbQdSnFkRmVUQAAA==';
  for (const [column, values] of [
    ['id', [1, {}, null, 'bad', 'AAAAAAAAAAAAAAAAAAAAAA==']],
    ['completed', [true, false, '0', 2, null]],
    ['priority', ['1', {}, null, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, 1.5]],
    ['title', [1, true, {}, null]],
  ] as const) for (const value of values) {
    const client = createClient('http://trailbase.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' }, completed: { type: 'boolean' }, priority: { type: 'integer' }, title: { type: 'text' } } } } }, global: { fetch: async () => Response.json({ records: [{ id: validId, completed: 0, priority: 0, title: 'valid', [column]: value }] }) } });
    const result = await client.from('todos').select().single();
    expect(result.data).toBeNull(); expect(result.error?.name).toBe('TypeError');
  }
});
