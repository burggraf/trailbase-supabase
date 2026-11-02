import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import * as tools from '../../scripts/tools.mjs';
import * as harness from '../../scripts/harness.mjs';
import * as runner from '../../scripts/run-phase-a.mjs';
import legacy from '../fixtures/trailbase-v0.34.3.json' with { type: 'json' };

it('L1-26/L1-27 native version cache keeps both server versions separate and never replaces legacy live binary paths', () => {
  const paths = (tools as unknown as { trailToolPaths: (pin?: unknown, host?: string) => { archive: string; directory: string; binary: string } }).trailToolPaths;
  const current = paths(undefined, 'linux-x64'), prior = paths(legacy, 'linux-x64');
  expect(current.binary).toBe(resolve('.runtime/tools/trailbase/0.35.8/linux-x64/trail'));
  expect(prior.binary).toBe(resolve('.runtime/tools/trailbase/0.34.3/linux-x64/trail'));
  expect(current.archive).toBe(resolve('.runtime/tools/trailbase_v0.35.8_x86_64_linux.zip'));
  expect(current.directory).not.toBe(prior.directory);
  for (const p of [current, prior]) expect(p.directory).not.toBe(resolve('.runtime/tools/linux-x64'));
});

it('L1-27 confines legacy server selection to the explicit owned upgrade profile', () => {
  const pin = (harness as unknown as { fixtureNativePin: (profile?: string) => { version: string } }).fixtureNativePin;
  expect(pin().version).toBe('0.35.8'); expect(pin('legacy-upgrade')).toEqual(legacy);
  for (const bad of ['unknown', '../original', '']) expect(() => pin(bad)).toThrow();
});

it('L1-27 runner selects the genuine legacy ambiguous-depot contract without repinning current research or SDK scopes', () => {
  const select = (runner as unknown as { nativeServerProfileForSuite: (suite: string) => string }).nativeServerProfileForSuite;
  expect(select).toBeTypeOf('function');
  const legacyProfile = select('auth-migration'), legacyPin = harness.fixtureNativePin(legacyProfile);
  expect(legacyProfile).toBe('legacy-upgrade'); expect(legacyPin).toEqual(legacy);
  expect(tools.trailToolPaths(legacyPin, 'linux-x64').binary).toBe(resolve('.runtime/tools/trailbase/0.34.3/linux-x64/trail'));
  for (const suite of ['all', 'characterization', 'smtp', 'database', 'constraints', 'sdk-auth', 'sdk-refresh', 'sdk-data', 'sdk-browser', 'browser']) {
    expect(harness.fixtureNativePin(select(suite))).toEqual(tools.baseline.trailbase);
  }
});

it('L1-26/L1-27 rejects malformed native pin/cache paths and unsupported platforms before filesystem operations', () => {
  const paths = (tools as unknown as { trailToolPaths: (pin?: unknown, host?: string) => unknown }).trailToolPaths;
  for (const version of ['../live', '/tmp', '0.35.8/../../', '', 'latest']) expect(() => paths({ ...legacy, version }, 'linux-x64')).toThrow();
  expect(() => paths(legacy, 'win32-x64')).toThrow();
  expect(() => paths({ ...legacy, assets: { 'linux-x64': { name: '../../live', sha256: 'a'.repeat(64) } } }, 'linux-x64')).toThrow();
});
