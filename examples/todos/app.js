const taskFilters = ['all', 'active', 'completed'];

export async function loadTaskPage(client, { table = 'todos', filter = 'all', page = 0, pageSize = 20 }) {
  if (!taskFilters.includes(filter) || !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50 || !Number.isSafeInteger(page * pageSize + pageSize)) throw new TypeError('Invalid task page');
  const filtered = (query, kind) => kind === 'all' ? query : query.eq('completed', kind === 'completed');
  const result = await filtered(client.from(table).select('*'), filter).order('created_at', { ascending: false }).order('id').range(page * pageSize, page * pageSize + pageSize);
  if (result.error) throw result.error;
  if (!Array.isArray(result.data)) throw new Error('Invalid task result');
  return { rows: result.data.slice(0, pageSize), hasMore: result.data.length > pageSize };
}

export function taskMutationErrorMessage(failure, saved = false) {
  const status = Number.isInteger(failure?.status) && failure.status >= 400 && failure.status <= 599 ? failure.status : undefined;
  const diagnostic = code => `(${status ? `HTTP ${status}; ` : ''}${code})`;
  if (saved) return `Your change was saved, but the list couldn’t refresh ${diagnostic('TASK_SAVED_REFRESH_FAILED')}. Refresh tasks; if your session is rejected, sign in again. Don’t submit the change again.`;
  if (status === 401) return `Your session was rejected ${diagnostic('TASK_AUTH_REQUIRED')}. Sign out and sign in again before retrying.`;
  if (status === 403) return `This change was not allowed ${diagnostic('TASK_FORBIDDEN')}. Refresh your tasks and check you are signed in to the right account.`;
  if (status === 429) return `The server rejected this request because of a request limit ${diagnostic('TASK_RATE_LIMITED')}. Wait before trying again.`;
  if (status >= 400 && status < 500 && status !== 408) return `The server rejected this change ${diagnostic('TASK_REJECTED')}. Check the task fields or try a different title, then try again.`;
  return `We couldn’t confirm that change ${diagnostic('TASK_OUTCOME_UNKNOWN')}. Refresh your tasks before trying again; it may already have been saved.`;
}

