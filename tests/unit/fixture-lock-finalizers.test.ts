import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const state = vi.hoisted(() => ({ directory: '', failure: true, foreign: false, calls: 0 }));
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  const mapped = (p: any, write = false) => {
    const path = resolve(p instanceof URL ? fileURLToPath(p) : String(p));
    if (path === state.directory || path.startsWith(state.directory + sep)) return path;
    const tail = relative(process.cwd(), path);
    if (/^(?:\.runtime|artifacts)(?:\/|$)/.test(tail)) return resolve(state.directory, tail);
    if (write) throw Error('Caller unit write outside owned scratch refused');
    return path;
  };
  return { ...fs,
    mkdir: (p: any, o: any) => fs.mkdir(mapped(p, true), o),
    readFile: (p: any, o: any) => fs.readFile(mapped(p), o),
    writeFile: (p: any, d: any, o: any) => fs.writeFile(mapped(p, true), d, o),
    rm: (p: any, o: any) => fs.rm(mapped(p, true), o),
  };
});
vi.mock('../../scripts/tools.mjs', async original => {
  const tools = await original<typeof import('../../scripts/tools.mjs')>();
  return { ...tools, exec: vi.fn(async (file: string) => { if (file !== 'git') throw Error('No external commands in caller unit'); return { stdout: '', stderr: '' }; }) };
});
vi.mock('../../scripts/harness.mjs', () => ({
  fixtureNativePin: () => ({ version: '0.35.9', commit: 'unit-pin' }),
  assertRunDirectory: () => {}, assertLocalUrl: () => {}, verifyOwner: () => {},
  createHarness: async () => {
    state.calls++;
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const directory = resolve(state.directory, 'owned-run'); await fs.mkdir(directory);
    return { context: { id: '1780400000000-abcdef123456', directory, setupStage: 'supabase-start' },
      start: async () => { throw Error('Injected network-create unknown outcome; no backend launched'); },
      cleanup: async () => {
        if (state.foreign) await fs.writeFile(resolve(state.directory, '.runtime/phase-a.lock/owner.json'), JSON.stringify({ runnerPid: process.pid + 1, runId: 'foreign-unit-owner' }));
        if (state.failure) throw Error('Injected sticky unknown cleanup; resources retained');
      },
    };
  },
}));
const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let argv: string[], exitCode: typeof process.exitCode, listeners: Map<'SIGINT' | 'SIGTERM', Function[]>;
beforeEach(async () => {
  state.directory = await fs.mkdtemp(resolve(tmpdir(), 'fixture-caller-unit-')); state.calls = 0;
  argv = [...process.argv]; exitCode = process.exitCode;
  listeners = new Map((['SIGINT', 'SIGTERM'] as const).map(name => [name, process.listeners(name)]));
});
afterEach(async () => {
  process.argv = argv; process.exitCode = exitCode;
  for (const [name, prior] of listeners) for (const fn of process.listeners(name)) if (!prior.includes(fn)) process.removeListener(name, fn as any);
  await fs.rm(state.directory, { recursive: true });
});
for (const script of ['run-phase-a.mjs', 'run-sdk-node.mjs', 'run-native-upgrade.mjs']) {
  for (const scenario of ['unknown-cleanup', 'confirmed-cleanup', 'foreign-lock']) it(`L1-27/U27/S01 actual ${script} finalizer ${scenario}`, async () => {
    state.failure = scenario === 'unknown-cleanup'; state.foreign = scenario === 'foreign-lock';
    process.argv = [process.execPath, resolve('scripts', script)];
    await import(/* @vite-ignore */ pathToFileURL(resolve('scripts', script)).href + '?caller-unit=' + scenario);
    expect(state.calls).toBe(1);
    const lock = resolve(state.directory, '.runtime/phase-a.lock');
    if (scenario === 'confirmed-cleanup') await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    else {
      expect((await fs.stat(lock)).isDirectory()).toBe(true);
      const owner = JSON.parse(await fs.readFile(resolve(lock, 'owner.json'), 'utf8'));
      expect(owner.runId).toBe(state.foreign ? 'foreign-unit-owner' : '1780400000000-abcdef123456');
    }
  });
}
