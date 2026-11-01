import { expect, it } from 'vitest';

it('L1-26/P26 pack metadata accepts one exact package in array or keyed-object form', async () => {
  const module = await import('../../scripts/run-sdk-package.mjs');
  const validate = Reflect.get(module, 'packedFilename');
  expect(typeof validate).toBe('function');
  if (typeof validate !== 'function') return;
  const entry = { name: 'trailbase-supabase', version: '0.0.0', filename: 'trailbase-supabase-0.0.0.tgz' };
  for (const result of [[entry], { 'trailbase-supabase': entry }]) expect(Reflect.apply(validate, undefined, [result])).toBe(entry.filename);
  for (const result of [[], [entry, entry], {}, { other: entry }, { 'trailbase-supabase': entry, other: entry }, [{ ...entry, filename: '../foreign.tgz' }], [{ ...entry, name: 'other' }], null]) expect(() => Reflect.apply(validate, undefined, [result])).toThrow();
});

it('L1-26/P26 clean consumer uses only existing locked native runtime versions despite newer registry metadata', async () => {
  const { readFile } = await import('node:fs/promises');
  const module = await import('../../scripts/run-sdk-package.mjs');
  const manifest = Reflect.get(module, 'packedConsumerManifest');
  expect(manifest).toBeTypeOf('function');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  expect(manifest(lock)).toEqual({ private: true, type: 'module', overrides: { '@types/geojson': '7946.0.16', '@ungap/raw-json': '0.4.4', geojson: '0.5.0', 'jwt-decode': '4.0.0', uuid: '14.0.2' } });
  for (const invalid of [{ packages: {} }, { packages: { 'node_modules/trailbase': { version: '0.14.3', dependencies: { missing: '^1.0.0' } } } }]) expect(() => manifest(invalid)).toThrow();
});

it('L1-26/P26 installed consumer native runtime versions and integrity must match the original lock', async () => {
  const { readFile } = await import('node:fs/promises');
  const module = await import('../../scripts/run-sdk-package.mjs');
  const verify = Reflect.get(module, 'verifyPackedConsumerRuntime');
  expect(verify).toBeTypeOf('function');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  expect(() => verify(lock, structuredClone(lock))).not.toThrow();
  for (const name of ['trailbase', ...Object.keys(module.packedConsumerManifest(lock).overrides)]) for (const field of ['version', 'integrity']) {
    const installed = structuredClone(lock);
    installed.packages[`node_modules/${name}`][field] = 'unexpected';
    expect(() => verify(lock, installed)).toThrow('Installed runtime dependency lock drift');
  }
});

const files = ['LICENSE', 'README.md', 'dist/auth.d.ts', 'dist/auth.js', 'dist/common.d.ts', 'dist/common.js', 'dist/index.d.ts', 'dist/index.js', 'package.json'];
const manifest = { name: 'trailbase-supabase', version: '0.0.0', private: true, license: 'MIT', type: 'module', main: './dist/index.js', types: './dist/index.d.ts', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }, files: files.filter(file => file !== 'package.json'), dependencies: { trailbase: '0.14.3' } };

it('L1-02/P02 L1-26/P26 package guard accepts only the private built ESM/declaration subset', async () => {
  const { validatePackage } = await import('../../scripts/run-sdk-package.mjs');
  expect(() => validatePackage(manifest, files)).not.toThrow();
});
it('L1-26/P26 package guard rejects missing and extra source/runtime/test/credential or traversal files', async () => {
  const { validatePackage } = await import('../../scripts/run-sdk-package.mjs');
  for (const extra of ['src/index.ts', '.runtime/context.json', 'tests/fixtures/config.json', '.env', '../index.js', 'dist/index.js.map']) expect(() => validatePackage(manifest, [...files, extra])).toThrow();
  expect(() => validatePackage(manifest, files.filter(file => file !== 'dist/index.d.ts'))).toThrow();
});
it('L1-26/P26 package guard rejects public-name/entry/pin drift', async () => {
  const { validatePackage } = await import('../../scripts/run-sdk-package.mjs');
  for (const invalid of [{ ...manifest, private: false }, { ...manifest, name: '@trailbase/supabase' }, { ...manifest, main: './src/index.ts' }, { ...manifest, types: './src/index.ts' }, { ...manifest, dependencies: { trailbase: '^0.14.3' } }, { ...manifest, exports: { '.': './src/index.ts' } }, { ...manifest, files: ['dist', '.runtime'] }]) expect(() => validatePackage(invalid, files)).toThrow();
});
it('L1-26/P26 package content guard rejects credential material without logging its content', async () => {
  const { validatePackedText } = await import('../../scripts/run-sdk-package.mjs');
  expect(() => validatePackedText('export const example = "placeholder";')).not.toThrow();
  for (const text of ['-----BEGIN PRIVATE KEY-----', `eyJ${'x'.repeat(30)}`, `Bearer ${'x'.repeat(24)}`, '"SERVICE_ROLE_KEY":"placeholder"']) expect(() => validatePackedText(text)).toThrow('Unsafe');
});
