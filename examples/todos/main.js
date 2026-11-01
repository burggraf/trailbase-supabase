import { createClient } from './sdk.js';
import { mountAuthTodos } from './app.js';

// Public schema only. The launcher serves the packed SDK beside this same-origin app.
export const client = createClient(location.origin, undefined, {
  trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: {
    id: { type: 'uuid' }, user_id: { type: 'uuid' }, title: { type: 'text' },
    completed: { type: 'boolean' }, priority: { type: 'integer' },
    note: { type: 'text', nullable: true }, created_at: { type: 'integer' },
  } } } },
  auth: { storageKey: 'trailbase-todos-example-v1' },
});
export const ui = mountAuthTodos(document.querySelector('#todos'), client);
