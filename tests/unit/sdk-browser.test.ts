import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

it('L1-27/U27 browser preparation must not statically import its active runner entrypoint', async () => {
  const source = await readFile(new URL('../../scripts/run-sdk-package.mjs', import.meta.url), 'utf8');
  expect(source).not.toMatch(/^import .*from ['"]\.\/run-phase-a\.mjs['"]/m);
});

it('L1-26/E13 packed browser import map guard accepts only complete standalone native graph', async () => {
  const { validateBrowserModules } = await import('../../scripts/sdk-browser.mjs');
  expect(() => validateBrowserModules("import { createClient } from 'trailbase';", 'export const initClient = () => {};')).not.toThrow();
  for (const native of ["import x from 'missing';", "export { x } from 'missing';", "const x = import('missing');"]) expect(() => validateBrowserModules("import x from 'trailbase';", native)).toThrow();
  expect(() => validateBrowserModules("import x from 'other';", 'export {};')).toThrow();
});
it('L1-09/E05 L1-11/E05 example query builds scalar filter, stable order and inclusive caller page', async () => {
  const { queryTodos } = await import('../../examples/todos/app.js');
  const calls: unknown[][] = [];
  const query = { select: (...args: unknown[]) => { calls.push(['select', ...args]); return query; }, eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return query; }, order: (...args: unknown[]) => { calls.push(['order', ...args]); return query; }, range: (...args: unknown[]) => { calls.push(['range', ...args]); return query; }, single: () => { calls.push(['single']); return query; } };
  const client = { from: (name: string) => { calls.push(['from', name]); return query; } };
  queryTodos(client, { table: 'todos', operator: 'eq', field: 'priority', value: '7', order: 'priority', descending: false, page: 2, size: 2, cardinality: 'single' });
  expect(calls).toEqual([['from','todos'],['select','*'],['eq','priority',7],['order','priority',{ascending:true}],['order','id'],['range',4,5],['single']]);
});
it('L1-09/E05 S02 example rejects unsupported filter syntax and boolean coercion', async () => {
  const { queryTodos } = await import('../../examples/todos/app.js');
  const client = { from: () => { throw new Error('Must not construct query'); } };
  for (const options of [{ operator: 'or' }, { field: 'completed', value: '1' }, { page: -1 }]) expect(() => queryTodos(client, { table: 'todos', operator: 'eq', field: 'priority', value: '', order: 'priority', descending: false, page: 0, size: 2, cardinality: 'many', ...options })).toThrow();
});
