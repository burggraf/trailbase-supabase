import { expect, it } from 'vitest';
import { createClient } from '../../src/index.js';

function setup(rows: unknown[]) {
  const requests: URL[] = [];
  const client = createClient('http://trailbase.test', undefined, {
    trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' }, title: { type: 'text' } } } } },
    global: { fetch: async input => { requests.push(new URL(String(input))); return Response.json({ records: rows }); } },
  });
  return { table: client.from('todos'), requests };
}
for (const count of [0, 1, 2, 61, 1000]) {
  it(`L1-12/U12 L1-13/U13 cardinality for ${count} rows, without implicit truncation`, async () => {
    const rows = Array.from({ length: count }, (_, id) => ({ id, title: `row-${id}` }));
    const { table, requests } = setup(rows);
    const single = await table.select().single();
    const maybe = await table.select().maybeSingle();
    if (count === 1) {
      expect(single).toEqual({ data: rows[0], error: null }); expect(maybe).toEqual(single);
    } else {
      expect(single.data).toBeNull(); expect(single.error?.name).toBe('CardinalityError'); expect(single.error?.status).toBeUndefined(); expect(single.error?.code).toBeUndefined();
      if (count === 0) expect(maybe).toEqual({ data: null, error: null });
      else { expect(maybe.data).toBeNull(); expect(maybe.error?.name).toBe('CardinalityError'); }
    }
    expect(requests).toHaveLength(2);
    expect(requests.every(url => url.searchParams.get('limit') === '1000')).toBe(true);
  });
}
it('L1-12/U12 L1-13/U13 cardinality retains caller bounds, mutable state and builder isolation', async () => {
  const { table, requests } = setup([{ id: 1, title: 'one' }]);
  const query = table.select().range(5, 8).single().limit(1);
  expect((await query).data).toEqual({ id: 1, title: 'one' });
  await query.limit(2).maybeSingle();
  await table.select();
  expect(requests.map(url => [url.searchParams.get('offset'), url.searchParams.get('limit')])).toEqual([['5', '1'], ['5', '2'], [null, '1000']]);
});
it('L1-05/U05 S02 rejects select/count/head and inherited/unmapped responses', async () => {
  const { table, requests } = setup([{ id: 1, title: 'one', unknown: 'leak' }]);
  for (const options of [{ count: 'exact' }, { head: true }, {}, Object.create({ head: true })]) {
    expect(() => Reflect.apply(table.select, table, ['*', options])).toThrow('Unsupported');
  }
  expect(() => Reflect.apply(table.select, table, ['id'])).toThrow('Only select');
  expect(() => Reflect.apply(table.select().single, table.select(), [{}])).toThrow('Unsupported');
  expect(requests).toHaveLength(0);
  const result = await table.select().single();
  expect(result.data).toBeNull(); expect(result.error?.message).toContain('unmapped field');
});
it('L1-12/U12 preserves backend errors ahead of cardinality', async () => {
  const client = createClient('http://trailbase.test', undefined, {
    trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' } } } } },
    global: { fetch: async () => new Response('native denied', { status: 403 }) },
  });
  const result = await client.from('todos').select().single();
  expect(result.data).toBeNull(); expect(result.error?.status).toBe(403); expect(result.error?.message).toContain('native denied');
});
