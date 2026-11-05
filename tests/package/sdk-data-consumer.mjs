import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createClient } from 'trailbase-supabase';

const entry = fileURLToPath(import.meta.resolve('trailbase-supabase'));
assert.equal(entry, resolve('node_modules/trailbase-supabase/dist/index.js'));
const id = '550e8400-e29b-41d4-a716-446655440000';
const nativeId = 'VQ6EAOKbQdSnFkRmVUQAAA==';
const row = { id: nativeId, title: 'literal&+é', completed: 1, priority: 7, note: null };
const fields = { id: { type: 'uuid' }, title: { type: 'text' }, completed: { type: 'boolean' }, priority: { type: 'integer' }, note: { type: 'text', nullable: true } };
const requests = [];
let records = [row];
let loseReply = false;
let denyRead = false;
const client = createClient('http://trailbase.test', 'unused-placeholder', { trailbase: { tables: {
  todos: { api: 'todos', primaryKey: 'id', fields },
  todos_read: { api: 'todos_read', primaryKey: 'id', fields, readOnly: true },
} }, global: { fetch: async (input, init) => {
  requests.push({ url: new URL(String(input)), method: init?.method ?? 'GET', body: init?.body });
  assert.equal(new Headers(init?.headers).has('authorization'), false);
  if (loseReply) throw new TypeError('Owned injected lost reply');
  if (denyRead) return new Response('Owned native denial', { status: 403 });
  if (init?.method === 'POST') return Response.json({ ids: [nativeId] });
  if (init?.method === 'PATCH' || init?.method === 'DELETE') return new Response(null, { status: 204 });
  return Response.json({ records });
} } });
const table = client.from('todos');
const query = table.select().eq('title', row.title).order('priority').range(2, 2).single();
assert.equal(requests.length, 0);
const first = await query;
assert.deepEqual(first, { data: { ...row, id, completed: true }, error: null });
assert.equal(Object.getPrototypeOf(first.data), Object.prototype);
assert.equal(requests[0].url.searchParams.get('filter[title][$eq]'), row.title);
assert.equal(requests[0].url.searchParams.get('offset'), '2');
assert.equal(requests[0].url.searchParams.get('limit'), '1');
await query; assert.equal(requests.length, 2);
await table.select(); assert.equal(requests[2].url.searchParams.get('offset'), null);
records = [row, row];
assert.equal((await table.select().single()).error?.name, 'CardinalityError');
assert.equal(requests.at(-1).url.searchParams.get('limit'), '1000');
records = [];
assert.deepEqual(await table.select().maybeSingle(), { data: null, error: null });
assert.deepEqual(await table.select().limit(0), { data: [], error: null });
assert.equal(requests.at(-1).url.searchParams.get('limit'), '0');
const insert = table.insert({ id, title: 'insert', completed: true, note: null });
assert.deepEqual(await insert, { data: null, error: null });
assert.deepEqual(JSON.parse(requests.at(-1).body), { id: nativeId, title: 'insert', completed: 1, note: null });
assert.deepEqual(await insert, { data: null, error: null });
assert.deepEqual(await table.update({ title: 'updated' }).eq('id', id), { data: null, error: null });
assert.deepEqual(await table.delete().eq('id', id), { data: null, error: null });
const count = requests.length;
assert.throws(() => table.insert([{ title: 'bulk' }]));
assert.throws(() => table.update({ id }));
assert.throws(() => table.delete().eq('id', id).eq('title', 'extra'));
assert.throws(() => table.select('*', { head: true }));
assert.throws(() => client.from('todos_read').delete());
assert.equal((await table.delete()).error?.name, 'UnsupportedFeatureError');
assert.equal(requests.length, count);
loseReply = true;
assert.equal((await table.insert({ id, title: 'unknown outcome' })).error?.name, 'TypeError');
assert.equal(requests.length, count + 1);
loseReply = false; denyRead = true;
const denied = await table.select().single();
assert.equal(denied.data, null); assert.equal(denied.error?.status, 403); assert.equal(denied.error?.code, undefined);
// Check prototypes here, before any JSON/report serialization can hide a regression.
denyRead = false;
const specialKeys = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'row_setter_probe'];
const specialRow = Object.fromEntries([...Object.entries(row), ...specialKeys.map(key => [key, `own-${key}`])]);
const specialFields = Object.fromEntries([...Object.entries(fields), ...specialKeys.map(key => [key, { type: 'text' }])]);
let rowCalls = 0, setterCalls = 0;
const previousSetter = Object.getOwnPropertyDescriptor(Object.prototype, 'row_setter_probe');
Object.defineProperty(Object.prototype, 'row_setter_probe', { configurable: true, set() { setterCalls++; } });
try {
  const special = createClient('http://trailbase.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: specialFields } } }, global: { fetch: async () => {
    rowCalls++; return Response.json({ records: [specialRow] });
  } } });
  const expected = { ...specialRow, id, completed: true };
  for (const mode of ['list', 'single', 'maybeSingle']) {
    const read = special.from('todos').select();
    const result = await (mode === 'list' ? read : read[mode]());
    assert.equal(result.error, null);
    assert.deepEqual(result.data, mode === 'list' ? [expected] : expected);
    const decoded = mode === 'list' ? result.data[0] : result.data;
    assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
    for (const [key, value] of Object.entries(expected)) {
      assert(Object.hasOwn(decoded, key));
      assert.deepEqual(Object.getOwnPropertyDescriptor(decoded, key), { value, enumerable: true, writable: true, configurable: true });
    }
  }
  assert.equal(rowCalls, 3); assert.equal(setterCalls, 0);
} finally { if (previousSetter) Object.defineProperty(Object.prototype, 'row_setter_probe', previousSetter); else Reflect.deleteProperty(Object.prototype, 'row_setter_probe'); }
console.log('PASS installed-tarball data transport/ordinary-own-row boundaries (not backend/browser proof)');
