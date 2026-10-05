import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, lstat, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { exec } from './tools.mjs';
import { packedFilename, validatePackage, validatePackedText } from './run-sdk-package.mjs';

export function validateBrowserModules(sdk, native, modules = {}) {
  const visited = new Set();
  function visit(name, source) {
    if (visited.has(name)) return;
    visited.add(name);
    if (typeof source !== 'string' || /\bimport\s*\(/.test(source)) throw new Error('Unsupported packed SDK import graph');
    const dependencies = [...source.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const dependency of dependencies) {
      if (dependency === 'trailbase') continue;
      if (!['./auth.js', './common.js'].includes(dependency) || !Object.hasOwn(modules, dependency.slice(2))) throw new Error('Unsupported packed SDK import graph');
      visit(dependency, modules[dependency.slice(2)]);
    }
  }
  visit('sdk', sdk);
  if (/\b(?:from\s*|import\s*)['"]|\bimport\s*\(/.test(native)) throw new Error('Native distribution requires additional import-map entries');
}
export async function preparePackedBrowser(directory) {
  const tail = relative(resolve('.runtime/runs'), resolve(directory));
  if (!/^\d{13}-[a-f0-9]{12}$/.test(tail) || JSON.parse(await readFile(resolve(directory, 'owner.json'))).id !== tail) throw new Error('Phase A packed browser ownership mismatch');
  const root = resolve('.'), work = resolve(directory, 'sdk-package');
  await mkdir(work, { mode: 0o700 });
  let diagnostics = '';
  async function run(command, args, cwd = root, timeout = 60000) {
    try { const result = await exec(command, args, { cwd, timeout, maxBuffer: 2_000_000 }); diagnostics += result.stdout + result.stderr; return result.stdout; }
    catch (error) { diagnostics += String(error.stdout ?? '') + String(error.stderr ?? ''); throw new Error('Phase A packed browser preparation failed; inspect private diagnostics'); }
    finally { await writeFile(resolve(directory, 'sdk-browser-prepare-private.log'), diagnostics, { mode: 0o600 }); }
  }
  await run(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.sdk.json']);
  const metadata = JSON.parse(await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work]));
  const tarball = resolve(work, packedFilename(metadata));
  const files = (await run('tar', ['-tzf', tarball])).trim().split('\n').map(file => {
    if (!file.startsWith('package/')) throw new Error('Phase A packed browser archive prefix mismatch'); return file.slice(8);
  });
  validatePackage(JSON.parse(await readFile('package.json')), files);
  const listing = (await run('tar', ['-tvzf', tarball])).trim().split('\n');
  if (listing.some(line => !line.startsWith('-'))) throw new Error('Phase A packed browser archive contains links');
  for (const file of files) validatePackedText(await run('tar', ['-xOzf', tarball, `package/${file}`]));
  const consumer = resolve(work, 'consumer'); await mkdir(consumer);
  await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer, 120000);
  const sdkPath = resolve(consumer, 'node_modules/trailbase-supabase/dist/index.js');
  const nativePath = resolve(consumer, 'node_modules/trailbase/dist/index.js');
  for (const file of [sdkPath, nativePath]) if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error('Phase A packed browser installed module is a link');
  const sdk = await readFile(sdkPath, 'utf8'), native = await readFile(nativePath, 'utf8');
  const modules = {};
  for (const name of ['auth.js', 'common.js']) {
    const file = resolve(consumer, 'node_modules/trailbase-supabase/dist', name);
    if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error('Phase A packed browser installed module is a link');
    modules[name] = await readFile(file, 'utf8');
  }
  if (JSON.parse(await readFile(resolve(consumer, 'node_modules/trailbase/package.json'))).version !== '0.14.3') throw new Error('Phase A packed browser native pin drift');
  validateBrowserModules(sdk, native, modules);
  const target = resolve(directory, 'public/sdk-data'); await mkdir(target);
  await cp(sdkPath, resolve(target, 'sdk.js')); await cp(nativePath, resolve(target, 'trailbase.js'));
  for (const name of Object.keys(modules)) await cp(resolve(consumer, 'node_modules/trailbase-supabase/dist', name), resolve(target, name));
  await cp('examples/todos/app.js', resolve(target, 'app.js'));
  const html = (await readFile('examples/todos/index.html', 'utf8')).replace('<!-- sdk-import-map -->', '<script type="importmap">{"imports":{"trailbase":"/sdk-data/trailbase.js"}}</script>');
  await writeFile(resolve(target, 'index.html'), html);
  const digest = value => createHash('sha256').update(value).digest('hex');
  return { package: 'trailbase-supabase@0.0.0', native: 'trailbase@0.14.3', tarballSha256: digest(await readFile(tarball)), sdkSha256: digest(sdk), moduleSha256: Object.fromEntries(Object.entries(modules).map(([name, source]) => [name, digest(source)])), nativeSha256: digest(native), imports: { trailbase: '/sdk-data/trailbase.js' } };
}
