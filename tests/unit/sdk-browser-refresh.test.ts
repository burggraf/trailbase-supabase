import { expect, it } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('L1-18/L1-27 PB01 short packed browsers select only the existing official short-native-auth profile', async () => {
  const runner = await import('../../scripts/run-phase-a.mjs');
  const profile = Reflect.get(runner, 'nativeAuthProfileForSuite');
  expect(profile).toBeTypeOf('function');
  for (const suite of ['sdk-browser-refresh', 'sdk-refresh', 'expiry']) expect(profile(suite)).toBe('short-native-auth');
  for (const suite of ['all', 'sdk-browser', 'sdk-auth', 'auth-reference']) expect(profile(suite)).toBe('default');
  expect(runner.nativeServerProfileForSuite('sdk-browser-refresh')).toBe('default');
});

it('L1-27 PB short packed scope rejects candidate fixture overrides before touching an owned canary lock', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'pb-variant-refusal-'));
  const lock = resolve(cwd, '.runtime/phase-a.lock');
  try {
    await mkdir(lock, { recursive: true }); await writeFile(resolve(lock, 'owner.json'), 'owned-canary');
    await mkdir(resolve(cwd, 'scripts')); const entry = resolve(cwd, 'scripts/run-phase-a.mjs');
    await symlink(resolve('scripts/run-phase-a.mjs'), entry);
    const result = spawnSync(process.execPath, [entry, 'sdk-browser-refresh', '--auth-mitigation'], { cwd, encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(1); expect(result.error).toBeUndefined();
    expect(result.stderr).toContain('Packed short-auth browser checks require the stock fixture');
    expect(await readFile(resolve(lock, 'owner.json'), 'utf8')).toBe('owned-canary');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

it('L1-26/L1-27 PB01–PB04 real short packed browsers are strict separate candidate and CI checks, never primary-flow stubs', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  expect(pkg.scripts['test:sdk:browser:refresh']).toBe('node scripts/run-phase-a.mjs sdk-browser-refresh');
  const config = await readFile('playwright.sdk-refresh.config.ts', 'utf8');
  expect(config).toContain("from './playwright.config.js'");
  expect(config).toContain("testDir: './tests/sdk-browser-refresh'");
  expect(config).toContain('timeout: 120000');
  const candidate = await import('../../scripts/run-release-candidate.mjs');
  expect(candidate.candidateCommands.find((row: { id: string }) => row.id === 'browser-refresh')).toEqual({ id: 'browser-refresh', script: 'test:sdk:browser:refresh', args: [] });
  const workflow = await readFile('.github/workflows/phase-a.yml', 'utf8');
  const step = workflow.split('  sdk-mvp:\n')[1]!.split('  real-backends:\n')[0]!.split(/^      - /m).find(row => row.includes('npm run test:sdk:browser:refresh'));
  expect(step).toBeDefined(); expect(step).toContain('if: always()');
  expect(step).not.toMatch(/continue-on-error|\|\|\s*true/);
});
