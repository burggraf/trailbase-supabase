import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

const text = (path: string) => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });

it('L1-26/E01 standalone todos has an executable browser entrypoint, not only a test mount', async () => {
  expect(await text('examples/todos/index.html')).toContain('<script type="module" src="./main.js"></script>');
  const entry = await text('examples/todos/main.js');
  expect(entry).toContain("from './sdk.js'");
  expect(entry).toContain('location.origin');
  expect(entry).toContain('mountAuthTodos');
  expect(entry).not.toMatch(/service_role|anonKey|PHASE_A_CONTEXT|localStorage\.setItem|auth_token|refresh_token|csrf_token/);
});

it('L1-26/E01 SDK fixture root lands on the standalone app without adopting URL auth', async () => {
  const { todosLandingPage } = await import('../../scripts/sdk-browser.mjs');
  expect(todosLandingPage).toContain('http-equiv="refresh"');
  expect(todosLandingPage).toContain('url=/sdk-data/index.html');
  expect(todosLandingPage).toContain('href="/sdk-data/index.html"');
  expect(todosLandingPage).not.toMatch(/location\.hash|access_token|refresh_token/);
});

it('L1-27/S10 approved tailnet mode changes only the fixture canonical origin, never listeners', async () => {
  const { todosOptions } = await import('../../scripts/run-todos.mjs');
  const { nativeSiteConfig } = await import('../../scripts/harness.mjs');
  const origin = 'https://aspire.tailb03e.ts.net:18443';
  for (const version of ['v22.23.2', 'v24.21.0']) {
    expect(todosOptions(['--tailnet'], version)).toEqual({ check: false, publicOrigin: origin });
    expect(todosOptions(['--tailnet', '--check'], version)).toEqual({ check: true, publicOrigin: origin });
    expect(todosOptions(['--check', '--tailnet'], version)).toEqual({ check: true, publicOrigin: origin });
    for (const args of [['--tailnet', '--tailnet'], ['--tailnet=https://example.test'], ['--tailnet', '--host=0.0.0.0']]) expect(() => todosOptions(args, version)).toThrow();
  }
  const config = await text('tests/fixtures/trailbase/config.textproto');
  expect(nativeSiteConfig(config)).toBe(config);
  expect(nativeSiteConfig(config, origin)).toBe(config.replace('site_url: "http://127.0.0.1:__TRAIL_PORT__"', `site_url: "${origin}"`));
  for (const invalid of ['http://aspire.tailb03e.ts.net:18443', 'https://example.test', `${origin}/`, `${origin}/x`, `${origin}?x=1`]) expect(() => nativeSiteConfig(config, invalid)).toThrow();
  expect(() => nativeSiteConfig('', origin)).toThrow();
  expect(() => nativeSiteConfig(config + config, origin)).toThrow();
  expect(await text('scripts/harness.mjs')).toContain('`127.0.0.1:${ports.TRAIL_PORT}`');
});

it('L1-27/S10 local todos launcher rejects target/binding options and unpinned runtimes', async () => {
  expect(await text('scripts/run-todos.mjs')).not.toBe('');
  const path = '../../scripts/run-todos.mjs';
  const { todosOptions } = await import(path);
  for (const version of ['v22.23.2', 'v24.21.0']) {
    expect(todosOptions([], version)).toEqual({ check: false });
    expect(todosOptions(['--check'], version)).toEqual({ check: true });
    for (const args of [['--host', '0.0.0.0'], ['--url', 'https://example.test'], ['--check', '--check'], ['--auth-mitigation'], ['--unknown']]) expect(() => todosOptions(args, version)).toThrow();
  }
  for (const version of ['v20.0.0', 'v22.0.0', 'v25.0.0']) expect(() => todosOptions([], version)).toThrow();
});
