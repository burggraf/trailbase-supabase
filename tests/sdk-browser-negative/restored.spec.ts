import { test, expect } from '@playwright/test';
import { negativeContext, load, save, nativeState, mapping } from '../auth-negative/helpers.js';
import { authSnapshot, mailCount } from '../auth-reference/helpers.js';
import { confirmEmail, nativeUuid } from '../phase-a/helpers.js';

declare global { interface Window { anRecovery?: { signup(input: { email: string; password: string; key: string }): Promise<boolean>; login(): Promise<string>; dispose(): void } } }

test('L1-15/AN06 packed restored policy confirms/logs in both previously rejected browser identities with complete unrelated-state preservation', async ({ page }, info) => {
  const env = await negativeContext(false), state = await load(env), rejected = state.rejected.filter(owner => owner.label.startsWith(`browser-${info.project.name}-`));
  expect(rejected).toHaveLength(2);
  const errors: string[] = []; page.on('pageerror', () => errors.push('unhandled-browser-error'));
  await page.route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.goto(`${env.trailUrl}/sdk-data/harness.html`);
  try {
    expect(await page.evaluate(async ({ base, mapping, unrelated }) => {
      const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
      const check = (value: unknown, label: string) => { if (!value) throw Error(`AN recovery assertion: ${label}`); };
      let current: ReturnType<typeof sdk.createClient> | undefined, credentials: { email: string; password: string }, key = '', events: string[] = [], unsubscribe: (() => void) | undefined;
      localStorage.setItem(unrelated, 'keep');
      window.anRecovery = {
        async signup(input) {
          unsubscribe?.(); if (key) localStorage.removeItem(key); key = input.key; credentials = { email: input.email, password: input.password }; events = [];
          current = sdk.createClient(base, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: key }, global: { fetch: (input, init) => {
            check(new URL(String(input)).origin === base, 'fixed owned origin');
            return fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
          } } });
          let initial!: () => void; const initialized = new Promise<void>(yes => { initial = yes; });
          const subscription = current.auth.onAuthStateChange(event => { events.push(event); if (event === 'INITIAL_SESSION') initial(); }).data.subscription;
          unsubscribe = () => subscription.unsubscribe(); await initialized;
          const result = await current.auth.signUp(credentials);
          check(!result.error && result.data.user === null && result.data.session === null && events.join(',') === 'INITIAL_SESSION' && localStorage.getItem(key) === null && localStorage.getItem(unrelated) === 'keep', 'genuine supported signup, no fabricated session/event');
          return true;
        },
        async login() {
          const result = await current!.auth.signInWithPassword(credentials);
          check(!result.error && !!result.data.user && result.data.user.email === credentials.email && !!localStorage.getItem(key), 'real email-confirmed password login persists');
          const rows = await current!.from('todos').select('*'); check(!rows.error && rows.data?.length === 0, 'new owner cannot read other owners rows');
          check((await current!.auth.signOut()).error === null && localStorage.getItem(key) === null && localStorage.getItem(unrelated) === 'keep' && events.join(',') === 'INITIAL_SESSION,SIGNED_IN,SIGNED_OUT', 'real global receipt clears only owned frame/exact events');
          return result.data.user!.id;
        },
        dispose() { unsubscribe?.(); if (key) localStorage.removeItem(key); localStorage.removeItem(unrelated); current = undefined; },
      };
      return true;
    }, { base: env.trailUrl, mapping, unrelated: `an-restored-${env.id}-${info.project.name}-unrelated` })).toBe(true);
    for (const owner of rejected) {
      const before = nativeState(env), reference = await authSnapshot(env); expect(await mailCount(env, owner.email)).toBe(0);
      expect(await page.evaluate(input => window.anRecovery!.signup(input), { email: owner.email, password: owner.password, key: `an-recovery-${env.id}-${owner.label}` })).toBe(true);
      await confirmEmail(env, owner.email); expect(await mailCount(env, owner.email)).toBe(1);
      owner.id = await page.evaluate(() => window.anRecovery!.login()); await save(env, state);
      const after = nativeState(env), own = (row: Record<string, unknown>) => row.email === owner.email;
      expect(after.users.filter(own)).toHaveLength(1);
      expect(after.users.find(own)).toMatchObject({ id: Uint8Array.from(Buffer.from(nativeUuid(owner.id), 'base64url')), email: owner.email, unverified_email: null, totp_secret: null });
      expect(after.users.filter(row => !own(row))).toEqual(before.users);
      expect(after.sessions).toEqual(before.sessions); expect(after.todos).toEqual(before.todos); expect(after.audit).toEqual(before.audit); expect(await authSnapshot(env)).toEqual(reference);
    }
    expect(errors).toEqual([]);
  } finally { if (!page.isClosed()) await page.evaluate(() => window.anRecovery?.dispose()); }
});
