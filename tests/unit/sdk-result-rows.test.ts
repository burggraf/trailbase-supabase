import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { createClient as createReference } from '@supabase/supabase-js';
import { createClient, type FieldMapping } from '../../src/index.js';

// Injected transport comparison with the installed reference, NOT native/backend compatibility proof.
const id = '550e8400-e29b-41d4-a716-446655440000';
const nativeId = 'VQ6EAOKbQdSnFkRmVUQAAA==';
const modes = ['list', 'single', 'maybeSingle'] as const;
const base = { id, completed: true, priority: 7, note: null, title: 'literal&+é' };
const dangerous = Object.fromEntries([...Object.entries(base), ...['__proto__', 'constructor', 'toString', 'hasOwnProperty'].map(key => [key, `own-${key}`])]);
const baseFields: Record<string, FieldMapping> = { id: { type: 'uuid' }, completed: { type: 'boolean' }, priority: { type: 'integer' }, note: { type: 'text', nullable: true }, title: { type: 'text' } };
afterEach(() => vi.restoreAllMocks());

function pair(row: Record<string, unknown>, empty = false) {
  const escaped = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
  const fields = Object.fromEntries(Object.keys(row).map(key => [key, Object.hasOwn(baseFields, key) ? baseFields[key] : { type: 'text' as const }]));
  const calls = { candidate: 0, reference: 0 };
  const candidate = createClient('http://candidate.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } }, global: { fetch: async () => {
    calls.candidate++;
    return Response.json({ records: empty ? [] : [Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'id' ? nativeId : key === 'completed' ? 1 : value]))] });
  } } });
  const reference = createReference('http://reference.test', 'placeholder', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (_input, init) => {
    calls.reference++;
    return Response.json(new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object') ? row : empty ? [] : [row]);
  } } });
  return { candidate, reference, calls, escaped };
}

function ordinaryRow(row: unknown, expected: Record<string, unknown>) {
  assert(row && typeof row === 'object');
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.deepEqual(row, expected);
  assert.deepEqual(Object.keys(row), Object.keys(expected));
  for (const [key, value] of Object.entries(expected)) {
    assert(Object.hasOwn(row, key));
    assert.deepEqual(Object.getOwnPropertyDescriptor(row, key), { value, enumerable: true, writable: true, configurable: true });
  }
}

for (const [kind, row] of [['plain', base], ['prototype-like own keys', dangerous]] as const) for (const mode of modes) {
  it(`L1-04/U04 L1-12/U12 L1-13/U13 ${mode} ${kind}: ordinary row data matches installed Supabase without normalization`, async () => {
    const { candidate, reference, calls, escaped } = pair(row);
    const left = candidate.from('todos').select('*'), right = reference.from('todos').select('*');
    assert.deepEqual(calls, { candidate: 0, reference: 0 });
    const actual = await (mode === 'list' ? left : mode === 'single' ? left.single() : left.maybeSingle());
    const expected = await (mode === 'list' ? right : mode === 'single' ? right.single() : right.maybeSingle());
    assert.equal(actual.error, null); assert.equal(expected.error, null);
    ordinaryRow(Array.isArray(actual.data) ? actual.data[0] : actual.data, row);
    assert.deepEqual(actual.data, expected.data); // Deliberately do not compare/fabricate the wider envelopes.
    assert.deepEqual(calls, { candidate: 1, reference: 1 }); assert.equal(escaped.mock.calls.length, 0);
  });
}

it('L1-13/U13 empty maybeSingle and list retain null/empty data like installed Supabase', async () => {
  const { candidate, reference, calls, escaped } = pair(base, true);
  const a = await candidate.from('todos').select().maybeSingle(), b = await reference.from('todos').select().maybeSingle();
  assert.deepEqual(a, { data: null, error: null }); assert.equal(b.error, null); assert.equal(b.data, null);
  assert.deepEqual((await candidate.from('todos').select()).data, (await reference.from('todos').select()).data);
  assert.deepEqual(calls, { candidate: 2, reference: 2 }); assert.equal(escaped.mock.calls.length, 0);
});

it('L1-04/U04 S02 decoded own fields never invoke inherited setters in either client', async () => {
  const key = 'row_setter_probe'; const previous = Object.getOwnPropertyDescriptor(Object.prototype, key); let setterCalls = 0;
  Object.defineProperty(Object.prototype, key, { configurable: true, set() { setterCalls++; } });
  try {
    const row = Object.fromEntries([...Object.entries(base), [key, 'own-data']]);
    const { candidate, reference, escaped } = pair(row);
    for (const mode of modes) {
      const left = candidate.from('todos').select(), right = reference.from('todos').select();
      const a = await (mode === 'list' ? left : mode === 'single' ? left.single() : left.maybeSingle());
      const b = await (mode === 'list' ? right : mode === 'single' ? right.single() : right.maybeSingle());
      assert.equal(a.error, null); assert.equal(b.error, null); ordinaryRow(Array.isArray(a.data) ? a.data[0] : a.data, row); assert.deepEqual(a.data, b.data);
    }
    assert.equal(setterCalls, 0); assert.equal(escaped.mock.calls.length, 0);
  } finally { if (previous) Object.defineProperty(Object.prototype, key, previous); else Reflect.deleteProperty(Object.prototype, key); }
});

it('L1-04/U04 fresh repeated executions do not share mutable output rows with either client', async () => {
  const { candidate, reference, calls, escaped } = pair(dangerous);
  const left = candidate.from('todos').select().single(), right = reference.from('todos').select().single();
  const first = await left, refFirst = await right; assert(first.data); assert(refFirst.data);
  first.data.title = 'changed'; refFirst.data.title = 'changed';
  const second = await left, refSecond = await right;
  assert.notEqual(first.data, second.data); assert.notEqual(refFirst.data, refSecond.data);
  assert.deepEqual(second.data, refSecond.data); ordinaryRow(second.data, dangerous);
  assert.deepEqual(calls, { candidate: 2, reference: 2 }); assert.equal(escaped.mock.calls.length, 0);
});

it('L1-03/U03 L1-04/U04 S02 invalid later rows never expose partial data or execute accessors', async () => {
  let getterCalls = 0;
  const valid = { id: 1, title: 'valid' };
  // Non-JSON shapes are injected specifically at the decoded-response trust boundary, not claimed as wire JSON.
  const invalid: unknown[] = [null, [], new (class { id = 2; title = 'class'; })(), Object.assign(Object.create({ title: 'inherited' }), { id: 2 }),
    Object.defineProperty({ id: 2 }, 'title', { enumerable: true, get() { getterCalls++; return 'getter'; } }),
    Object.defineProperty({ id: 2 }, 'title', { value: 'hidden' }), { id: 2, title: 'ok', [Symbol('hidden')]: 'hidden' },
    { id: 2 }, { id: 2, title: 'ok', extra: 'unmapped' }, { id: 2, title: 1 }];
  for (const bad of invalid) for (const mode of modes) {
    const client = createClient('http://candidate.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' }, title: { type: 'text' } } } } }, global: { fetch: async () => {
      const response = Response.json({}); Object.defineProperty(response, 'json', { value: async () => ({ records: [valid, bad] }) }); return response;
    } } });
    const query = client.from('todos').select(); const result = await (mode === 'list' ? query : mode === 'single' ? query.single() : query.maybeSingle());
    assert.equal(result.data, null); assert.equal(result.error?.name, 'TypeError');
  }
  assert.equal(getterCalls, 0);
});
