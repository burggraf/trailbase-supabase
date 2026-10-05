import { expect, it } from 'vitest';

const id = '550e8400-e29b-41d4-a716-446655440000';
const owner = '9b2f7d5a-d8b3-4a6b-8c21-9a03d74351ef';

type Result = { data: unknown; error: unknown };
type Client = { from(table: string): { select(columns: string): PromiseLike<Result> } };

it('L1-01/U01 exports the createClient factory', async () => {
  const sdk = await import('../../src/index.js');
  expect(Object.hasOwn(sdk, 'createClient')).toBe(true);
  expect(typeof Reflect.get(sdk, 'createClient')).toBe('function');
});

it('L1-01/U01 L1-03/U03 L1-05/U05 select is lazy and maps declared TrailBase fields', async () => {
  const sdk = await import('../../src/index.js');
  const factory = Reflect.get(sdk, 'createClient');
  expect(typeof factory).toBe('function');
  if (typeof factory !== 'function') return;

  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const client = Reflect.apply(factory, undefined, ['http://trailbase.test', undefined, {
    trailbase: {
      tables: {
        todos: {
          api: 'todos',
          primaryKey: 'id',
          fields: {
            id: { type: 'uuid' },
            user_id: { type: 'uuid' },
            title: { type: 'text' },
            completed: { type: 'boolean' },
            priority: { type: 'integer' },
            note: { type: 'text', nullable: true },
            created_at: { type: 'integer' },
          },
        },
      },
    },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        requests.push({ url: new URL(requestUrl), init });
        const encodeUuid = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex').toString('base64').replaceAll('+', '-').replaceAll('/', '_');
        return Response.json({ records: [{ id: encodeUuid(id), user_id: encodeUuid(owner), title: 'write tests', completed: 1, priority: 7, note: null, created_at: 123 }] });
      },
    },
  }]) as Client;

  const query = client.from('todos').select('*');
  expect(requests).toHaveLength(0);
  const result = await query;
  expect(result.error).toBeNull();
  expect(result.data).toEqual([{ id, user_id: owner, title: 'write tests', completed: true, priority: 7, note: null, created_at: 123 }]);
  expect(requests).toHaveLength(1);
  expect(requests[0].url.pathname).toBe('/api/records/v1/todos');
  expect(requests[0].url.searchParams.get('limit')).toBe('1000');
});