const mark = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.7"/><path d="m8 12 3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function mountAuthTodos(root, client, options = {}) {
  if (options.diagnostics) return mountAuthHarness(root, client, options);
  if (!root || !client?.auth) throw new TypeError('Explicit auth client and root required');
  const listeners = new AbortController();
  let disposed = false, busy = false, mode = 'login', ownerId, tasks;
  root.innerHTML = `<header class="app-header"><a class="brand" href="/sdk-data/index.html"><span class="brand-mark">${mark}</span>Daylist</a><div class="account" hidden><span class="account-email"></span><button type="button" class="quiet-button" data-auth="local">Sign out</button></div></header>
<p class="sr-only" role="status" aria-label="Auth status">Restoring your session</p><p class="auth-activity" role="status" aria-label="Auth activity"></p><p class="error-banner" role="alert" id="todos-auth-error" aria-label="Auth error"></p>
<section class="auth-card"><span class="eyebrow">A LITTLE LESS TO REMEMBER</span><h1>Welcome back.</h1><p class="auth-intro">A clear space for everything you want to get done.</p><div class="confirmation-note" role="note" hidden><strong>Confirm your email, then sign in.</strong><p>Open your message in the private test inbox and follow the confirmation link. Come back here to sign in. Please don’t submit sign-up again while waiting.</p><a class="inbox-link" target="_blank" rel="noopener" hidden>Open test inbox ↗</a></div>
<form data-auth-form><label>Email<input name="email" type="email" autocomplete="username" placeholder="you@example.com" aria-describedby="todos-auth-error" required></label><label>Password<input name="password" type="password" autocomplete="current-password" placeholder="Your password" aria-describedby="todos-auth-error" required></label><p class="password-hint" hidden>Use a disposable password with at least 12 characters. Official TrailBase 0.35.8 signup returns no user/session; this app cannot resend confirmation or repair a pending account.</p><button class="primary-button auth-submit" type="submit">Sign in</button></form><p class="auth-switch"><span>New to Daylist?</span> <button type="button" class="text-button" data-auth-mode>Create an account</button></p></section>
<section class="task-area" hidden></section><details class="account-settings" hidden><summary>Account settings</summary><div><button type="button" class="quiet-button" data-auth="validate">Check sign-in</button><button type="button" class="quiet-button" data-auth="refresh">Refresh session</button><button type="button" class="quiet-button" data-auth="global">Sign out everywhere</button><p>Official TrailBase 0.35.8 cannot authenticate server-wide sign-out acknowledgement. The app reports uncertainty, not success. Signing out above requests only this device’s refresh-session revocation; issued access tokens may remain valid until expiry.</p></div></details>`;
  const find = selector => root.querySelector(selector);
  const status = find('[aria-label="Auth status"]'), error = find('[aria-label="Auth error"]'), activity = find('[aria-label="Auth activity"]'), form = find('[data-auth-form]'), authCard = find('.auth-card'), dataRoot = find('.task-area'), account = find('.account'), settings = find('.account-settings');
  if (globalThis.location?.origin === 'https://aspire.tailb03e.ts.net:18443') { find('.inbox-link').href = 'https://aspire.tailb03e.ts.net:18444/'; find('.inbox-link').hidden = false; }
  function setMode(next) {
    mode = next; error.textContent = ''; find('.confirmation-note').hidden = true;
    authCard.querySelector('h1').textContent = mode === 'login' ? 'Welcome back.' : 'Your list starts here.';
    find('.auth-intro').textContent = mode === 'login' ? 'A clear space for everything you want to get done.' : 'Create an account, confirm your email, and make a little room for what matters.';
    find('.auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
    find('[data-auth-mode]').textContent = mode === 'login' ? 'Create an account' : 'Back to sign in';
    find('.auth-switch span').textContent = mode === 'login' ? 'New to Daylist?' : 'Already have an account?';
    find('.password-hint').hidden = mode === 'login';
    form.elements.namedItem('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    form.elements.namedItem('password').minLength = mode === 'login' ? 1 : 12;
  }
  function render(session) {
    if (disposed) return;
    status.textContent = session ? `Signed in: ${session.user.email ?? session.user.id}` : 'Signed out';
    authCard.hidden = !!session; dataRoot.hidden = !session; account.hidden = !session; settings.hidden = !session;
    find('.account-email').textContent = session?.user.email ?? '';
    if (!session) { settings.open = false; setMode('login'); }
    if (session?.user.id === ownerId) return;
    tasks?.dispose(); tasks = undefined; dataRoot.replaceChildren(); ownerId = session?.user.id;
    if (session) { tasks = mountTodos(dataRoot, client, { ...options, ownerId }); void tasks.refresh(); }
  }
  const subscription = client.auth.onAuthStateChange((_event, session) => render(session)).data.subscription;
  async function run(action) {
    if (disposed || busy) return;
    busy = true; error.textContent = ''; activity.textContent = action === 'signup' ? 'Creating your account…' : action === 'login' ? 'Signing in…' : 'One moment…';
    for (const button of root.querySelectorAll('button[data-auth], [data-auth-mode], .auth-submit')) button.disabled = true;
    try {
      let result;
      if (action === 'signup' || action === 'login') {
        result = await client.auth[action === 'signup' ? 'signUp' : 'signInWithPassword']({ email: form.elements.namedItem('email').value, password: form.elements.namedItem('password').value });
        if (!disposed && !result.error) {
          form.elements.namedItem('password').value = '';
          if (action === 'signup') { setMode('login'); find('.confirmation-note').hidden = false; status.textContent = 'Check your email, confirm, then sign in'; }
        }
      } else if (action === 'local' || action === 'global') result = await client.auth.signOut({ scope: action });
      else if (action === 'validate') result = await client.auth.getUser();
      else result = await client.auth.refreshSession();
      if (result.error) throw result.error;
    } catch (failure) { if (!disposed) error.textContent = authErrorMessage(failure, action); }
    finally { busy = false; if (!disposed) { activity.textContent = ''; for (const button of root.querySelectorAll('button[data-auth], [data-auth-mode], .auth-submit')) button.disabled = false; } }
  }
  root.addEventListener('submit', event => { if (event.target !== form) return; event.preventDefault(); void run(mode === 'login' ? 'login' : 'signup'); }, { signal: listeners.signal });
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || busy) return;
    if (button.hasAttribute('data-auth-mode')) { setMode(mode === 'login' ? 'signup' : 'login'); form.elements.namedItem('email').focus(); }
    else if (button.dataset.auth) void run(button.dataset.auth);
  }, { signal: listeners.signal });
  return { dispose() { if (disposed) return; disposed = true; subscription.unsubscribe(); listeners.abort(); tasks?.dispose(); } };
}

