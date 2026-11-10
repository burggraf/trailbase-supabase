import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
const mock = vi.hoisted(() => ({ exec: vi.fn(), create: vi.fn(), stop: vi.fn(), remove: vi.fn(), logs: [] as any[] }));
vi.mock('../../scripts/tools.mjs', async original => ({ ...await original<typeof import('../../scripts/tools.mjs')>(), exec: mock.exec, installTrail: async () => '/fixture/trail' }));
vi.mock('../../scripts/fixture-docker.mjs',async()=>{const m=await import('../fixtures/docker-command-model.js');return{localDockerTarget:m.localDockerTarget,createFixtureDocker:(_f:unknown,env:any)=>m.dockerCommandModel(mock.exec,env)};});
vi.mock('../../scripts/fixture-network.mjs', () => ({ fixtureNetwork: () => ({ id: 'a'.repeat(64), create: async () => {}, inventory: async () => ({ exists: true }), remove: mock.remove }) }));
vi.mock('../../scripts/native-process.mjs', () => ({ createNativeProcess: mock.create }));
// CLI is a modeled boundary here; original real CLI ownership is covered separately.
vi.mock('../../scripts/fixture-cli.mjs', () => ({ createFixtureFrontendCli: (_files: unknown, env: unknown) => ({ run: (_name: string, args: string[]) => mock.exec(resolve('node_modules/.bin/supabase'), args, { env, timeout: 300000, maxBuffer: 20000000 }), fence: async () => {}, inventory: async () => ({ complete: false, unknown: false, commands: [] }) }) }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: () => { throw Error('Direct native spawn forbidden in caller unit'); } }));
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => { const fd = await fs.open(...args); if (String(args[0]).endsWith('/trail.log')) mock.logs.push(fd); return fd; } };
});
import { createHarness, cli } from '../../scripts/harness.mjs';
import { baseline } from '../../scripts/tools.mjs';
const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let h: Awaited<ReturnType<typeof createHarness>>;
beforeEach(async () => {
  vi.clearAllMocks(); mock.logs = [];
  mock.remove.mockResolvedValue(undefined); mock.stop.mockResolvedValue(undefined);
  mock.create.mockReturnValue({ pid: 517, exited: false, exitCode: null, signalCode: null,
    start: async (record: (pid: number) => Promise<void>) => { await record(517); throw Error('Injected native launch acknowledgement unknown'); },
    stop: mock.stop, inventory: () => Object.freeze({ complete: false, pid: 517, joined: false }) });
  mock.exec.mockImplementation(async (file: string, args: string[]) => {
    if (file === cli && args[0] === '--version') return { stdout: baseline.supabaseCli, stderr: '' };
    if (file === cli && args[0] === 'status') return { stdout: JSON.stringify({ ANON_KEY: 'unit-not-a-credential' }), stderr: '' };
    if (file === 'docker' && args[0] === 'context') return { stdout: 'unix:///fixture/docker.sock', stderr: '' };
    return { stdout: args[0] === '--version' ? 'TrailBase v' + baseline.trailbase.version : '', stderr: '' };
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  h = await createHarness();
});
afterEach(async () => {
  // Only model actors exist in this file; close our original captured files, never adopt numeric FDs.
  for (const log of mock.logs) await log.close();
  await fs.rm(h.context.directory, { recursive: true }); vi.unstubAllGlobals();
});
it('L1-27/U27 actual harness retains native log/depot/network on original stop uncertainty', async () => {
  await expect(h.start()).rejects.toThrow(); mock.stop.mockRejectedValue(Error('Original native join unconfirmed'));
  await expect(h.cleanup()).rejects.toThrow('native');
  expect(mock.stop).toHaveBeenCalledTimes(1); expect(mock.remove).not.toHaveBeenCalled();
  expect(mock.exec.mock.calls.some(([file, args]) => file === cli && args[0] === 'stop')).toBe(false);
  expect((await fs.stat(resolve(h.context.directory, 'traildepot'))).isDirectory()).toBe(true);
  expect((await mock.logs[0].stat()).isFile()).toBe(true);
});
it('L1-27/U27 actual harness can contain only its native owner without removing data or other resources', async () => {
  await expect(h.start()).rejects.toThrow();
  await (h as any).stopNative(); expect(mock.stop).toHaveBeenCalledTimes(1);
  expect(mock.remove).not.toHaveBeenCalled();
  expect(mock.exec.mock.calls.some(([file, args]) => file === cli && args[0] === 'stop')).toBe(false);
  expect((await fs.stat(resolve(h.context.directory, 'traildepot'))).isDirectory()).toBe(true);
  await h.cleanup(); expect(mock.stop).toHaveBeenCalledTimes(1);
});
it('L1-27/U27 actual harness contains its original native owner even when disk metadata is corrupt, without deletion', async () => {
  await expect(h.start()).rejects.toThrow();
  await fs.writeFile(resolve(h.context.directory, 'owner.json'), '{partial-owner-write');
  await expect(h.cleanup()).rejects.toThrow();
  expect(mock.stop).toHaveBeenCalledTimes(1); expect(mock.remove).not.toHaveBeenCalled();
  expect((await fs.stat(resolve(h.context.directory, 'traildepot'))).isDirectory()).toBe(true);
});
it('L1-27/U27 actual harness retains the creating owner before failed launch and closes its log only after join', async () => {
  await expect(h.start()).rejects.toThrow(); expect(mock.create).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await fs.readFile(resolve(h.context.directory, 'owner.json'), 'utf8')).trailPid).toBe(517);
  const log = mock.logs[0]; mock.stop.mockImplementation(async () => { expect((await log.stat()).isFile()).toBe(true); });
  await h.cleanup(); expect(mock.stop).toHaveBeenCalledTimes(1); expect(mock.remove).toHaveBeenCalledTimes(1);
  await expect(fs.stat(resolve(h.context.directory, 'traildepot'))).rejects.toMatchObject({ code: 'ENOENT' });
});
