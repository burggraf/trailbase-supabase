import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { context, confirmedTrailUser, canonicalUuid } from '../phase-a/helpers.js';
import { withCleanup } from './cleanup.js';

test('L1-16/E06 packed genuine password auth localStorage reload and owned-key isolation (no auth app/lifecycle claim)', async ({ page }) => {
  const env = await context(); let user: Awaited<ReturnType<typeof confirmedTrailUser>> | undefined;
  const unrelated = `unrelated-${randomUUID()}`, ownedKey = `trailbase-supabase.auth:${new URL(env.trailUrl).origin}`;
  await withCleanup(async () => {
    user = await confirmedTrailUser(env, 'packed-storage');
    await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    await page.goto(`${env.trailUrl}/sdk-data/index.html`);
    expect(await page.evaluate(async ({ base, email, password, owner, unrelated, ownedKey }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const client = sdk.createClient(base, undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } }, auth: { persistSession: true, autoRefreshToken: false } });
      localStorage.setItem(unrelated, 'keep');
      const result = await client.auth.signInWithPassword({ email, password });
      const stored = JSON.parse(localStorage.getItem(ownedKey)!);
      return !result.error && result.data.user?.id === owner && stored.version === 1 && Object.keys(stored).sort().join(',') === 'tokens,version' && Object.keys(stored.tokens).sort().join(',') === 'auth_token,csrf_token,refresh_token' && !('csrf_token' in result.data.session!);
    }, { base: env.trailUrl, email: user.email, password: user.password, owner: canonicalUuid(user.user.id), unrelated, ownedKey })).toBe(true);
    await page.reload();
    expect(await page.evaluate(async ({ base, owner, unrelated }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      let authRequests = 0;
      const client = sdk.createClient(base, undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' } } } } }, auth: { persistSession: true, autoRefreshToken: false }, global: { fetch: (input, init) => { if (new URL(String(input)).pathname.startsWith('/api/auth/')) authRequests++; return fetch(input, init); } } });
      const cached = await client.auth.getSession();
      // Empty projection is not used: the ordinary read must preserve real authorization,
      // while limit(0) avoids mapped-row schema assumptions for this storage-only case.
      const rows = await client.from('todos').select().limit(0);
      return !cached.error && cached.data.session?.user.id === owner && !rows.error && Array.isArray(rows.data) && rows.data.length === 0 && authRequests === 0 && localStorage.getItem(unrelated) === 'keep';
    }, { base: env.trailUrl, owner: canonicalUuid(user.user.id), unrelated })).toBe(true);
  }, [
    async () => { if (!page.isClosed()) await page.evaluate(({ ownedKey, unrelated }) => { localStorage.removeItem(ownedKey); localStorage.removeItem(unrelated); }, { ownedKey, unrelated }); },
    async () => { if (user) await user.client.logout(); },
    async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
  ]);
});
