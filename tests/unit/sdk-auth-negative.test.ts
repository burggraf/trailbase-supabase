import { it, expect } from 'vitest';
import { readFile, access, mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as harness from '../../scripts/harness.mjs';

it('L1-27/AN01 registration override is fixture-only and refuses ambiguous/already configured input', () => {
  const disabled = (harness as Record<string, unknown>).registrationPolicyConfig;
  expect(disabled).toBeTypeOf('function');
  if (typeof disabled !== 'function') throw new Error('Missing isolated registration policy');
  expect(disabled('auth { user_identifier: ONLY_EMAIL }')).toBe('auth { disable_password_auth: true user_identifier: ONLY_EMAIL }');
  for (const input of ['', 'not_auth {}', 'auth {', 'auth }', 'auth {} auth {}', 'auth { disable_password_auth: false }', 'auth { disable_password_auth: true }', null]) expect(() => disabled(input)).toThrow('Invalid');
});

it('L1-27/AN01 policy overrides fail before fixture allocation for unknown types/nonstock/legacy/public targets', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'negative-policy-refusal-'));
  try {
    for (const options of [
      { registrationPolicyTest: 'true' },
      { registrationPolicyTest: true, authMitigation: true },
      { registrationPolicyTest: true, privateNativePrototype: true },
      { registrationPolicyTest: true, nativeServerProfile: 'legacy-upgrade' },
      { registrationPolicyTest: true, nativeAuthProfile: 'short-native-auth' },
      { registrationPolicyTest: true, publicOrigin: 'https://example.test', sdkBrowser: true },
    ]) {
      const code = `import{createHarness}from${JSON.stringify(pathToFileURL(resolve('scripts/harness.mjs')).href)};try{await createHarness(${JSON.stringify(options)});throw Error('Override accepted')}catch(error){if(error.message!=='Invalid registration-policy fixture')throw error;}`;
      expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, stdio: 'pipe' })).not.toThrow();
      expect(await readdir(directory)).toEqual([]);
    }
  } finally { await rm(directory, { recursive: true }); }
});

it('L1-27/AN01 policy control refuses default/nonstarted fixtures before touching a generated config', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'negative-policy-control-'));
  try {
    await mkdir(resolve(directory, 'tests/fixtures/trailbase'), { recursive: true });
    await writeFile(resolve(directory, 'tests/fixtures/trailbase/config.textproto'), 'auth {}');
    const code = `import assert from'node:assert/strict';import{createHarness}from${JSON.stringify(pathToFileURL(resolve('scripts/harness.mjs')).href)};for(const options of [{},{registrationPolicyTest:true}]){const fixture=await createHarness(options);for(const value of [true,false,undefined,'true'])await assert.rejects(fixture.setRegistrationDisabled(value),{message:'Invalid registration-policy control'});await fixture.cleanup();}`;
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, stdio: 'pipe' })).not.toThrow();
  } finally { await rm(directory, { recursive: true }); }
});

it('L1-27/AN06 negative scope runs restoration/cleanup and packed browsers in candidate/CI without enabling reference MFA', async () => {
  const runner = await readFile('scripts/run-phase-a.mjs', 'utf8');
  for (const required of ["suite === 'sdk-auth-negative'", 'registrationPolicyTest: authNegative', 'setRegistrationDisabled(true)', 'setRegistrationDisabled(false)', 'playwright.sdk-auth-negative.config.ts', 'tests/auth-negative/cleanup.test.ts']) expect(runner).toContain(required);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  expect(pkg.scripts['test:sdk:auth:negative']).toBe('node scripts/run-phase-a.mjs sdk-auth-negative');
  expect(await readFile('scripts/run-release-candidate.mjs', 'utf8')).toContain("'test:sdk:auth:negative'");
  const workflow = await readFile('.github/workflows/phase-a.yml', 'utf8');
  const step = workflow.split(/^      - /m).find(step => step.includes('run: npm run test:sdk:auth:negative'));
  expect(step).toBeDefined(); expect(step).toContain('if: always()'); expect(step).not.toMatch(/continue-on-error|\|\|\s*true/);
  const config = await readFile('tests/fixtures/supabase/config.toml', 'utf8');
  expect(config).not.toContain('[auth.mfa');
});

it('L1-15/AN01 fixture-only TOTP matches RFC6238 SHA1 vectors and rejects unsupported parameters', async () => {
  const path = resolve('tests/auth-negative/totp.ts'); let make: unknown;
  try { await access(path); make = (await import(path)).totp; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  expect(make).toBeTypeOf('function'); if (typeof make !== 'function') throw new Error('Missing fixture TOTP');
  const uri = 'otpauth://totp/RFC?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=6&period=30';
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']] as const) expect(make(uri, seconds * 1000)).toBe(expected);
  for (const invalid of [uri.replace('SHA1', 'SHA256'), uri.replace('digits=6', 'digits=8'), uri.replace('period=30', 'period=60'), uri.replace('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'INVALID!'), 'https://example.test/']) expect(() => make(invalid)).toThrow('Unsupported fixture TOTP');
});