export function mountTodos(root, client, options = {}) {
  if (options.diagnostics) return mountQueryHarness(root, client, options);
  const { ownerId, table = 'todos', makeId = () => crypto.randomUUID(), pageSize = 20 } = options;
  if (!root || !client || typeof ownerId !== 'string') throw new TypeError('Explicit client and owner bootstrap required');
  const listeners = new AbortController();
  let disposed = false, busy = false, page = 0, filter = 'all', rows = [], hasMore = false, editing, pendingDelete;
  root.innerHTML = `<div class="task-heading"><div><span class="eyebrow">ONE THING AT A TIME</span><h1>My tasks</h1><p>A little focus goes a long way.</p></div><button type="button" class="refresh-button" data-task-action="refresh" aria-label="Refresh tasks" title="Refresh tasks">↻</button></div>
<form class="add-task" data-task-form="add"><label class="sr-only" for="new-task">New task</label><input id="new-task" name="title" placeholder="What needs to get done?" autocomplete="off" maxlength="1000" required><button class="primary-button" type="submit"><span aria-hidden="true">＋</span> Add task</button></form>
<div class="task-toolbar"><div role="tablist" aria-label="Task filters">${taskFilters.map((kind, index) => `<button type="button" role="tab" data-filter="${kind}" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}">${kind[0].toUpperCase() + kind.slice(1)}</button>`).join('')}</div><span class="task-activity" role="status" aria-label="Task activity"></span></div>
<p class="error-banner" role="alert" aria-label="Task error"></p><ul class="task-list" aria-label="Tasks"></ul><div class="empty-state" hidden><span class="empty-mark">${mark}</span><h2>A fresh start.</h2><p>No tasks yet. Add your first one above.</p></div><p class="sr-only" role="status" aria-label="Task update"></p><nav class="pagination" aria-label="Task pages" hidden><button type="button" class="quiet-button" data-task-action="previous">Previous tasks</button><span></span><button type="button" class="quiet-button" data-task-action="next">Next tasks</button></nav>
<dialog aria-labelledby="delete-heading" class="delete-dialog"><h2 id="delete-heading">Delete task?</h2><p class="delete-title"></p><p>This task will be permanently removed. This can’t be undone.</p><div class="dialog-actions"><button type="button" class="quiet-button" data-task-action="cancel-delete" autofocus>Cancel</button><button type="button" class="danger-button" data-task-action="confirm-delete">Delete task</button></div></dialog>`;
  const find = selector => root.querySelector(selector), list = find('.task-list'), input = find('#new-task'), error = find('[aria-label="Task error"]'), activity = find('[aria-label="Task activity"]'), update = find('[aria-label="Task update"]'), dialog = find('dialog');
  function controls() {
    root.setAttribute('aria-busy', String(busy)); activity.textContent = busy ? 'Loading…' : '';
    for (const control of root.querySelectorAll('button, input')) control.disabled = busy;
    find('[data-task-action="previous"]').disabled = busy || page === 0;
    find('[data-task-action="next"]').disabled = busy || !hasMore;
  }
  function renderRows() {
    list.replaceChildren();
    for (const task of rows) {
      const item = document.createElement('li'); item.dataset.id = task.id; item.className = `task-row${task.completed ? ' is-complete' : ''}`;
      if (editing === task.id) {
        item.innerHTML = '<form class="edit-task" data-task-form="edit"><input class="edit-title" aria-label="Task title" name="edited-title" maxlength="1000" required><button class="primary-button" type="submit">Save</button><button type="button" class="quiet-button" data-task-action="cancel-edit">Cancel</button></form>';
        item.querySelector('.edit-title').value = task.title;
      } else {
        item.innerHTML = '<label class="task-check"><input type="checkbox"></label><span class="task-title" data-task-title></span><div class="row-actions"><button type="button" class="row-button" data-task-action="edit">Edit</button><button type="button" class="row-button delete-button" data-task-action="delete">Delete</button></div>';
        item.querySelector('[data-task-title]').textContent = task.title;
        const checkbox = item.querySelector('input'); checkbox.checked = task.completed; checkbox.setAttribute('aria-label', `Complete ${task.title}`);
        item.querySelector('[data-task-action="edit"]').setAttribute('aria-label', `Edit task: ${task.title}`);
        item.querySelector('[data-task-action="delete"]').setAttribute('aria-label', `Delete task: ${task.title}`);
      }
      list.append(item);
    }
  }
  async function read() {
    let result = await loadTaskPage(client, { table, filter, page, pageSize }); if (disposed) return;
    if (page > 0 && !result.rows.length) { page--; result = await loadTaskPage(client, { table, filter, page, pageSize }); if (disposed) return; }
    rows = result.rows; hasMore = result.hasMore; renderRows();
    for (const kind of taskFilters) { const tab = find(`[data-filter="${kind}"]`); tab.setAttribute('aria-selected', String(kind === filter)); tab.tabIndex = kind === filter ? 0 : -1; }
    const empty = find('.empty-state'); empty.hidden = rows.length !== 0;
    empty.querySelector('h2').textContent = filter === 'all' ? 'A fresh start.' : filter === 'active' ? 'You’re all caught up.' : 'Nothing completed yet.';
    empty.querySelector('p').textContent = filter === 'all' ? 'No tasks yet. Add your first one above.' : filter === 'active' ? 'Take a breath. Your active list is clear.' : 'Check off a task and celebrate a little progress.';
    find('.pagination').hidden = page === 0 && !hasMore; find('.pagination span').textContent = `Page ${page + 1}`;
  }
  async function run(operation, success = '') {
    if (disposed || busy) return false;
    busy = true; error.textContent = ''; controls(); let saved = false;
    try {
      if (operation) { const result = await operation(); if (result.error) throw result.error; if (result.data !== null) throw new Error('Unexpected mutation result'); saved = true; editing = undefined; }
      await read(); if (!disposed) update.textContent = success; return operation ? saved : true;
    } catch (failure) {
      if (!disposed) error.textContent = operation ? taskMutationErrorMessage(failure, saved) : 'We couldn’t load your tasks. Check your connection and choose Refresh.';
      return saved;
    } finally { busy = false; if (!disposed) controls(); }
  }
  function chooseFilter(next) { if (busy || !taskFilters.includes(next)) return; filter = next; page = 0; editing = undefined; void run().then(() => { if (!disposed) find(`[data-filter="${filter}"]`).focus(); }); }
  root.addEventListener('submit', event => {
    const form = event.target; if (!form.dataset.taskForm) return; event.preventDefault(); if (busy || disposed) return;
    const field = form.querySelector('input'), title = field.value.trim(); field.setCustomValidity(title ? '' : 'Enter a task title.'); if (!form.reportValidity()) return;
    if (form.dataset.taskForm === 'add') void run(() => client.from(table).insert({ id: makeId(), user_id: ownerId, title, priority: 0 }), 'Task added.').then(saved => { if (saved && !disposed) { input.value = ''; input.focus(); } });
    else { const id = form.closest('li').dataset.id; void run(() => client.from(table).update({ title }).eq('id', id), 'Task updated.').then(() => { if (!disposed) input.focus(); }); }
  }, { signal: listeners.signal });
  root.addEventListener('input', event => { if (event.target instanceof HTMLInputElement) event.target.setCustomValidity(''); }, { signal: listeners.signal });
  root.addEventListener('change', event => {
    const checkbox = event.target; if (busy || disposed || checkbox.type !== 'checkbox') return;
    const task = rows.find(task => task.id === checkbox.closest('li').dataset.id); if (!task) return;
    const completed = checkbox.checked; void run(() => client.from(table).update({ completed }).eq('id', task.id), completed ? 'Task completed.' : 'Task moved to active.').then(saved => { if (!saved && !disposed) checkbox.checked = task.completed; });
  }, { signal: listeners.signal });
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || busy || disposed) return;
    if (button.dataset.filter) { chooseFilter(button.dataset.filter); return; }
    const action = button.dataset.taskAction, task = rows.find(task => task.id === button.closest('li')?.dataset.id);
    if (action === 'refresh') void run();
    else if (action === 'previous' || action === 'next') { page += action === 'previous' ? -1 : 1; editing = undefined; void run(); }
    else if (action === 'edit' && task) { editing = task.id; renderRows(); const field = find('.edit-title'); field.focus(); field.select(); }
    else if (action === 'cancel-edit') { editing = undefined; renderRows(); input.focus(); }
    else if (action === 'delete' && task) { pendingDelete = task.id; find('.delete-title').textContent = task.title; dialog.showModal(); }
    else if (action === 'cancel-delete') { dialog.close(); pendingDelete = undefined; }
    else if (action === 'confirm-delete' && pendingDelete) { const id = pendingDelete; pendingDelete = undefined; dialog.close(); void run(() => client.from(table).delete().eq('id', id), 'Task deleted.').then(() => { if (!disposed) input.focus(); }); }
  }, { signal: listeners.signal });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target.closest('.edit-task')) { event.preventDefault(); editing = undefined; renderRows(); input.focus(); }
    const tab = event.target.closest('[data-filter]'); if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const index = taskFilters.indexOf(tab.dataset.filter); chooseFilter(taskFilters[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
  }, { signal: listeners.signal });
  return { refresh: async () => { await run(); }, dispose() { disposed = true; listeners.abort(); if (dialog.open) dialog.close(); } };
}

const operators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];

export function authErrorMessage(failure, action) {
  const status = Number.isInteger(failure?.status) && failure.status >= 400 && failure.status <= 599 ? failure.status : undefined;
  if (action === 'login' && status === 401) return 'Sign-in rejected (HTTP 401). Check the email and password and confirm the signup email in the test inbox. Accounts from other apps or earlier disposable runs are not available here.';
  if (status === 401 && ['refresh', 'validate'].includes(action)) return 'Your session was rejected (HTTP 401). Sign in again.';
  if (failure?.name === 'AuthGlobalSignOutUnconfirmedError') return 'Global sign-out could not be authenticated. Local state was cleared, but server-wide revocation remains unconfirmed.';
  if (action === 'signup' && status === 409) return 'Sign-up was rejected (HTTP 409). No new registration or verification email is confirmed. Check any earlier signup message; do not repeatedly register. This app has no confirmation resend or automatic account repair.';
  if (action === 'signup' && status === 424) return 'Confirmation delivery failed (HTTP 424). A pending registration may remain on official TrailBase 0.35.8; retrying can return HTTP 409. Do not repeatedly sign up. This app cannot resend confirmation or repair the account.';
  if (status === 429) return 'Too many authentication requests (HTTP 429). Wait before retrying; do not repeatedly submit sign-up.';
  if (status >= 500) return `The authentication service could not complete the request (HTTP ${status}). Try again later; do not repeatedly submit sign-up.`;
  if (status) return `Authentication request was rejected (HTTP ${status}). Check the app requirements and test inbox. If signing up, do not repeatedly register a pending address.`;
  return 'Authentication could not be completed. Check your connection and Tailscale, then try again. If it persists, report the operation and HTTP status without sharing credentials.';
}

function mountAuthHarness(root, client, options = {}) {
  if (!root || !client?.auth) throw new TypeError('Explicit auth client and root required');
  const listeners = new AbortController();
  let disposed = false, busy = false, ownerId, todos;
  root.innerHTML = `<h1>Todos with password auth</h1>
