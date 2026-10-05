const operators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
export function queryTodos(client, options) {
  const { table, operator, field, value, order, descending, page, size, cardinality } = options;
  if (!operators.includes(operator) || !['priority', 'title', 'completed'].includes(field) || !['priority', 'title'].includes(order) || !['many', 'single', 'maybeSingle'].includes(cardinality)) throw new TypeError('Unsupported query control');
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 1000 || !Number.isSafeInteger(page * size + size - 1)) throw new TypeError('Invalid page bounds');
  let scalar = value;
  if (value !== '' && field === 'priority') scalar = Number(value);
  if (value !== '' && field === 'completed') {
    if (!['true', 'false'].includes(value)) throw new TypeError('Boolean filter requires true or false');
    scalar = value === 'true';
  }
  let query = client.from(table).select('*');
  if (value !== '') query = query[operator](field, scalar);
  query = query.order(order, { ascending: !descending }).order('id').range(page * size, page * size + size - 1);
  return cardinality === 'many' ? query : query[cardinality]();
}

export function mountTodos(root, client, { ownerId, table = 'todos', makeId = () => crypto.randomUUID(), pageSize = 2 }) {
  if (!root || !client || typeof ownerId !== 'string') throw new TypeError('Explicit client and owner bootstrap required');
  const listeners = new AbortController();
  let disposed = false, page = 0, busy = false;
  root.innerHTML = `<h1>Todos data example</h1><p>Data only: authentication is supplied by the caller.</p>
<form data-action="create"><label>New title <input name="title" required></label><label>New priority <input name="priority" type="number" min="0" step="1" value="0" required></label><button>Add todo</button></form>
<form data-action="query"><label>Filter field <select name="field" aria-label="Filter field"><option>priority</option><option>title</option><option>completed</option></select></label><label>Filter operator <select name="operator" aria-label="Filter operator">${operators.map(op => `<option>${op}</option>`).join('')}</select></label><label>Filter value <input name="value"></label><label>Order field <select name="order" aria-label="Order field"><option>priority</option><option>title</option></select></label><label>Descending <input name="descending" type="checkbox"></label><label>Cardinality <select name="cardinality" aria-label="Cardinality"><option value="many">many</option><option value="single">single</option><option value="maybeSingle">maybeSingle</option></select></label><button>Apply query</button></form>
<button type="button" data-action="refresh">Refresh</button><button type="button" data-action="previous">Previous page</button><button type="button" data-action="next">Next page</button>
<ul aria-label="Todo rows"></ul><p role="status" aria-label="Query status"></p><p role="alert"></p><output aria-label="Mutation result"></output>
<form data-action="update"><label>Update ID <input name="id" required></label><label>Updated title <input name="title" required></label><button>Update todo</button></form>
<form data-action="delete"><label>Delete ID <input name="id" required></label><button>Delete todo</button></form>`;
  const find = selector => root.querySelector(selector);
  const error = find('[role="alert"]'), status = find('[role="status"]'), mutation = find('output');
  function options() {
    const form = find('[data-action="query"]');
    const data = new FormData(form);
    return { table, operator: String(data.get('operator')), field: String(data.get('field')), value: String(data.get('value')), order: String(data.get('order')), descending: data.has('descending'), cardinality: String(data.get('cardinality')), page, size: pageSize };
  }
  async function refresh() {
    const result = await queryTodos(client, options());
    if (disposed) return;
    if (result.error) throw new Error(result.error.message);
    const rows = result.data === null ? [] : Array.isArray(result.data) ? result.data : [result.data];
    const list = find('ul'); list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li'); item.textContent = `${row.title} (priority ${row.priority})`; item.dataset.id = String(row.id); list.append(item);
    }
    status.textContent = result.data === null ? 'Optional row absent' : `Rows: ${rows.length}; page: ${page + 1}`;
  }
  async function run(action) {
    if (disposed || busy) return;
    busy = true; error.textContent = '';
    for (const button of root.querySelectorAll('button')) button.disabled = true;
    try { await action(); }
    catch (failure) { if (!disposed) error.textContent = failure instanceof Error ? failure.message : 'Data operation failed'; }
    finally { busy = false; if (!disposed) for (const button of root.querySelectorAll('button')) button.disabled = false; }
  }
  root.addEventListener('submit', event => {
    event.preventDefault(); const form = event.target; const action = form.dataset.action;
    void run(async () => {
      const data = new FormData(form);
      if (action === 'query') { page = 0; await refresh(); return; }
      const api = client.from(table);
      const result = action === 'create' ? await api.insert({ id: makeId(), user_id: ownerId, title: String(data.get('title')), priority: Number(data.get('priority')) })
        : action === 'update' ? await api.update({ title: String(data.get('title')) }).eq('id', String(data.get('id')))
        : await api.delete().eq('id', String(data.get('id')));
      if (result.error) throw new Error(result.error.message);
      if (result.data !== null) throw new Error('Unexpected mutation result');
      if (disposed) return;
      mutation.textContent = 'Mutation data: null';
      await refresh(); // Explicit UI read; never an SDK read-after-write/replay.
    });
  }, { signal: listeners.signal });
  root.addEventListener('click', event => {
    const action = event.target.dataset?.action;
    if (!['refresh', 'previous', 'next'].includes(action)) return;
    void run(async () => { if (action === 'previous') page = Math.max(0, page - 1); if (action === 'next') page++; await refresh(); });
  }, { signal: listeners.signal });
  return { refresh: () => run(refresh), dispose: () => { disposed = true; listeners.abort(); } };
}
