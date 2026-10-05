import { expect, it } from 'vitest';
import { createClient, type TrailBaseMapping } from '../../src/index.js';

const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: {
  id: { type: 'uuid' }, user_id: { type: 'uuid' }, title: { type: 'text' }, completed: { type: 'boolean' },
  priority: { type: 'integer' }, note: { type: 'text', nullable: true }, created_at: { type: 'integer' },
} } } } satisfies TrailBaseMapping;

function makeClient(requests: URL[], respond: () => Response = () => Response.json({ records: [] })) {
  return createClient('http://trailbase.test', undefined, {
    trailbase: mapping,
    global: { fetch: async input => {
      requests.push(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
      return respond();
    } },
  });
}

it('L1-09/U09 adds mapped eq filter through TrailBase structured query', async () => {
  const requests: URL[] = [];
  const query = makeClient(requests).from('todos').select('*');
  const eq = Reflect.get(query, 'eq');
  expect(typeof eq).toBe('function');
  if (typeof eq !== 'function') return;

  Reflect.apply(eq, query, ['title', 'a&b + c']);
  expect(await query).toEqual({ data: [], error: null });
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('filter[title][$eq]')).toBe('a&b + c');
  expect(requests[0].searchParams.has('order')).toBe(false);
});

it('L1-09/U09 supports all six scalar filters with safe value encoding', async () => {
  const requests: URL[] = [];
  const query = makeClient(requests).from('todos').select('*');
  for (const [method, args] of [
    ['eq', ['title', 'a&b + c']], ['neq', ['title', 'other']], ['gt', ['priority', 2]],
    ['gte', ['priority', 3]], ['lt', ['priority', 9]], ['lte', ['priority', 8]],
  ] as const) {
    const operation = Reflect.get(query, method);
    expect(typeof operation).toBe('function');
    if (typeof operation === 'function') Reflect.apply(operation, query, [...args]);
  }
  expect(await query).toEqual({ data: [], error: null });
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('filter[title][$eq]')).toBe('a&b + c');
  expect(requests[0].searchParams.get('filter[title][$ne]')).toBe('other');
  expect(requests[0].searchParams.get('filter[priority][$gt]')).toBe('2');
  expect(requests[0].searchParams.get('filter[priority][$gte]')).toBe('3');
  expect(requests[0].searchParams.get('filter[priority][$lt]')).toBe('9');
  expect(requests[0].searchParams.get('filter[priority][$lte]')).toBe('8');
});

it('L1-10/U10 L1-11/U11 orders fields and uses inclusive ranges with last effective bounds', async () => {
  const requests: URL[] = [];
  const query = makeClient(requests).from('todos').select('*');
  for (const [method, args] of [
    ['order', ['priority', { ascending: false }]], ['order', ['title']], ['limit', [10]], ['range', [2, 4]],
  ] as const) {
    const operation = Reflect.get(query, method);
    expect(typeof operation).toBe('function');
    if (typeof operation === 'function') Reflect.apply(operation, query, [...args]);
  }
  expect(await query).toEqual({ data: [], error: null });
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('order')).toBe('-priority,+title');
  expect(requests[0].searchParams.get('offset')).toBe('2');
  expect(requests[0].searchParams.get('limit')).toBe('3');
});

it('L1-11/U11 zero limit sends a genuine zero-width page with filters and order', async () => {
  const requests: URL[] = [];
  const query = makeClient(requests).from('todos').select().eq('title', 'a&b + c').order('title').limit(0);
  expect(requests).toHaveLength(0);
  expect(await query).toEqual({ data: [], error: null });
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('limit')).toBe('0');
  expect(requests[0].searchParams.get('filter[title][$eq]')).toBe('a&b + c');
  expect(requests[0].searchParams.get('order')).toBe('+title');
});

it('L1-11/U11 zero limit preserves backend permission errors rather than fabricating empty success', async () => {
  const requests: URL[] = [];
  const query = makeClient(requests, () => new Response('denied', { status: 403 })).from('todos').select().limit(0);
  const result = await query;
  expect(result.data).toBeNull();
  expect(result.error?.status).toBe(403);
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('limit')).toBe('0');
});

it('L1-11/U11 positive offset plus zero limit returns adapter range error without request', async () => {
  const requests: URL[] = [];
  const result = await makeClient(requests).from('todos').select().range(2, 4).limit(0);
  expect(result.data).toBeNull();
  expect(result.error).toMatchObject({ name: 'RangeError' });
  expect(result.error?.status).toBeUndefined();
  expect(requests).toHaveLength(0);
});

it('L1-04/U04 L1-11/U11 repeated awaits use current bounds while independent builders isolate', async () => {
  const requests: URL[] = [];
  const table = makeClient(requests).from('todos');
  const query = table.select().range(5, 9).limit(2);
  await query;
  await query.limit(3);
  await query.range(1, 1);
  await table.select();
  expect(requests.map(url => [url.searchParams.get('offset'), url.searchParams.get('limit')])).toEqual([
    ['5', '2'], ['5', '3'], ['1', '1'], [null, '1000'],
  ]);
});

it('L1-10/U10 L1-11/U11 S02 rejects invalid options and bounds before requests', () => {
  const requests: URL[] = [];
  const query = makeClient(requests).from('todos').select();
  for (const value of [-1, 0.5, NaN, Infinity, 1001, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => query.limit(value)).toThrow(TypeError);
  }
  for (const [from, to] of [[-1, 1], [2, 1], [0, 1000], [0, Number.MAX_SAFE_INTEGER], [NaN, 1], [0, Infinity], [0.5, 1], [0, Number.MAX_SAFE_INTEGER + 1]]) {
    expect(() => query.range(from, to)).toThrow(TypeError);
  }
  expect(() => query.order('missing')).toThrow('Unmapped order field');
  expect(() => query.order('note')).toThrow('Nullable ordering');
  expect(() => Reflect.apply(query.order, query, ['title', { nullsFirst: true }])).toThrow('Unsupported order option');
  expect(() => Reflect.apply(query.order, query, ['title', { referencedTable: 'links' }])).toThrow('Unsupported order option');
  expect(() => Reflect.apply(query.order, query, ['title', { ascending: 'false' }])).toThrow(TypeError);
  expect(() => Reflect.apply(query.limit, query, [1, { referencedTable: 'links' }])).toThrow('Unsupported');
  expect(() => Reflect.apply(query.range, query, [0, 1, { foreignTable: 'links' }])).toThrow('Unsupported');
  expect(requests).toHaveLength(0);
});
