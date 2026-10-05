import { expect, it } from 'vitest';
import { createClient, type TrailBaseMapping } from '../../src/index.js';

const nativeId = 'VQ6EAOKbQdSnFkRmVUQAAA==';
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' }, title: { type: 'text' } } } } } satisfies TrailBaseMapping;
function constructorArgs(trailbase: unknown = mapping, global: unknown = { fetch: async () => Response.json({ ids: [nativeId] }) }) {
  return ['http://trailbase.test', undefined, { trailbase, global }];
}

it('L1-03/U03 S02 mapping field.type must be a primitive enum, never coerced', () => {
  let requests = 0;
  for (const type of [['text'], new String('text'), ['integer'], new String('uuid'), null, 0, {}, 'unknown']) {
    const invalid = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' }, title: { type } } } } };
    expect(() => Reflect.apply(createClient, undefined, constructorArgs(invalid, { fetch: async () => { requests++; return Response.json({ ids: [nativeId] }); } }))).toThrow(TypeError);
  }
  expect(requests).toBe(0);
});

it('L1-01/U01 L1-03/U03 S02 rejects every unknown mapping property including readonly typo', () => {
  let requests = 0;
  const invalid = [
    { ...mapping, unknown: true },
    { tables: { todos: { ...mapping.tables.todos, readonly: true } } },
    { tables: { todos: { ...mapping.tables.todos, unknown: true } } },
    { tables: { todos: { ...mapping.tables.todos, fields: { ...mapping.tables.todos.fields, title: { type: 'text', unknown: true } } } } },
  ];
  for (const trailbase of invalid) expect(() => Reflect.apply(createClient, undefined, constructorArgs(trailbase, { fetch: async () => { requests++; return Response.json({ ids: [nativeId] }); } }))).toThrow('Unsupported');
  expect(requests).toBe(0);
});

it('L1-01/U01 S02 factory/from arity and every defined nonfunction fetch fail before wire', () => {
  let requests = 0;
  const fetcher = async () => { requests++; return Response.json({ ids: [nativeId] }); };
  expect(() => Reflect.apply(createClient, undefined, [...constructorArgs(mapping, { fetch: fetcher }), {}])).toThrow('Unsupported');
  const client = createClient('http://trailbase.test', undefined, { trailbase: mapping, global: { fetch: fetcher } });
  expect(() => Reflect.apply(client.from, client, [])).toThrow('Unsupported');
  expect(() => Reflect.apply(client.from, client, ['todos', {}])).toThrow('Unsupported');
  for (const fetch of [null, false, 0, '', {}, [], 'not a function']) expect(() => Reflect.apply(createClient, undefined, constructorArgs(mapping, { fetch }))).toThrow(TypeError);
  expect(requests).toBe(0);
});

it('L1-04/U04 L1-06/U06 malformed create acknowledgements are errors after exactly one POST, no read/replay', async () => {
  const integerMapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' }, title: { type: 'text' } } } } } satisfies TrailBaseMapping;
  for (const [trailbase, bodies] of [
    [mapping, [{ ids: { 0: nativeId } }, { ids: [nativeId, nativeId] }, { ids: [] }, { ids: [null] }, { ids: [1] }, { ids: [{}] }, { ids: ['ignored'] }, { ids: [nativeId.slice(0, -2)] }, { ids: [nativeId.replaceAll('=', '')] }, { ids: ['AAAAAAAAAAAAAAAAAAAAAA=='] }, null, {}, 'invalid json']],
    [integerMapping, [{ ids: '123' }, { ids: { 0: '1' } }, { ids: ['1', '2'] }, { ids: [] }, { ids: [null] }, { ids: [1] }, { ids: [''] }, { ids: ['01'] }, { ids: ['-0'] }, { ids: ['+1'] }, { ids: ['1.0'] }, { ids: ['1e2'] }, { ids: ['9007199254740992'] }, { ids: [' 1'] }, { ids: [true] }, { ids: [{}] }, 'invalid json']],
  ] as const) for (const body of bodies) {
    const requests: string[] = [];
    const client = createClient('http://trailbase.test', undefined, { trailbase, global: { fetch: async (_input, init) => {
      requests.push(init?.method ?? 'GET');
      return typeof body === 'string' ? new Response(body, { headers: { 'content-type': 'application/json' } }) : Response.json(body);
    } } });
    const result = await client.from('todos').insert({ title: 'one write' });
    expect(result.data).toBeNull(); expect(result.error).not.toBeNull(); expect(requests).toEqual(['POST']);
  }
});

it('L1-06/U06 validates actual padded UUID and canonical decimal-string integer acknowledgements before discard', async () => {
  for (const [type, ids] of [['uuid', [nativeId]], ['integer', ['0', '-1', String(Number.MAX_SAFE_INTEGER), String(Number.MIN_SAFE_INTEGER)]]] as const) for (const id of ids) {
    const requests: string[] = [];
    const client = createClient('http://trailbase.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type }, title: { type: 'text' } } } } }, global: { fetch: async (_input, init) => { requests.push(init?.method ?? 'GET'); expect(new Headers(init?.headers).get('content-type')).toBe('application/json'); return Response.json({ ids: [id] }); } } });
    expect(await client.from('todos').insert({ title: 'one write' })).toEqual({ data: null, error: null });
    expect(requests).toEqual(['POST']);
  }
});
