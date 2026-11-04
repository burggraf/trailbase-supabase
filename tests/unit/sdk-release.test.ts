import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

it('L1-26/L1-27 RQ02/RQ03 candidate automation is finite and never converts missing release acceptance into approval', async () => {
  const release = await import('../../scripts/run-release-candidate.mjs');
  expect(release.assessCandidate).toBeTypeOf('function');
  expect(release.candidateCommands.map((entry: { id: string }) => entry.id)).toEqual(['check','units','coverage','package','node','auth','auth-negative','refresh','data','database','constraints','browser','browser-refresh','example','cleanup']);
  const results = release.candidateCommands.map((entry: { id: string }) => ({ id: entry.id, status: 'passed' }));
  expect(release.assessCandidate(results, true)).toMatchObject({ automation: 'passed', qualification: 'blocked', signoff: false });
  expect(release.assessCandidate(results.slice(1), true).automation).toBe('failed');
  expect(release.assessCandidate([...results, results[0]], true).automation).toBe('failed');
  expect(release.assessCandidate(results, false).automation).toBe('failed');
  expect(release.assessCandidate(results.map((r: { id: string; status: string }) => r.id === 'cleanup' ? { ...r, status: 'failed' } : r), true).automation).toBe('failed');
  expect(release.assessCandidate(results.map((r: { id: string; status: string }) => ({ ...r, status: 'skipped' })), true).automation).toBe('failed');
  expect(release.assessCandidate(null, true).automation).toBe('failed');
});

it('L1-27/S10 RQ04 command failures do not hide later checks or cleanup; logs stay private', async () => {
  const release = await import('../../scripts/run-release-candidate.mjs');
  const attempted: string[] = [];
  const results = await release.runCandidateCommands(async (entry: { id: string }) => {
    attempted.push(entry.id);
    if (entry.id === 'auth' || entry.id === 'cleanup') throw new Error('SECRET_CANARY');
  });
  expect(attempted).toEqual(release.candidateCommands.map((entry: { id: string }) => entry.id));
  expect(results.filter((entry: { status: string }) => entry.status === 'failed').map((entry: { id: string }) => entry.id)).toEqual(['auth', 'cleanup']);
  expect(release.assessCandidate(results, true).automation).toBe('failed');
  expect(JSON.stringify(results)).not.toContain('SECRET_CANARY');
});

it('L1-27/S10 RQ04 real controller refuses an existing fixture lock without reading its owner or touching it', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'release-lock-test-'));
  try {
    await mkdir(resolve(directory, '.runtime/phase-a.lock'), { recursive: true });
    const owner = resolve(directory, '.runtime/phase-a.lock/owner.json');
    await writeFile(owner, 'SECRET_CANARY');
    expect(() => execFileSync(process.execPath, [resolve('scripts/run-release-candidate.mjs')], { cwd: directory, stdio: 'pipe' })).toThrow();
    expect(await readFile(owner, 'utf8')).toBe('SECRET_CANARY');
    await expect(readFile(resolve(directory, '.runtime/release-candidate.lock/owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
