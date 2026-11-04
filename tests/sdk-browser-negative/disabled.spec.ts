import { test, expect } from '@playwright/test';
import { negativeContext, load, save, identity, nativeState, mapping } from '../auth-negative/helpers.js';
import { authSnapshot, mailCount } from '../auth-reference/helpers.js';

declare global { interface Window { anNegative?: { prepare(good: boolean): Promise<boolean>; reject(input: { email: string; password: string }): Promise<boolean>; positive(): Promise<boolean>; dispose(): void } } }

test('L1-15/L1-18/AN06 packed real disabled signup/native MFA challenge preserve empty/good persistent frames and permit existing login', async ({ page }, info) => {
  const env = await negativeContext(true), state = await load(env), plain = state.owners.find(owner => owner.label === 'plain')!, mfa = state.owners.find(owner => owner.label === 'mfa')!;
  const errors: string[] = []; page.on('pageerror', () => errors.push('unhandled-browser-error'));
  await page.route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
  try {
    expect(await page.evaluate(async ({ base, mapping, plain, mfa, keyPrefix }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const check = (value: unknown, label: string) => { if (!value) throw Error(`AN assertion: ${label}`); };
      const plainInput = { email: plain.email, password: plain.password }, mfaInput = { email: mfa.email, password: mfa.password };
      const unrelated = `${keyPrefix}-unrelated`; localStorage.setItem(unrelated, 'keep');
      let current: ReturnType<typeof sdk.createClient> | undefined, key = '', unsubscribe: (() => void) | undefined, events: string[] = [], refreshes = 0, observedChallenge = '';
      const wire: typeof fetch = async (input, init) => {
        check(new URL(String(input)).origin === base, 'fixed owned origin');
        if (new URL(String(input)).pathname.endsWith('/refresh')) refreshes++;
        const response = await fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
        if (response.status === 403 && new URL(String(input)).pathname.endsWith('/login')) {
          check(response.url === `${base}/api/auth/v1/login` && !response.redirected && init?.credentials === 'omit' && init.redirect === 'error', 'actual unredirected omitted-cookie challenge');
          const actual = await response.clone().json(); check(Object.keys(actual).join(',') === 'mfa_token' && typeof actual.mfa_token === 'string', 'native challenge only'); observedChallenge = actual.mfa_token;
        }
        return response; // Genuine unmodified primary auth/data response, never a successful stub.
      };
      function dispose() { unsubscribe?.(); if (key) localStorage.removeItem(key); localStorage.removeItem(unrelated); current = undefined; }
      window.anNegative = {
        async prepare(good) {
          unsubscribe?.(); if (key) localStorage.removeItem(key);
          key = `${keyPrefix}-${good ? 'good' : 'empty'}`; events = []; refreshes = 0; observedChallenge = '';
          localStorage.setItem(unrelated, 'keep');
          current = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: key }, global: { fetch: wire } });
          let initial!: () => void; const initialized = new Promise<void>(yes => { initial = yes; });
          unsubscribe = current.auth.onAuthStateChange(event => { events.push(event); if (event === 'INITIAL_SESSION') initial(); }).data.subscription.unsubscribe;
          await initialized;
          if (good) { const result = await current.auth.signInWithPassword(plainInput); check(!result.error && result.data.user?.id === plain.id, 'real existing password positive before negative'); }
          return true;
        },
        async reject(input) {
          check(current, 'client prepared'); const client = current!;
          const before = JSON.stringify(await client.auth.getSession()), disk = JSON.stringify(Object.entries(localStorage).sort()), eventBefore = events.join(',');
          const result = await client.auth.signInWithPassword(mfaInput);
          check(result.data.user === null && result.data.session === null && result.error?.name === 'AuthMfaUnsupportedError' && result.error.status === 403 && !!observedChallenge, 'real MFA403 is explicitly unsupported, never session');
          for (const secret of [observedChallenge, mfa.password, mfa.email]) check(!JSON.stringify(result).includes(secret), 'challenge/credentials not returned');
          const bearer = await fetch(`${base}/api/records/v1/todos`, { headers: { authorization: `Bearer ${observedChallenge}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
          check([401, 403].includes(bearer.status), 'pending challenge cannot authorize rows'); await bearer.body?.cancel();
          const refresh = await fetch(`${base}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: observedChallenge }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
          check(refresh.status === 401, 'pending challenge is not a refresh credential'); await refresh.body?.cancel();
          const raw = await fetch(`${base}/api/auth/v1/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, password_repeat: input.password }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
          check(raw.status === 403 && !raw.redirected, 'genuine disabled registration403'); await raw.body?.cancel();
          const signup = await client.auth.signUp(input);
          check(signup.data.user === null && signup.data.session === null && signup.error?.status === 403, 'disabled SDK signup not success');
          for (const secret of [input.email, input.password]) check(!JSON.stringify(signup).includes(secret), 'signup credentials not returned');
          check(JSON.stringify(await client.auth.getSession()) === before && JSON.stringify(Object.entries(localStorage).sort()) === disk && events.join(',') === eventBefore && refreshes === 0 && localStorage.getItem(unrelated) === 'keep', 'exact memory/full storage/events/no renewal');
          return true;
        },
        async positive() {
          const client = current!, login = await client.auth.signInWithPassword(plainInput);
          check(!login.error && login.data.user?.id === plain.id, 'existing login works despite registration disabled');
          const rows = await client.from('todos').select('*'); check(!rows.error && rows.data?.length === 1 && rows.data[0].id === plain.rowId && rows.data[0].user_id === plain.id, 'exact owner read/no other owner rows');
          check((await client.auth.signOut({ scope: 'local' })).error === null && localStorage.getItem(key) === null && localStorage.getItem(unrelated) === 'keep', 'ordinary local cleanup preserves unrelated storage');
          return true;
        },
        dispose,
      };
      return true;
    }, { base: env.trailUrl, mapping, plain: { email: plain.email, password: plain.password, id: plain.id!, rowId: plain.rowId! }, mfa: { email: mfa.email, password: mfa.password }, keyPrefix: `an-${env.id}-${info.project.name}` })).toBe(true);
    for (const good of [false, true]) {
      const rejected = identity(env, `browser-${info.project.name}-${good ? 'good' : 'empty'}`); state.rejected.push(rejected); await save(env, state);
      expect(await page.evaluate(good => window.anNegative!.prepare(good), good)).toBe(true);
      const before = nativeState(env), reference = await authSnapshot(env); expect(await mailCount(env, rejected.email)).toBe(0);
      expect(await page.evaluate(input => window.anNegative!.reject(input), { email: rejected.email, password: rejected.password })).toBe(true);
      expect(nativeState(env)).toEqual(before); expect(await authSnapshot(env)).toEqual(reference); expect(await mailCount(env, rejected.email)).toBe(0);
      expect(await page.evaluate(() => window.anNegative!.positive())).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { if (!page.isClosed()) await page.evaluate(() => window.anNegative?.dispose()); }
});