<form data-auth="credentials"><label>Email <input name="email" type="email" autocomplete="username" aria-describedby="todos-auth-error" required></label><label>Password <input name="password" type="password" autocomplete="current-password" aria-describedby="todos-auth-error" required></label><button data-auth="signup">Sign up</button><button data-auth="login">Sign in</button></form>
<button type="button" data-auth="validate">Validate user</button><button type="button" data-auth="refresh">Refresh session</button><button type="button" data-auth="local">Sign out locally</button><button type="button" data-auth="global">Sign out everywhere</button>
<p role="note">This test app has no confirmation resend or account repair. Signup is not a signed-in session; global sign-out remains unconfirmed on official TrailBase 0.35.8.</p><p role="status" aria-label="Auth status">Initializing session</p><p role="status" aria-label="Auth activity"></p><p role="alert" id="todos-auth-error" aria-label="Auth error"></p><section aria-label="Authenticated todos"></section>`;
  const status = root.querySelector('[aria-label="Auth status"]'), activity = root.querySelector('[aria-label="Auth activity"]'), error = root.querySelector('[aria-label="Auth error"]'), dataRoot = root.querySelector('section');
  function render(session) {
    if (disposed) return;
    status.textContent = session ? `Signed in: ${session.user.email ?? session.user.id}` : 'Signed out';
    const nextOwner = session?.user.id;
    if (nextOwner === ownerId) return;
    todos?.dispose(); todos = undefined; dataRoot.replaceChildren(); ownerId = nextOwner;
    if (session) { todos = mountQueryHarness(dataRoot, client, { ...options, ownerId }); void todos.refresh(); }
  }
  const subscription = client.auth.onAuthStateChange((_event, session) => { render(session); }).data.subscription;
  async function run(action) {
    if (disposed || busy) return;
    busy = true; error.textContent = ''; activity.textContent = 'Working…';
    const buttons = [...root.querySelectorAll('button[data-auth]')];
    for (const button of buttons) button.disabled = true;
    try {
      let result;
      if (action === 'signup' || action === 'login') {
        const form = root.querySelector('[data-auth="credentials"]'), data = new FormData(form);
        result = await client.auth[action === 'signup' ? 'signUp' : 'signInWithPassword']({ email: String(data.get('email')), password: String(data.get('password')) });
        if (!disposed && !result.error && action === 'signup') status.textContent = 'Check your email, confirm, then sign in';
        if (!disposed && !result.error && action === 'login') form.elements.namedItem('password').value = '';
      } else if (action === 'local' || action === 'global') result = await client.auth.signOut({ scope: action });
      else if (action === 'validate') result = await client.auth.getUser();
      else result = await client.auth.refreshSession();
      if (result.error) throw result.error;
    } catch (failure) { if (!disposed) error.textContent = authErrorMessage(failure, action); }
    finally { busy = false; if (!disposed) { activity.textContent = ''; for (const button of buttons) button.disabled = false; } }
  }
  root.addEventListener('submit', event => {
    if (event.target.dataset.auth !== 'credentials') return;
    event.preventDefault(); void run(event.submitter?.dataset.auth ?? 'login');
  }, { signal: listeners.signal });
  root.addEventListener('click', event => {
    const action = event.target.dataset?.auth;
    if (['validate', 'refresh', 'local', 'global'].includes(action)) void run(action);
  }, { signal: listeners.signal });
  return { dispose() { if (disposed) return; disposed = true; subscription.unsubscribe(); listeners.abort(); todos?.dispose(); } };
}

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

function mountQueryHarness(root, client, { ownerId, table = 'todos', makeId = () => crypto.randomUUID(), pageSize = 2 }) {
  if (!root || !client || typeof ownerId !== 'string') throw new TypeError('Explicit client and owner bootstrap required');
  const listeners = new AbortController();
  let disposed = false, page = 0, busy = false;
  root.innerHTML = `<h2>Your todos</h2><p>Choose a row to edit or select for deletion, then submit the corresponding form. Writes affect only the explicit ID.</p>
