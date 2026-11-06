import { expect, it } from 'vitest';
import { createClient, type TrailBaseMapping } from '../../src/index.js';

const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: {
  id: { type: 'integer' }, title: { type: 'text' },
} } } } satisfies TrailBaseMapping;
const operators = [
  ['eq', '$eq'], ['neq', '$ne'], ['gt', '$gt'],
  ['gte', '$gte'], ['lt', '$lt'], ['lte', '$lte'],
] as const;
const origin = 'http://sdk-filter-unit.invalid';
const seed = 0x19c0ffee;

// Fixed Unicode scalar values: this tests encoding, not collation or malformed UTF-16 policy.
const alphabet = ['a', ' ', '+', '&', '=', '?', '#', '%', '/', '\\', '[', ']', '"', "'", '\0', '\r', '\n', 'é', 'e\u0301', '中', '🦄'];
let state = seed;
const generated = Array.from({ length: 64 }, () => Array.from({ length: 24 }, () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return alphabet[state % alphabet.length];
}).join(''));
const values = [
  '', 'a&b + c', '%2F%26%3D%23', 'x&limit=1000&offset=7',
  'x&filter[id][$eq]=999', 'x&filter[$or][0][id][$eq]=999',
  'x#fragment', '?order=-id', '../other?title=x', 'https://foreign.invalid/path',
  '\0\r\n&Authorization=not-a-credential', 'é/e\u0301/中/🦄', ...generated,
];
const sorted = (entries: Iterable<[string, string]>) => [...entries].sort(([left], [right]) => left.localeCompare(right));

for (const [method, operator] of operators) for (const limit of [0, 7]) for (const repeated of [false, true]) {
  it(`L1-09/U09 S02 literal encoding ${method} limit=${limit} indexed=${repeated} seed=${seed}`, async () => {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const client = createClient(origin, undefined, { trailbase: mapping, global: { fetch: async (input, init) => {
      requests.push({ url: new URL(input instanceof Request ? input.url : String(input)), init });
      // Unit transport only; no backend filtering/permission success is simulated as integration proof.
      return Response.json({ records: [] });
    } } });
    for (const [index, value] of values.entries()) {
      const query = client.from('todos').select().limit(limit).order('id');
      query[method]('title', value);
      if (repeated) query[method]('title', 'independent & control + 中');
      expect(requests, `lazy case=${index}`).toHaveLength(index);
      expect(await query, `result case=${index}`).toEqual({ data: [], error: null });
      expect(requests, `one request case=${index}`).toHaveLength(index + 1);
      const { url, init } = requests[index];
      expect([url.origin, url.pathname, url.hash, url.username, url.password]).toEqual([
        origin, '/api/records/v1/todos', '', '', '',
      ]);
      const filters: [string, string][] = repeated ? [
        [`filter[$and][0][title][${operator}]`, value],
        [`filter[$and][1][title][${operator}]`, 'independent & control + 中'],
      ] : [[`filter[title][${operator}]`, value]];
      // Compare every decoded parameter, not just get(first), so added/dropped duplicates cannot hide.
      expect(sorted(url.searchParams), `parameters case=${index} seed=${seed}`).toEqual(sorted([
        ['limit', String(limit)], ['order', '+id'], ...filters,
      ]));
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
    }
  });
}
