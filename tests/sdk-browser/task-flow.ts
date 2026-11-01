import { test, expect, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { withCleanup } from './cleanup.js';

export async function taskFlow(browser: Browser, origin: string, confirm: (email: string) => Promise<void>) {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const pages = [await contexts[0].newPage(), await contexts[1].newPage()];
  const users = ['a', 'b'].map(label => ({ email: `tasks-${label}-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!`, confirmed: false }));
  const prefix = `agent-ui-${randomUUID().slice(0, 8)}`;
  const titles = ['Plan the week', 'Pick up groceries', 'Make time for a walk', 'Keep my private note', 'Plan the week ahead', 'After reload', 'After refresh', 'After short idle'].map(title => `${prefix} ${title}`);
  const createIds = new Set<string>();
  let foreignRequest = false, pageError = false;
  const rows = (page: Page): Promise<Record<string, unknown>[]> => page.evaluate(async () => {
    const { client } = await import(`${location.origin}/sdk-data/main.js`);
    const result = await client.from('todos').select('*').order('id');
    if (result.error) throw new Error('Owned task read failed');
    return result.data;
  });
  async function login(page: Page, user: typeof users[number], password: string, stage: string, status: number) {
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const sent = page.waitForRequest(request => new URL(request.url()).pathname === '/api/auth/v1/login' && request.method() === 'POST');
    const received = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/v1/login' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const request = await sent, payload = request.postDataJSON(), response = await received;
    expect({ origin: new URL(request.url()).origin, fields: Object.keys(payload).sort(), emailMatches: payload.email_or_username === user.email, passwordMatches: payload.password === password, json: request.headers()['content-type']?.startsWith('application/json') }).toEqual({ origin, fields: ['email_or_username', 'password'], emailMatches: true, passwordMatches: true, json: true });
    expect(response.status()).toBe(status);
    test.info().annotations.push({ type: 'auth-stage', description: `${stage}: HTTP ${status}; own same-origin JSON payload verified` });
    if (status === 401) {
      // WebKit does not expose bodies for these empty401 resources; status and safe UI remain asserted on every engine.
      if (browser.browserType().name() !== 'webkit') expect((await response.body()).length).toBe(0);
      await expect(page.getByRole('alert', { name: 'Auth error' })).toContainText('Sign-in rejected (HTTP 401)');
      await expect(page.getByRole('alert', { name: 'Auth error' })).not.toContainText('FetchError');
    } else await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText(`Signed in: ${user.email}`);
  }
  const createResponse = (page: Page) => page.waitForResponse(response => new URL(response.url()).pathname === '/api/records/v1/todos' && response.request().method() === 'POST');
  async function add(page: Page, title: string, fast = false) {
    await page.getByLabel('New task', { exact: true }).fill(title);
    const received = createResponse(page);
    await page.getByLabel('New task', { exact: true }).press('Enter');
    if (fast) await page.keyboard.press('Enter');
    const response = await received;
    expect(response.status()).toBe(200);
    const request = response.request(), payload = request.postDataJSON(), headers = await request.allHeaders();
    expect(createIds.has(payload.id)).toBe(false); createIds.add(payload.id);
    expect(await page.evaluate(async ({ payload, token }) => {
      const { client } = await import(`${location.origin}/sdk-data/main.js`);
      const { uuidToNative } = await import(`${location.origin}/sdk-data/common.js`);
      const session = (await client.auth.getSession()).data.session;
      const claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
      return { ownerMapped: payload.user_id === uuidToNative(session.user.id), tokenCurrent: token === session.access_token, notExpired: claims.exp * 1000 > Date.now(), jwtOwner: claims.sub === payload.user_id, fields: Object.keys(payload).sort() };
    }, { payload, token: headers.authorization?.replace(/^Bearer /, '') ?? '' })).toEqual({ ownerMapped: true, tokenCurrent: true, notExpired: true, jwtOwner: true, fields: ['id', 'priority', 'title', 'user_id'] });
    test.info().annotations.push({ type: 'task-mutation', description: 'UI add HTTP200; fresh ID, mapped owner, current unexpired JWT/subject and exact payload verified' });
    await expect(page.getByRole('list', { name: 'Tasks', exact: true })).toContainText(title);
    await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeEnabled();
    await expect(page.getByLabel('New task', { exact: true })).toHaveValue('');
    await expect(page.locator('[aria-label="Task error"]')).toBeEmpty();
  }
  const row = (page: Page, title: string) => page.getByRole('listitem').filter({ has: page.locator('[data-task-title]').filter({ hasText: title }) });
  await withCleanup(async () => {
    for (const [index, page] of pages.entries()) {
      page.on('request', request => { if (new URL(request.url()).origin !== origin || request.headers().apikey || new URL(request.url()).pathname.includes('/admin')) foreignRequest = true; });
      page.on('pageerror', () => { pageError = true; });
      await page.goto(`${origin}/`);
      await expect(page).toHaveURL(`${origin}/sdk-data/index.html`);
      await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
      expect(await page.evaluate(() => isSecureContext && typeof crypto.randomUUID === 'function')).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (index === 0) await page.screenshot({ path: resolve('.runtime', `todos-redesign-signin-${browser.browserType().name()}.png`), fullPage: true });
      await login(page, users[index], users[index].password, 'missing account', 401);
      await page.getByRole('button', { name: 'Create an account', exact: true }).click();
      await page.getByLabel('Password', { exact: true }).fill(users[index].password);
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText('Check your email, confirm, then sign in');
      await expect(page.getByText('Confirm your email, then sign in.', { exact: true })).toBeVisible();
      await login(page, users[index], users[index].password, 'unconfirmed account', 401);
      await confirm(users[index].email); users[index].confirmed = true;
      await login(page, users[index], 'Wrong-password-Aa1!', 'wrong password after confirmation', 401);
      await login(page, users[index], users[index].password, 'confirmed correct password', 200);
      await expect(page.getByRole('heading', { name: 'My tasks', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'A fresh start.', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
      await add(page, index ? titles[3] : titles[0]);
    }
    const [a, b] = pages;
    await add(a, titles[1]); await add(a, titles[2], true);
    const beforeDuplicate = await rows(a), rejected = createResponse(a);
    await a.getByLabel('New task', { exact: true }).fill(titles[0]);
    await a.getByLabel('New task', { exact: true }).press('Enter');
    expect((await rejected).status()).toBe(400);
    await expect(a.getByRole('alert', { name: 'Task error', exact: true })).toContainText('HTTP 400; TASK_REJECTED');
    await expect(a.getByRole('alert', { name: 'Task error', exact: true })).not.toContainText('may already have been saved');
    expect(await rows(a)).toEqual(beforeDuplicate);
    test.info().annotations.push({ type: 'task-mutation', description: 'Own same-title HTTP400; full owner rows unchanged; safe rejection code, no backend body/global-title inference' });
    await a.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
    await expect(a.locator('[aria-label="Task error"]')).toBeEmpty();
    const aBefore = await rows(a), bBefore = await rows(b);
    expect(aBefore).toHaveLength(3); expect(bBefore).toHaveLength(1);
    expect(await a.evaluate(async () => {
      const { client } = await import(`${location.origin}/sdk-data/main.js`);
      const result = await client.from('todos').select('*').order('created_at', { ascending: false }).order('id').range(20, 40);
      return !result.error && result.data.length === 0;
    })).toBe(true);
    expect(aBefore[0].user_id).not.toBe(bBefore[0].user_id);
    expect(await b.evaluate(async ({ id, owner, ownId, spoofId }) => {
      const { client } = await import(`${location.origin}/sdk-data/main.js`);
      const read = await client.from('todos').select('*').eq('id', id);
      const update = await client.from('todos').update({ title: 'forbidden' }).eq('id', id);
      const remove = await client.from('todos').delete().eq('id', id);
      const spoof = await client.from('todos').insert({ id: spoofId, user_id: owner, title: 'forbidden', priority: 0 });
      const transfer = await client.from('todos').update({ user_id: owner }).eq('id', ownId);
      return !read.error && read.data.length === 0 && [update, remove, spoof, transfer].every(result => result.error?.status === 403);
    }, { id: aBefore[0].id, owner: aBefore[0].user_id, ownId: bBefore[0].id, spoofId: randomUUID() })).toBe(true);
    expect(await rows(a)).toEqual(aBefore); expect(await rows(b)).toEqual(bBefore);
    await row(a, titles[0]).getByRole('button', { name: `Edit task: ${titles[0]}`, exact: true }).click();
    await a.getByLabel('Task title', { exact: true }).fill(`${prefix} cancel this edit`);
    await a.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await rows(a)).toEqual(aBefore);
    await row(a, titles[0]).getByRole('button', { name: `Edit task: ${titles[0]}`, exact: true }).click();
    await expect(a.getByLabel('Task title', { exact: true })).toBeFocused();
    await a.getByLabel('Task title', { exact: true }).fill(titles[4]);
    await a.getByLabel('Task title', { exact: true }).press('Enter');
    await expect(row(a, titles[4])).toBeVisible();
    await a.getByRole('checkbox', { name: `Complete ${titles[1]}`, exact: true }).check();
    await expect(a.getByRole('checkbox', { name: `Complete ${titles[1]}`, exact: true })).toBeChecked();
    await a.getByRole('tab', { name: 'Completed', exact: true }).click();
    await expect(a.getByRole('list', { name: 'Tasks', exact: true }).getByRole('listitem')).toHaveCount(1);
    await expect(row(a, titles[1])).toBeVisible();
    await a.getByRole('tab', { name: 'Active', exact: true }).click();
    await expect(a.getByRole('list', { name: 'Tasks', exact: true }).getByRole('listitem')).toHaveCount(2);
    await a.getByRole('tab', { name: 'All', exact: true }).click();
    await expect(a.getByRole('list', { name: 'Tasks', exact: true }).getByRole('listitem')).toHaveCount(3);
    await a.getByRole('checkbox', { name: `Complete ${titles[1]}`, exact: true }).uncheck();
    await expect.poll(async () => (await rows(a)).find(task => task.title === titles[1])?.completed).toBe(false);
    await a.getByRole('checkbox', { name: `Complete ${titles[1]}`, exact: true }).check();
    await expect.poll(async () => (await rows(a)).find(task => task.title === titles[1])?.completed).toBe(true);
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.screenshot({ path: resolve('.runtime', `todos-redesign-tasks-${browser.browserType().name()}.png`), fullPage: true });
    const current = await rows(a);
    expect(current).toEqual(aBefore.map(task => ({ ...task, ...(task.title === titles[0] ? { title: titles[4] } : {}), ...(task.title === titles[1] ? { completed: true } : {}) })));
    await row(a, titles[2]).getByRole('button', { name: `Delete task: ${titles[2]}`, exact: true }).click();
    await expect(a.getByRole('dialog', { name: 'Delete task?', exact: true })).toBeVisible();
    await expect(a.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await a.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await rows(a)).toEqual(current);
    await row(a, titles[2]).getByRole('button', { name: `Delete task: ${titles[2]}`, exact: true }).click();
    await a.getByRole('button', { name: 'Delete task', exact: true }).click();
    await expect(row(a, titles[2])).toHaveCount(0);
    expect(await rows(a)).toEqual(current.filter(task => task.title !== titles[2]));
    expect(await rows(b)).toEqual(bBefore);
    await a.reload(); await expect(row(a, titles[4])).toBeVisible();
    expect(await a.evaluate(() => {
      const imports = JSON.parse(document.querySelector('script[type="importmap"]')!.textContent!).imports;
      const versioned = imports['/sdk-data/app.js'];
      return /^\/sdk-data\/app\.js\?v=[a-f0-9]{64}$/.test(versioned) && performance.getEntriesByType('resource').some(entry => entry.name === new URL(versioned, location.origin).href);
    })).toBe(true);
    await add(a, titles[5]);
    await a.getByText('Account settings', { exact: true }).click();
    await a.getByRole('button', { name: 'Refresh session', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Refresh session', exact: true })).toBeEnabled();
    await expect(a.locator('[aria-label="Auth error"]')).toBeEmpty();
    await expect(a.locator('[aria-label="Auth error"]')).toBeHidden();
    await a.getByText('Account settings', { exact: true }).click();
    await add(a, titles[6]);
    // Deliberately idle briefly (not a readiness wait); no server TTL/config or session state manipulation.
    await a.waitForTimeout(1100);
    await add(a, titles[7]);
    // Abort one real GET deterministically; Firefox offline emulation may serve a cached response.
    await a.route(url => url.pathname === '/api/records/v1/todos', route => route.abort('internetdisconnected'), { times: 1 });
    await a.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
    await expect(a.getByRole('alert', { name: 'Task error', exact: true })).not.toBeEmpty();
    await a.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
    await expect(a.locator('[aria-label="Task error"]')).toBeEmpty();
    await expect(a.locator('[aria-label="Task error"]')).toBeHidden();
    await a.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    await expect(a.getByRole('list', { name: 'Tasks', exact: true })).toHaveCount(0);
    expect(await rows(b)).toEqual(bBefore);
    expect(foreignRequest).toBe(false); expect(pageError).toBe(false);
  }, pages.map((page, index) => async () => {
    try {
      await page.context().setOffline(false);
      if (!users[index].confirmed) return;
      expect(await page.evaluate(async ({ user, titles }) => {
        const { client, ui } = await import(`${location.origin}/sdk-data/main.js`); ui.dispose();
        const login = await client.auth.signInWithPassword({ email: user.email, password: user.password });
        if (login.error) throw new Error('Owned UI cleanup login failed');
        const current = await client.from('todos').select('*');
        if (current.error) throw new Error('Owned UI cleanup read failed');
        for (const task of current.data) {
          if (task.user_id !== login.data.user.id || !titles.includes(task.title)) throw new Error('Refusing non-owned UI cleanup row');
          if ((await client.from('todos').delete().eq('id', task.id)).error) throw new Error('Owned UI cleanup delete failed');
        }
        const after = await client.from('todos').select('*'), logout = await client.auth.signOut({ scope: 'local' });
        return !after.error && after.data.length === 0 && !logout.error;
      }, { user: users[index], titles })).toBe(true);
    } finally { await contexts[index].close(); }
  }));
}
