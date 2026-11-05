import { test, expect } from '@playwright/test';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateBrowserModules } from '../../scripts/sdk-browser.mjs';

// Packed browser-realm comparison with injected responses. NOT primary real-backend E2E.
const root = process.env.SDK_RESULT_ROWS_ROOT;
if (!root) throw new Error('SDK_RESULT_ROWS_ROOT must name an offline clean tarball consumer');
const installed = resolve(root, 'node_modules/trailbase-supabase');
const native = resolve(root, 'node_modules/trailbase');
const oracle = resolve('node_modules/@supabase/supabase-js');
for (const mode of ['list', 'single', 'maybeSingle'] as const) for (const dangerous of [false, true]) {
  test(`L1-04/RR ${mode} ordinary own rows, dangerous names=${dangerous} (injected transport)`, async ({ page }) => {
    const files = { '/sdk.js': resolve(installed, 'dist/index.js'), '/auth.js': resolve(installed, 'dist/auth.js'), '/common.js': resolve(installed, 'dist/common.js'), '/native.js': resolve(native, 'dist/index.js'), '/reference.js': resolve(oracle, 'dist/umd/supabase.js') };
    const modules: Record<string, string> = {};
    for (const [url, path] of Object.entries(files)) {
      expect((await lstat(path)).isFile()).toBe(true); expect(await realpath(path)).toBe(path);
      modules[url] = await readFile(path, 'utf8');
    }
    expect(JSON.parse(await readFile(resolve(installed, 'package.json'), 'utf8')).version).toBe('0.0.0');
    expect(JSON.parse(await readFile(resolve(native, 'package.json'), 'utf8')).version).toBe('0.14.3');
    expect(JSON.parse(await readFile(resolve(oracle, 'package.json'), 'utf8')).version).toBe('2.117.2');
    validateBrowserModules(modules['/sdk.js'], modules['/native.js'], { 'auth.js': modules['/auth.js'], 'common.js': modules['/common.js'] });
    let escapedModuleRequests = 0;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://result-rows.test') { escapedModuleRequests++; return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="importmap">{"imports":{"trailbase":"/native.js"}}</script><script src="/reference.js"></script>' });
      if (Object.hasOwn(modules, url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: modules[url.pathname] });
      escapedModuleRequests++; return route.abort();
    });
    try {
      await page.goto('https://result-rows.test/');
      const summary = await page.evaluate(async ({ mode, dangerous }) => {
        const url = 'https://result-rows.test/sdk.js';
        const sdk: typeof import('../../src/index.js') = await import(url);
        const reference = Reflect.get(window, 'supabase') as typeof import('@supabase/supabase-js');
        function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
        const originalFetch = globalThis.fetch; let escapedFetchCalls = 0, setterCalls = 0;
        globalThis.fetch = async () => { escapedFetchCalls++; throw new Error('Unexpected network'); };
        const previousSetter = Object.getOwnPropertyDescriptor(Object.prototype, 'row_setter_probe');
        Object.defineProperty(Object.prototype, 'row_setter_probe', { configurable: true, set() { setterCalls++; } });
        try {
          const id = '550e8400-e29b-41d4-a716-446655440000', nativeId = 'VQ6EAOKbQdSnFkRmVUQAAA==';
          const extra = dangerous ? ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'row_setter_probe'] : ['row_setter_probe'];
          const row = Object.fromEntries([['id', id], ['title', 'literal&+é'], ['completed', true], ...extra.map(key => [key, `own-${key}`])]);
          const nativeRow = { ...row, id: nativeId, completed: 1 };
          const fields = Object.fromEntries([['id', { type: 'uuid' as const }], ['title', { type: 'text' as const }], ['completed', { type: 'boolean' as const }], ...extra.map(key => [key, { type: 'text' as const }])]);
          let candidateCalls = 0, referenceCalls = 0;
          const a = sdk.createClient('https://candidate.test', undefined, { trailbase: { tables: { todos: { api: 'todos', primaryKey: 'id', fields } } }, global: { fetch: async () => { candidateCalls++; return Response.json({ records: [nativeRow] }); } } });
          const b = reference.createClient('https://reference.test', 'placeholder', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (_input, init) => { referenceCalls++; return Response.json(new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object') ? row : [row]); } } });
          const aq = a.from('todos').select(), bq = b.from('todos').select();
          check([candidateCalls, referenceCalls].every(count => count === 0), 'lazy construction');
          const left = await (mode === 'list' ? aq : mode === 'single' ? aq.single() : aq.maybeSingle());
          const right = await (mode === 'list' ? bq : mode === 'single' ? bq.single() : bq.maybeSingle());
          check(left.error === null && right.error === null, 'successful decoded data');
          check(Array.isArray(left.data) === (mode === 'list') && Array.isArray(right.data) === (mode === 'list'), 'cardinality shape');
          if (mode === 'list') check(left.data?.length === 1 && right.data?.length === 1, 'list length');
          const decoded = Array.isArray(left.data) ? left.data[0] : left.data;
          const expected = Array.isArray(right.data) ? right.data[0] : right.data;
          check(decoded && expected, 'rows present');
          // These assertions MUST run in the page realm, before Playwright serialization.
          check(Object.getPrototypeOf(decoded) === Object.prototype && Object.getPrototypeOf(expected) === Object.prototype, 'ordinary realm prototypes');
          const keys = Reflect.ownKeys(row);
          for (const value of [decoded, expected]) {
            const actualKeys = Reflect.ownKeys(value); check(actualKeys.length === keys.length && actualKeys.every((key, i) => key === keys[i]), 'exact own keys');
            for (const key of keys) {
              const descriptor = Object.getOwnPropertyDescriptor(value, key);
              check(Object.hasOwn(value, key) && descriptor && Object.hasOwn(descriptor, 'value'), 'own data descriptor');
              check(descriptor.enumerable && descriptor.writable && descriptor.configurable && Object.is(descriptor.value, Reflect.get(row, key)), 'descriptor flags/value');
            }
          }
          check(candidateCalls === 1 && referenceCalls === 1 && escapedFetchCalls === 0 && setterCalls === 0, 'exact calls/no inherited setters');
          return { candidateCalls, referenceCalls, escapedFetchCalls, setterCalls, rowsChecked: 1 };
        } finally {
          globalThis.fetch = originalFetch;
          if (previousSetter) Object.defineProperty(Object.prototype, 'row_setter_probe', previousSetter); else Reflect.deleteProperty(Object.prototype, 'row_setter_probe');
        }
      }, { mode, dangerous });
      expect(summary).toEqual({ candidateCalls: 1, referenceCalls: 1, escapedFetchCalls: 0, setterCalls: 0, rowsChecked: 1 });
      expect(escapedModuleRequests).toBe(0);
    } finally { await page.unrouteAll({ behavior: 'wait' }); }
  });
}
