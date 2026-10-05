import { expect, it } from 'vitest';
import { queryTodos } from '../../examples/todos/app.js';

it('L1-09/E05 example routes all six operators and exact title/boolean scalars without coercing text', () => {
  for (const operator of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']) {
    for (const [field, value, scalar] of [['priority', '1', 1], ['title', 'literal-é&+', 'literal-é&+'], ['completed', 'false', false]] as const) {
      const calls: unknown[][] = [];
      const query: Record<string, unknown> = {};
      for (const name of ['select', 'order', 'range', 'single', 'maybeSingle', ...['eq', 'neq', 'gt', 'gte', 'lt', 'lte']]) query[name] = (...args: unknown[]) => { calls.push([name, ...args]); return query; };
      queryTodos({ from: () => query }, { table: 'todos', operator, field, value, order: 'priority', descending: true, page: 1, size: 2, cardinality: 'maybeSingle' });
      expect(calls).toEqual([['select', '*'], [operator, field, scalar], ['order', 'priority', { ascending: false }], ['order', 'id'], ['range', 2, 3], ['maybeSingle']]);
    }
  }
});
