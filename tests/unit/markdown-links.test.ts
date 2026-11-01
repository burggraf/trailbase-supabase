import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const validator = async () => {
  const module = await import('../../scripts/markdown-links.mjs').catch(() => ({}));
  const validate = Reflect.get(module, 'validateMarkdownLinks');
  expect(validate).toBeTypeOf('function');
  return validate;
};

it('L1-26/L1-27/U27 tracked parent-relative links, external URLs and anchors remain valid', async () => {
  const validate = await validator();
  expect(() => validate('docs/evidence/review.md', '## Review\n\n[Root](../../README.md)\n', new Set(['README.md']))).not.toThrow();
  expect(() => validate('docs/plans/example.md', '[Readme](../../README.md) [section](#scope) [web](https://example.test/path) [plan](../PLAN.md#scope)', new Set(['README.md', 'docs/PLAN.md']))).not.toThrow();
  for (const target of ['../../artifacts/only-local.png', '../../.runtime/private.json', '../../../outside.md', '../missing.md']) {
    expect(() => validate('docs/plans/example.md', `[target](${target})`, new Set(['README.md']))).toThrow('not in the Git index');
  }
});

it('L1-26/L1-27/S10 ignored and untracked files cannot satisfy links even when present on disk', async () => {
  const validate = await validator(), directory = await mkdtemp(join(tmpdir(), 'todos-doc-index-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  try {
    git('init', '--quiet');
    await mkdir(join(directory, 'artifacts'));
    await writeFile(join(directory, '.gitignore'), 'artifacts/\n');
    await writeFile(join(directory, 'README.md'), '# Example\n\n[Local image](artifacts/present.png)\n');
    await writeFile(join(directory, 'artifacts/present.png'), 'generated test-only image stand-in');
    await writeFile(join(directory, 'pending.md'), '# Not staged\n');
    git('add', '.gitignore', 'README.md');
    const inventory = () => new Set(git('ls-files', '--cached', '-z').split('\0').filter(Boolean));
    expect(await readFile(join(directory, 'artifacts/present.png'), 'utf8')).not.toBe('');
    expect(() => validate('README.md', '[image](artifacts/present.png)', inventory())).toThrow('not in the Git index');
    expect(() => validate('README.md', '[pending](pending.md)', inventory())).toThrow('not in the Git index');
    git('add', 'pending.md');
    expect(() => validate('README.md', '[pending](pending.md)', inventory())).not.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
