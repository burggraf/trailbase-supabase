import { createClient, type QueryResult } from '../../src/index.js';

type Database = { public: { Tables: { todos: { Row: { id: string; priority: number } } } } };

// Compile-only consumer: function is never invoked.
export function queryTypes(client: ReturnType<typeof createClient<Database>>) {
  const query = client.from('todos').select().order('priority', { ascending: false }).range(1, 3).limit(2);
  const result: PromiseLike<QueryResult<{ id: string; priority: number }[]>> = query;
  // @ts-expect-error Unsupported table.
  client.from('missing');
  // @ts-expect-error Nullable ordering options are outside the subset.
  query.order('priority', { nullsFirst: true });
  // @ts-expect-error Ascending must be boolean.
  query.order('priority', { ascending: 'false' });
  // @ts-expect-error Referenced-table pagination is unsupported.
  query.limit(2, { referencedTable: 'links' });
  // @ts-expect-error Referenced-table ranges are unsupported.
  query.range(0, 1, { foreignTable: 'links' });
  return result;
}
