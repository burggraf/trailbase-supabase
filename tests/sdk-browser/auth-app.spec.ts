import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmEmail, supabase } from '../phase-a/helpers.js';
import { createClient } from '../../src/index.js';
import { withCleanup } from './cleanup.js';

declare global { interface Window { sdkAuthApp?: { client: ReturnType<typeof createClient>; ui: { dispose(): void } } } }

for (const backend of ['trailbase', 'supabase'] as const) test(`L1-14–20/E02–08/E13 packed auth todos app real signup/mail/CRUD/reload/refresh/local logout [${backend}]`, async ({ page }) => {
  const env = await context(), email = `auth-app-${randomUUID()}@example.test`, password = `Fixture-${randomUUID()}-Aa1!`, id = randomUUID();
  const ownedKey = `auth-app-${randomUUID()}`, unrelatedKey = `unrelated-${randomUUID()}`;
  const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
  const native = createClient(env.trailUrl, undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false } }), reference = supabase(env);
  const ordinary = { auth: backend === 'trailbase' ? native.auth : reference.auth, from: (name: string) => backend === 'trailbase' ? native.from(name) : reference.from(name) };
  const title = `owned-${id}`; let rowAttempted = false;
  async function mount() {
    await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
    if (backend === 'supabase') await page.addScriptTag({ url: `${env.trailUrl}/fixtures/supabase.js` });
    expect(await page.evaluate(async ({ base, backend, url, key, ownedKey, unrelatedKey, mapping, id }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const app: typeof import('../../examples/todos/app.js') = await import(`${base}/sdk-data/app.js`);
      const options = { auth: { persistSession: true, autoRefreshToken: false, storageKey: ownedKey, detectSessionInUrl: false as const }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) }) } };
      const client = backend === 'trailbase' ? sdk.createClient(url, undefined, { ...options, trailbase: mapping }) : window.supabase.createClient(url, key, options);
      localStorage.setItem(unrelatedKey, 'keep');
      const ui = app.mountAuthTodos(document.querySelector('#todos'), client, { diagnostics: true, makeId: () => id });
      // This structural bridge is test-only; primary browser calls use the actual packed/reference clients.
      window.sdkAuthApp = { client: client as ReturnType<typeof sdk.createClient>, ui };
      return true;
    }, { base: env.trailUrl, backend, url: backend === 'trailbase' ? env.trailUrl : env.supabaseUrl, key: backend === 'supabase' ? env.anonKey : '', ownedKey, unrelatedKey, mapping, id })).toBe(true);
  }
  async function cleanupRow() {
    const before = await ordinary.from('todos').select('*').eq('id', id).maybeSingle();
    expect(before.error).toBeNull();
    if (before.data !== null) expect((await ordinary.from('todos').delete().eq('id', id)).error).toBeNull();
    const after = await ordinary.from('todos').select('*').eq('id', id);
    expect(after.error).toBeNull(); expect(after.data).toEqual([]);
  }
  await withCleanup(async () => {
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await mount(); await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText('Signed out');
    await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText('Check your email, confirm, then sign in');
    await expect(page.getByRole('note')).toContainText('no confirmation resend or account repair');
    if (backend === 'trailbase') {
      const duplicate = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/v1/register' && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();
      expect((await duplicate).status()).toBe(409);
      await expect(page.getByRole('alert', { name: 'Auth error' })).toContainText('Sign-up was rejected (HTTP 409). No new registration or verification email is confirmed.');
      expect(await page.evaluate(async () => (await window.sdkAuthApp!.client.auth.getSession()).data.session)).toBeNull();
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('alert', { name: 'Auth error' })).not.toBeEmpty();
    await confirmEmail(env, email);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText(`Signed in: ${email}`);
    await page.getByLabel('New title', { exact: true }).fill(title); await page.getByLabel('New priority', { exact: true }).fill('1'); rowAttempted = true; await page.getByRole('button', { name: 'Add todo', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Todo rows' })).toContainText(title);
    expect((await ordinary.auth.signInWithPassword({ email, password })).error).toBeNull();
    const inserted = await ordinary.from('todos').select('*').eq('id', id).single(); expect(inserted.error).toBeNull(); expect(inserted.data?.title).toBe(title);
    await mount(); await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText(`Signed in: ${email}`); await expect(page.getByRole('list', { name: 'Todo rows' })).toContainText(title);
    await page.getByRole('button', { name: 'Validate user', exact: true }).click(); await expect(page.getByRole('alert', { name: 'Auth error' })).toBeEmpty();
    await page.getByRole('button', { name: 'Refresh session', exact: true }).click(); await expect(page.getByRole('button', { name: 'Refresh session', exact: true })).toBeEnabled();
    await page.getByLabel('Update ID', { exact: true }).fill(id); await page.getByLabel('Updated title', { exact: true }).fill(`updated-${title}`); await page.getByRole('button', { name: 'Update todo', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Todo rows' })).toContainText(`updated-${title}`);
    const updated = await ordinary.from('todos').select('*').eq('id', id).single(); expect(updated.error).toBeNull(); expect(updated.data).toEqual({ ...inserted.data, title: `updated-${title}` });
    await page.getByLabel('Delete ID', { exact: true }).fill(id); await page.getByRole('button', { name: 'Delete todo', exact: true }).click(); await expect(page.getByRole('list', { name: 'Todo rows' }).getByRole('listitem')).toHaveCount(0);
    expect((await ordinary.from('todos').select('*').eq('id', id)).data).toEqual([]);
    await cleanupRow(); // Exercise already-absent cleanup before recreating the owned row.
    // Repeat one create so signed-out UI/authorization cannot hide an owned row.
    await page.getByLabel('New title', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Add todo', exact: true }).click(); await expect(page.getByRole('list', { name: 'Todo rows' })).toContainText(title);
    const recreated = await ordinary.from('todos').select('*').eq('id', id).single(); expect(recreated.error).toBeNull();
    await page.getByRole('button', { name: 'Sign out locally', exact: true }).click(); await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText('Signed out');
    await expect(page.getByRole('list', { name: 'Todo rows' })).toHaveCount(0);
    expect(await page.evaluate(({ ownedKey, unrelatedKey }) => !localStorage.getItem(ownedKey) && localStorage.getItem(unrelatedKey) === 'keep', { ownedKey, unrelatedKey })).toBe(true);
    expect(await page.evaluate(async () => !!(await window.sdkAuthApp!.client.from('todos').select('*')).error)).toBe(true);
    const after = await ordinary.from('todos').select('*').eq('id', id).single(); expect(after.error).toBeNull(); expect(after.data).toEqual(recreated.data);
    await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText(`Signed in: ${email}`);
    await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).click(); await expect(page.getByRole('button', { name: 'Sign out everywhere', exact: true })).toBeEnabled();
    await expect(page.getByRole('status', { name: 'Auth status', exact: true })).toHaveText('Signed out');
    if (backend === 'trailbase') await expect(page.getByRole('alert', { name: 'Auth error' })).toContainText('could not be authenticated');
    else await expect(page.getByRole('alert', { name: 'Auth error' })).toBeEmpty();
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(async () => { if (window.sdkAuthApp) { window.sdkAuthApp.ui.dispose(); await window.sdkAuthApp.client.auth.signOut({ scope: 'local' }); delete window.sdkAuthApp; } }); },
    async () => { if (!page.isClosed()) await page.evaluate(({ ownedKey, unrelatedKey }) => { localStorage.removeItem(ownedKey); localStorage.removeItem(unrelatedKey); }, { ownedKey, unrelatedKey }); },
    async () => { const login = await ordinary.auth.signInWithPassword({ email, password }); if (login.error && rowAttempted) throw new Error('Owned browser row cleanup could not authenticate'); if (!login.error) { await cleanupRow(); expect((await ordinary.auth.signOut({ scope: 'local' })).error).toBeNull(); } },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
