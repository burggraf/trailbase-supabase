import { expect, it } from 'vitest';
import { createClient, type ClientOptions } from '../../src/index.js';
import { normalizeError, uuidFromNative } from '../../src/common.js';

const mapping: ClientOptions['trailbase'] = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'integer' } } } } };
it('L1-01/S01 RQ01 explicit public schema succeeds; unknown schema/config/origin shapes fail before transport', () => {
  let requests = 0;
  const options: ClientOptions = { trailbase: mapping, global: { fetch: async () => { requests++; return Response.json({ records: [] }); } } };
  expect(createClient('http://trailbase.test', undefined, { ...options, db: { schema: 'public' } })).toBeTruthy();
  for (const db of [{ schema: 'private' }, {}, { schema: 'public', typo: true }]) expect(() => createClient('http://trailbase.test', undefined, { ...options, db } as ClientOptions)).toThrow();
  for (const url of ['not a URL', 'ftp://trailbase.test', 'https://name:password@trailbase.test', 'https://trailbase.test/path', 'https://trailbase.test/?key=value', 'https://trailbase.test/#fragment']) expect(() => createClient(url, undefined, options)).toThrow(TypeError);
  const invalidMappings = [
    { tables: {} },
    { tables: { todos: { ...mapping.tables.todos, fields: {} } } },
    { tables: { todos: { ...mapping.tables.todos, readOnly: 'yes' } } },
    { tables: { todos: { ...mapping.tables.todos, api: 'bad/path' } } },
  ];
  for (const trailbase of invalidMappings) expect(() => createClient('http://trailbase.test', undefined, { ...options, trailbase } as ClientOptions)).toThrow(TypeError);
  expect(() => Reflect.apply(createClient, null, ['http://trailbase.test', 1, options])).toThrow(TypeError);
  expect(() => createClient('http://trailbase.test', undefined, { ...options, global: { typo: true } } as ClientOptions)).toThrow('Unsupported global client option');
  const client = createClient('http://trailbase.test', undefined, options);
  expect(() => Reflect.apply(client.from, null, [null])).toThrow(TypeError);
  expect(() => client.from('todos').select().order('missing')).toThrow('Unmapped order field');
  expect(requests).toBe(0);
});
it('L1-03/L1-04/S02 RQ01 invalid base64 and non-Error transport failures remain errors, never successful data', async () => {
  expect(() => uuidFromNative('@@@')).toThrow('Invalid native UUID bytes');
  expect(normalizeError('transport failed')).toEqual({ name: 'Error', message: 'transport failed' });
  const client = createClient('http://trailbase.test', undefined, { trailbase: mapping, global: { fetch: async () => { throw 'transport failed'; } } });
  expect(await client.from('todos').select()).toEqual({ data: null, error: { name: 'Error', message: 'transport failed' } });
});