<form data-action="create"><label>New title <input name="title" required></label><label>New priority <input name="priority" type="number" min="0" step="1" value="0" required></label><button>Add todo</button></form>
<form data-action="query"><label>Filter field <select name="field" aria-label="Filter field"><option>priority</option><option>title</option><option>completed</option></select></label><label>Filter operator <select name="operator" aria-label="Filter operator">${operators.map(op => `<option>${op}</option>`).join('')}</select></label><label>Filter value <input name="value"></label><label>Order field <select name="order" aria-label="Order field"><option>priority</option><option>title</option></select></label><label>Descending <input name="descending" type="checkbox"></label><label>Cardinality <select name="cardinality" aria-label="Cardinality"><option value="many">many</option><option value="single">single</option><option value="maybeSingle">maybeSingle</option></select></label><button>Apply query</button></form>
<button type="button" data-action="refresh">Refresh</button><button type="button" data-action="previous">Previous page</button><button type="button" data-action="next">Next page</button>
<p role="status" aria-label="Query activity"></p><ul aria-label="Todo rows"></ul><p role="status" aria-label="Query status"></p><p role="alert" aria-label="Data error"></p><output aria-label="Mutation result"></output>
<form data-action="update"><label>Update ID <input name="id" required></label><label>Updated title <input name="title" required></label><button>Update todo</button></form>
<form data-action="delete"><label>Delete ID <input name="id" required></label><button>Delete todo</button></form>`;
  const find = selector => root.querySelector(selector);
  const error = find('[role="alert"]'), status = find('[aria-label="Query status"]'), activity = find('[aria-label="Query activity"]'), mutation = find('output');
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
      const item = document.createElement('li'); item.dataset.id = String(row.id);
      const summary = document.createElement('span'); summary.dataset.rowSummary = ''; summary.textContent = `${row.title} (priority ${row.priority})`;
      const id = document.createElement('code'); id.textContent = String(row.id);
      item.append(summary, id);
      for (const [action, label] of [['edit', 'Edit'], ['delete', 'Choose delete']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `${label} ${row.title}`;
        button.dataset.rowAction = action; button.dataset.id = String(row.id); button.dataset.title = row.title; item.append(button);
      }
      list.append(item);
    }
    status.textContent = result.data === null ? 'Optional row absent' : `Rows: ${rows.length}; page: ${page + 1}`;
  }
  async function run(action) {
    if (disposed || busy) return;
    busy = true; error.textContent = ''; activity.textContent = 'Working…'; root.setAttribute('aria-busy', 'true');
    for (const button of root.querySelectorAll('button')) button.disabled = true;
    try { await action(); }
    catch (failure) { if (!disposed) error.textContent = failure instanceof Error ? failure.message : 'Data operation failed'; }
    finally { busy = false; if (!disposed) { activity.textContent = ''; root.setAttribute('aria-busy', 'false'); for (const button of root.querySelectorAll('button')) button.disabled = false; } }
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
    const row = event.target.closest('button[data-row-action]');
    if (row && !disposed && !busy) {
      const form = find(`[data-action="${row.dataset.rowAction === 'edit' ? 'update' : 'delete'}"]`);
      form.elements.namedItem('id').value = row.dataset.id;
      if (row.dataset.rowAction === 'edit') { form.elements.namedItem('title').value = row.dataset.title; form.elements.namedItem('title').focus(); }
      else form.querySelector('button').focus();
      return;
    }
    const action = event.target.dataset?.action;
    if (!['refresh', 'previous', 'next'].includes(action)) return;
    void run(async () => { if (action === 'previous') page = Math.max(0, page - 1); if (action === 'next') page++; await refresh(); });
  }, { signal: listeners.signal });
  return { refresh: () => run(refresh), dispose: () => { disposed = true; listeners.abort(); } };
}
