import { expect, it } from 'vitest';
import { validatePackage } from '../../scripts/run-sdk-package.mjs';
import { validateBrowserModules } from '../../scripts/sdk-browser.mjs';
import { readFile } from 'node:fs/promises';
const files = ['LICENSE', 'README.md', 'dist/auth.d.ts', 'dist/auth.js', 'dist/common.d.ts', 'dist/common.js', 'dist/index.d.ts', 'dist/index.js', 'package.json'];
it('L1-26/P26 auth module split must ship all and only runtime/declaration modules', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')); const next = { ...manifest, files: files.filter(file => file !== 'package.json') };
  expect(() => validatePackage(next, files)).not.toThrow();
  for (const missing of ['dist/auth.js', 'dist/common.d.ts']) expect(() => validatePackage(next, files.filter(file => file !== missing))).toThrow();
});
it('L1-26/E13 browser serving validates complete closed auth/common module graph', () => {
  const sdk = "import x from 'trailbase'; import y from './auth.js'; import z from './common.js';";
  const modules = { 'auth.js': "import x from 'trailbase'; import y from './common.js';", 'common.js': "import x from 'trailbase';" };
  expect(() => validateBrowserModules(sdk, 'export {};', modules)).not.toThrow();
  expect(() => validateBrowserModules(sdk, 'export {};')).toThrow();
  expect(() => validateBrowserModules(sdk, 'export {};', { ...modules, 'auth.js': "import x from 'missing';" })).toThrow();
});
it('L1-26/E13 rejects missing or foreign side-effect imports at every shipped module depth', () => {
  const native = 'export {};';
  expect(() => validateBrowserModules("import './missing.js';", native)).toThrow();
  expect(() => validateBrowserModules("import './auth.js';", native, { 'auth.js': "import './missing.js';" })).toThrow();
  expect(() => validateBrowserModules("import './auth.js';", native, { 'auth.js': "import './common.js';", 'common.js': "import 'foreign';" })).toThrow();
  expect(() => validateBrowserModules("import './auth.js';", native, { 'auth.js': "import './common.js';", 'common.js': "import 'trailbase';" })).not.toThrow();
});
it('L1-26/E13 rejects native inline side-effect imports and compact reexports without import-map entries', () => {
  for (const native of ["export {}; import './missing.js';", "export {}; import'foreign';", "export { x } from'foreign';"]) expect(() => validateBrowserModules('export {};', native)).toThrow();
});
