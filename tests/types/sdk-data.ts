import { createClient, type QueryResult, type FieldMapping } from '../../src/index.js';

type Row = { id: string; title: string; completed: boolean; priority: number; note: string | null };
type Database = { public: {
  Tables: { todos: { Row: Row; Insert: { id?: string; title: string; completed?: boolean; priority?: number; note?: string | null }; Update: { title?: string; completed?: boolean; priority?: number; note?: string | null }; Relationships: [] } };
  Views: { todos_read: { Row: Row; Relationships: [] } };
  Functions: {};
} };

export async function dataTypes(client: ReturnType<typeof createClient<Database>>) {
  const rows: QueryResult<Row[]> = await client.from('todos').select().eq('completed', true).gte('priority', 0);
  const one: QueryResult<Row> = await client.from('todos').select().single();
  const maybe: QueryResult<Row | null> = await client.from('todos').select().maybeSingle();
  const mutation: QueryResult<null> = await client.from('todos').insert({ title: 'default values', note: null });
  await client.from('todos').update({ completed: false }).eq('id', '550e8400-e29b-41d4-a716-446655440000');
  await client.from('todos').delete().eq('id', '550e8400-e29b-41d4-a716-446655440000');
  const view: QueryResult<Row> = await client.from('todos_read').select().single();
  // @ts-expect-error Required insert field.
  client.from('todos').insert({ note: null });
  // @ts-expect-error Wrong scalar.
  client.from('todos').insert({ title: 'x', completed: 1 });
  // @ts-expect-error Array insert unsupported.
  client.from('todos').insert([{ title: 'x' }]);
  // @ts-expect-error Unknown field.
  client.from('todos').update({ typo: true });
  // @ts-expect-error Primary key not in update shape.
  client.from('todos').update({ id: 'x' });
  // @ts-expect-error Read-only generated view.
  client.from('todos_read').insert({ title: 'x' });
  // @ts-expect-error Read-only generated view.
  client.from('todos_read').update({ title: 'x' });
  // @ts-expect-error Read-only generated view.
  client.from('todos_read').delete();
  // @ts-expect-error Unknown read predicate field.
  client.from('todos').select().eq('unknown', 'x');
  // @ts-expect-error Wrong predicate value type.
  client.from('todos').select().eq('completed', 1);
  // @ts-expect-error Null predicates unsupported.
  client.from('todos').select().eq('note', null);
  // @ts-expect-error Unknown sort field.
  client.from('todos').select().order('unknown');
  // @ts-expect-error Projection unsupported.
  client.from('todos').select('id');
  // @ts-expect-error Count/head unsupported.
  client.from('todos').select('*', { head: true });
  // @ts-expect-error Options unsupported.
  client.from('todos').insert({ title: 'x' }, {});
  // @ts-expect-error Mutation returning unsupported.
  client.from('todos').update({ title: 'x' }).select('*');
  // @ts-expect-error Mutation ordering unsupported.
  client.from('todos').delete().order('id');
  // @ts-expect-error Upsert unsupported.
  client.from('todos').upsert({ title: 'x' });
  // @ts-expect-error Arrays do not match single output.
  const invalid: QueryResult<Row[]> = await client.from('todos').select().single();
  return { rows, one, maybe, mutation, view, invalid };
}

export function validationTypes(client: ReturnType<typeof createClient>) {
  // @ts-expect-error Factory accepts at most three arguments.
  createClient('http://trailbase.test', undefined, undefined, {});
  // @ts-expect-error Exactly one relation argument.
  client.from();
  // @ts-expect-error Additional from arguments unsupported.
  client.from('todos', {});
  // @ts-expect-error Fetch must be a function or undefined.
  createClient('http://trailbase.test', undefined, { trailbase: { tables: {} }, global: { fetch: null } });
  // @ts-expect-error Enum arrays are not field codecs.
  const arrayType: FieldMapping = { type: ['text'] };
  // @ts-expect-error Boxed strings are not field codecs.
  const boxedType: FieldMapping = { type: new String('text') };
  // @ts-expect-error Mapping-level properties are allow-listed.
  createClient('http://trailbase.test', undefined, { trailbase: { tables: {}, typo: true } });
  // @ts-expect-error Table-level readonly typo is not readOnly.
  createClient('http://trailbase.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' } }, readonly: true } } } });
  // @ts-expect-error Field-level properties are allow-listed.
  const extraField: FieldMapping = { type: 'text', unknown: true };
  return { arrayType, boxedType, extraField };
}
