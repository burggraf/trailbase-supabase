import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Context } from '../phase-a/helpers.js';
import { authOperationWithCleanup } from '../proofs/auth-operation-diagnostics.js';

const owned: { directory: string; owner: string }[] = [];
async function fixture() {
  const id = `${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 12)}`, directory = resolve('.runtime/runs', id), project = `trailbase-supabase-test-${id.split('-')[1]}`;
  await mkdir(resolve('.runtime/runs'), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  const owner = JSON.stringify({ id, project, runnerPid: process.pid, nativeServerProfile: 'default', nativeAuthProfile: 'default', authVariant: 'stock' });
  await writeFile(resolve(directory, 'owner.json'), owner, { mode: 0o600 }); owned.push({ directory, owner });
  return { id, directory, project, origins: [], trailUrl: 'http://127.0.0.1:4000', supabaseUrl: 'http://127.0.0.1:4001', mailUrl: 'http://127.0.0.1:4002', anonKey: 'unit-placeholder', nativeServerProfile: 'default', nativeAuthProfile: 'default', authVariant: 'stock' } satisfies Context;
}
afterEach(async () => { for (const item of owned.splice(0)) { expect(await readFile(resolve(item.directory, 'owner.json'), 'utf8')).toBe(item.owner); await rm(item.directory, { recursive: true }); } });
it('AL test-only diagnostics preserve primary/cleanup errors in order and still run independent cleanup', async () => {
  const env = await fixture(), primary = new Error('synthetic primary', { cause: new Error('synthetic nested cause') }), cleanup = new Error('synthetic cleanup'); let completed = false;
  const error = await authOperationWithCleanup(env, 'native', async () => { throw primary; }, [async () => { throw cleanup; }, async () => { completed = true; }]).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([primary, cleanup]); expect(error.cause).toBe(primary); expect(completed).toBe(true);
  const path = resolve(env.directory, 'auth-operation-native-primary-private.log'); expect(await readFile(path, 'utf8')).toContain('synthetic nested cause'); expect((await lstat(path)).mode & 0o777).toBe(0o600);
  expect(await readFile(resolve(env.directory, 'auth-operation-native-cleanup-0-private.log'), 'utf8')).toContain('synthetic cleanup');
});
it('AL diagnostic success creates no error log and does not change cleanup semantics', async () => {
  const env = await fixture(), calls: string[] = [];
  await authOperationWithCleanup(env, 'expiry', async () => { calls.push('body'); }, [async () => { calls.push('cleanup'); }]); expect(calls).toEqual(['body', 'cleanup']); expect(await readdir(env.directory)).toEqual(['owner.json']);
});
it('AL diagnostic ownership and fixed filename validation reject before invoking work', async () => {
  const env = await fixture(); let called = false; const work = async () => { called = true; };
  await expect(authOperationWithCleanup(env, '../foreign', work, [work])).rejects.toThrow('Invalid AL diagnostic target');
  await expect(authOperationWithCleanup({ ...env, project: 'foreign' }, 'native', work, [work])).rejects.toThrow('fixture owner mismatch'); expect(called).toBe(false); expect(await readdir(env.directory)).toEqual(['owner.json']);
});
it('AL diagnostic collision retains original bytes and the actual primary rather than overwriting evidence', async () => {
  const env = await fixture(), primary = new Error('synthetic primary'), path = resolve(env.directory, 'auth-operation-native-primary-private.log'); await writeFile(path, 'original evidence', { mode: 0o600, flag: 'wx' });
  const error = await authOperationWithCleanup(env, 'native', async () => { throw primary; }, []).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError); expect(error.errors[0]).toBe(primary); expect(error.errors[1].code).toBe('EEXIST'); expect(error.cause).toBe(primary); expect(await readFile(path, 'utf8')).toBe('original evidence');
});
it('AL private observation preserves assertion reach and the original failure before cleanup closes its resource', async () => {
  const env = await fixture(), primary = new Error('synthetic original'); let closed = false;
  const error = await authOperationWithCleanup(env, 'chromium', async () => { throw primary; }, [async () => { closed = true; }], async () => { expect(closed).toBe(false); return { checks: [{ label: 'synthetic failed check', passed: false }] }; }).catch(error => error);
  expect(error).toBe(primary); expect(closed).toBe(true); const raw = await readFile(resolve(env.directory, 'auth-operation-chromium-primary-private.log'), 'utf8'); expect(raw).toContain('synthetic original'); expect(raw).toContain('synthetic failed check');
});
it('AL observation failure retains both actual errors and still runs independent cleanup', async () => {
  const env = await fixture(), primary = new Error('synthetic primary'), capture = new Error('synthetic capture'); let cleaned = false;
  const error = await authOperationWithCleanup(env, 'native', async () => { throw primary; }, [async () => { cleaned = true; }], async () => { throw capture; }).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([primary, capture]); expect(error.cause).toBe(primary); expect(cleaned).toBe(true); expect(await readdir(env.directory)).toEqual(['owner.json']);
});
it('AL private diagnostics enforce the unchanged1MiB bound without discarding the primary', async () => {
  const env = await fixture(), primary = new Error('x'.repeat(1048577));
  const error = await authOperationWithCleanup(env, 'native', async () => { throw primary; }, []).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError); expect(error.errors[0]).toBe(primary); expect(error.errors[1].message).toBe('AL private diagnostic exceeds1MiB'); expect(await readdir(env.directory)).toEqual(['owner.json']);
});
