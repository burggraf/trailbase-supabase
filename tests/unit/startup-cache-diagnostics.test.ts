import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../scripts/tools.mjs', async importOriginal => ({ ...await importOriginal<any>(), exec: vi.fn() }));
import * as diagnostics from '../../scripts/startup-diagnostics.mjs';
import { exec } from '../../scripts/tools.mjs';
import { readFile } from 'node:fs/promises';
const candidate = Reflect.get(diagnostics, 'collectSupabaseStartupCache');
const collect: (project: unknown) => Promise<any> = typeof candidate === 'function' ? candidate as any : async () => null;
const project = 'trailbase-supabase-test-0123456789ab';
const pins = JSON.parse(await readFile('tests/fixtures/service-images.json', 'utf8'));
beforeEach(() => { vi.mocked(exec).mockReset(); });

it('L1-27/D04 cache reads only the exact pinned service image references with bounded read-only commands', async () => {
  vi.mocked(exec).mockImplementation((async (_command: any, args: any) => ({ stdout: JSON.stringify((Object.values(pins) as any[]).find((p: any) => p.image === args[4])?.repoDigests), stderr: '' })) as any);
  const result = await collect(project);
  expect(result).toEqual(['supabase_auth', 'supabase_db', 'supabase_inbucket', 'supabase_kong', 'supabase_realtime', 'supabase_rest'].map(service => ({ service, cache: 'pinned' })));
  expect(vi.mocked(exec).mock.calls).toHaveLength(6);
  for (const [binary, args, options] of vi.mocked(exec).mock.calls as any[]) {
    expect(binary).toBe('docker'); expect(args.slice(0, 4)).toEqual(['image', 'inspect', '--format', '{{json .RepoDigests}}']);
    expect(Object.values(pins).map((p: any) => p.image)).toContain(args[4]);
    expect(args).toHaveLength(5); expect(options).toEqual({ timeout: 5000, maxBuffer: 4096 });
  }
});

it('L1-27/D04 missing image, mismatched digest and failed inspection remain distinct', async () => {
  vi.mocked(exec).mockRejectedValue({ stderr: 'Error response from daemon: No such image: PRIVATE_CANARY' });
  expect((await collect(project))?.every((s: any) => s.cache === 'not-present')).toBe(true);
  vi.mocked(exec).mockResolvedValue({ stdout: '["PRIVATE_CANARY"]', stderr: '' } as any);
  expect((await collect(project))?.every((s: any) => s.cache === 'not-pinned')).toBe(true);
  for (const failure of [{ stderr: 'PRIVATE_CANARY' }, Object.create({ stderr: 'Error response from daemon: No such image: inherited' })]) {
    vi.mocked(exec).mockRejectedValue(failure);
    const result = await collect(project);
    expect(result?.every((s: any) => s.cache === 'unavailable')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY');
  }
});

it('L1-27/D04 malformed inspection output never forwards values or invents cache presence', async () => {
  for (const stdout of ['{"includes":"PRIVATE_CANARY"}', '{', 'null', '[]']) {
    vi.mocked(exec).mockResolvedValue({ stdout, stderr: '' } as any);
    const result = await collect(project);
    expect(result?.every((s: any) => ['unavailable', 'not-pinned'].includes(s.cache))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY');
  }
});

it('L1-27/D04 rejects foreign projects before any image inspection', async () => {
  for (const value of ['', 'linked-project', '--help', `${project}\n`, null]) await expect(collect(value)).rejects.toThrow('Invalid owned startup diagnostic project');
  expect(exec).not.toHaveBeenCalled();
});
