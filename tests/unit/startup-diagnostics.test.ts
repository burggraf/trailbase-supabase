import { expect, it } from 'vitest';
import * as harness from '../../scripts/harness.mjs';
import { readFile } from 'node:fs/promises';
import { collectSupabaseStartupEvidence } from '../../scripts/startup-diagnostics.mjs';
const candidate = Reflect.get(harness, 'supabaseStartupEvidence');
const project: (error: unknown, observations?: unknown) => any = typeof candidate === 'function' ? candidate as any : () => null;

it('L1-27/D01 startup evidence preserves exit/owned container facts without inventing a cause', () => {
  const result = project({ code: 1, signal: null, killed: false }, { supabase_auth: { status: 'exited', health: 'unhealthy', exitCode: 137, oomKilled: true, restartCount: 2 } });
  expect(result).toEqual({ stage: 'supabase-start', cause: 'not-established', exitCode: 1, signal: null, killed: false,
    command: { kind: 'nonzero-exit', stdout: 'unavailable', stderr: 'unavailable', progress: [], signatures: [] }, services: [
    { service: 'supabase_auth', inspection: 'available', status: 'exited', health: 'unhealthy', exitCode: 137, oomKilled: true, restartCount: 2 },
    ...['supabase_db','supabase_inbucket','supabase_kong','supabase_realtime','supabase_rest'].map(service => ({ service, inspection: 'not-available' }))
  ] });
});

it('L1-27/D01 malformed/untrusted fields cannot export secrets or invoke accessors/coercion', () => {
  const secret = 'PLANTED_STARTUP_PRIVATE_CANARY', trip = () => { throw Error('Accessor must not run'); };
  const result = project({ code: secret, signal: secret, killed: secret, stdout: secret, stderr: secret, message: secret, stack: secret }, {
    supabase_auth: { status: secret, health: secret, exitCode: secret, oomKilled: secret, restartCount: secret, environment: secret, Health: { Log: [{ Output: secret }] } },
    [secret]: { status: secret }
  });
  expect(result).not.toBeNull(); expect(JSON.stringify(result)).not.toContain(secret);
  expect(result?.exitCode).toBeNull(); expect(result?.signal).toBeNull(); expect(result?.services[0]).toEqual({ service: 'supabase_auth', inspection: 'available', status: 'unknown', health: 'unknown', exitCode: null, oomKilled: null, restartCount: null });
  const accessor = Object.defineProperties({}, { code: { get: trip }, signal: { get: trip }, killed: { get: trip } });
  expect(() => project(accessor, Object.create({ supabase_auth: { status: secret } }))).not.toThrow();
  const revoked = Proxy.revocable({}, {}); revoked.revoke(); expect(() => project(revoked.proxy, revoked.proxy)).not.toThrow();
});

it('L1-27/D01 mutable descriptor traps cannot swap a validated signal for secret text', () => {
  let reads = 0; const secret = 'PLANTED_MUTABLE_SIGNAL_PRIVATE_CANARY';
  const changing = new Proxy({}, { getOwnPropertyDescriptor(_target, field) { return field === 'signal' ? { configurable: true, enumerable: true, value: reads++ === 0 ? 'SIGTERM' : secret } : undefined; } });
  const result = project(changing);
  expect(result?.signal).toBe('SIGTERM'); expect(reads).toBe(1); expect(JSON.stringify(result)).not.toContain(secret);
});

it('L1-27/D02 foreign/ambiguous project names are rejected before any Docker read', async () => {
  for (const value of ['', 'linked-project', 'trailbase-supabase-test-ABCDEF123456', 'trailbase-supabase-test-0123456789ab\n', '--help', null]) await expect(collectSupabaseStartupEvidence(value, Error('private'))).rejects.toThrow('Invalid owned startup diagnostic project');
});

it('L1-27/D02 startup diagnostics are collected only through owned exact service reads and wired before cleanup', async () => {
  const text = await readFile('scripts/harness.mjs', 'utf8'), runner = await readFile('scripts/run-phase-a.mjs', 'utf8');
  expect(text).toContain('verifyOwner(id, ownerRecord');
  expect(text).toContain('context.supabaseStartup = await collectStartupFailure(error)');
  expect(text).toContain('return await collectSupabaseStartupEvidence(project, error, childEnv, docker)');
  expect(text).toContain('dockerOwner = createFixtureDocker(files, childEnv)');
  expect(text).not.toContain("exec('docker',");
  expect(text).toContain('childEnv.DOCKER_HOST = dockerTarget; delete childEnv.DOCKER_CONTEXT;');
  expect(text).toContain('const files = await createFixtureFiles(directory, ownerRecord)');
  expect(text).toContain('verifyOwner(id, await files.readOwner(), config)');
  expect(text).toContain('throw error;');
  expect(runner).toContain('report.supabaseStartup=harness?.context.supabaseStartup');
});
