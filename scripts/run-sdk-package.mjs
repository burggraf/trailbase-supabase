import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, baseline } from './tools.mjs';

export function packedFilename(metadata) {
  let entries;
  if (Array.isArray(metadata)) entries = metadata;
  else if (metadata && typeof metadata === 'object' && Object.keys(metadata).length === 1 && Object.hasOwn(metadata, 'trailbase-supabase')) entries = [metadata['trailbase-supabase']];
  else throw new Error('Unexpected packed metadata');
  const entry = entries[0];
  if (entries.length !== 1 || entry?.name !== 'trailbase-supabase' || entry?.version !== '0.0.0' || entry?.filename !== 'trailbase-supabase-0.0.0.tgz') throw new Error('Unexpected packed artifact');
  return entry.filename;
}

export function packedConsumerManifest(lock) {
  const native = lock.packages?.['node_modules/trailbase'];
  if (native?.version !== '0.14.3' || !native.dependencies) throw new Error('Missing pinned native dependency graph');
  const overrides = Object.fromEntries(Object.keys(native.dependencies).map(name => {
    const version = lock.packages[`node_modules/${name}`]?.version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Missing exact locked runtime dependency');
    return [name, version];
  }));
  return { private: true, type: 'module', overrides };
}

export function verifyPackedConsumerRuntime(lock, installedLock) {
  const names = ['trailbase', ...Object.keys(packedConsumerManifest(lock).overrides)];
  return Object.fromEntries(names.map(name => {
    const expected = lock.packages[`node_modules/${name}`], actual = installedLock.packages?.[`node_modules/${name}`];
    if (!actual || actual.version !== expected.version || !expected.integrity || actual.integrity !== expected.integrity) throw new Error('Installed runtime dependency lock drift');
    return [name, { version: actual.version, integrity: actual.integrity }];
  }));
}

const allowedFiles = ['LICENSE', 'README.md', 'dist/auth.d.ts', 'dist/auth.js', 'dist/common.d.ts', 'dist/common.js', 'dist/index.d.ts', 'dist/index.js', 'package.json'];
export function validatePackage(manifest, files) {
  if (manifest.name !== 'trailbase-supabase' || manifest.private !== true || manifest.type !== 'module' || manifest.license !== 'MIT' || manifest.main !== './dist/index.js' || manifest.types !== './dist/index.d.ts') throw new Error('Invalid private package identity/entries');
  const entry = manifest.exports?.['.'];
  if (Object.keys(manifest.exports ?? {}).length !== 1 || entry?.types !== './dist/index.d.ts' || entry?.import !== './dist/index.js' || Object.keys(entry).length !== 2) throw new Error('Invalid built ESM/declaration exports');
  if (manifest.dependencies?.trailbase !== '0.14.3' || Object.keys(manifest.dependencies).length !== 1) throw new Error('Invalid runtime dependency pin');
  if (JSON.stringify([...manifest.files ?? []].sort()) !== JSON.stringify(allowedFiles.filter(file => file !== 'package.json'))) throw new Error('Invalid package files allowlist');
  if (JSON.stringify([...files].sort()) !== JSON.stringify(allowedFiles)) throw new Error('Unexpected or missing packed file');
}
export function validatePackedText(text) {
  if (/eyJ[A-Za-z0-9_-]{20}|Bearer\s+[A-Za-z0-9._-]{20,}|-----BEGIN[^\n]*PRIVATE KEY-----|"(?:SERVICE_ROLE_KEY|refresh_token|auth_token|password)"\s*:/.test(text)) throw new Error('Unsafe packed credential material');
}

async function main() {
  // Validators are also loaded by the active harness; defer its entrypoint import.
  const { sourceHash } = await import('./run-phase-a.mjs');
  const root = resolve('.');
  let directory;
  let stage = 'initialize';
  let diagnostics = '';
  const report = { scope: 'Focused private SDK data tarball/clean Node consumer check; NOT full package/backend/browser/release verification or signoff', status: 'failed', node: process.version, baseline, checks: [], cleanup: 'not-started' };
  async function run(command, args, cwd, timeout = 60000) {
    try {
      const result = await exec(command, args, { cwd, timeout, maxBuffer: 2_000_000 });
      diagnostics += `${stage}\n${result.stdout}${result.stderr}\n`;
      return result.stdout;
    } catch (error) {
      diagnostics += `${stage}\n${String(error.stdout ?? '')}${String(error.stderr ?? '')}\n`;
      report.commandFailure = { code: typeof error.code === 'number' || typeof error.code === 'string' ? error.code : null, signal: error.signal ?? null, killed: error.killed === true };
      throw new Error('Package command failed');
    }
  }
  try {
    report.sourceSha256 = await sourceHash();
    directory = await realpath(await mkdtemp(join(tmpdir(), 'trailbase-supabase-sdk-package-')));
    await chmod(directory, 0o700);
    stage = 'build';
    await run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.sdk.json')], root);
    stage = 'manifest-guard';
    validatePackage(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), allowedFiles);
    stage = 'pack';
    const metadata = JSON.parse(await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory], root));
    const tarball = join(directory, packedFilename(metadata));
    const entries = (await run('tar', ['-tzf', tarball], directory)).trim().split('\n');
    if (entries.some(entry => !entry.startsWith('package/'))) throw new Error('Invalid archive prefix');
    validatePackage(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), entries.map(entry => entry.slice('package/'.length)));
    const listing = (await run('tar', ['-tvzf', tarball], directory)).trim().split('\n');
    if (listing.some(line => !line.startsWith('-'))) throw new Error('Archive contains nonregular files');
    stage = 'packed-content-guard';
    for (const file of allowedFiles) validatePackedText(await run('tar', ['-xOzf', tarball, `package/${file}`], directory));
    report.tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
    report.files = allowedFiles;
    report.checks.push('Exact allowlisted tarball; built ESM/declarations, private identity, native pin, no source/runtime/test/credential/symlink files');
    stage = 'clean-install';
    const consumer = join(directory, 'consumer');
    await mkdir(consumer);
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    const consumerManifest = packedConsumerManifest(lock);
    await writeFile(join(consumer, 'package.json'), JSON.stringify(consumerManifest));
    // Use npm cache only: no registry or live-backend access, no lifecycle scripts.
    await run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer, 120000);
    const installed = join(consumer, 'node_modules/trailbase-supabase');
    if (await realpath(installed) !== installed || (await lstat(installed)).isSymbolicLink()) throw new Error('Installed package is a workspace/source link');
    for (const file of allowedFiles) if (!(await lstat(join(installed, file))).isFile()) throw new Error('Installed file is not regular');
    const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    validatePackage(installedManifest, allowedFiles);
    const nativeManifest = JSON.parse(await readFile(join(consumer, 'node_modules/trailbase/package.json'), 'utf8'));
    if (nativeManifest.version !== '0.14.3') throw new Error('Installed native client pin drift');
    report.runtimeDependencies = verifyPackedConsumerRuntime(lock, JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8')));
    for (const [name, expected] of Object.entries(report.runtimeDependencies)) {
      if (JSON.parse(await readFile(join(consumer, 'node_modules', name, 'package.json'), 'utf8')).version !== expected.version) throw new Error('Installed runtime dependency lock drift');
    }
    report.installed = { sdk: `${installedManifest.name}@${installedManifest.version}`, native: `trailbase@${nativeManifest.version}`, compiler: JSON.parse(await readFile(join(root, 'node_modules/typescript/package.json'), 'utf8')).version };
    report.checks.push('Offline clean Node install from tarball; no repository/source/workspace import or SDK symlink');
    stage = 'shipped-type-consumer';
    const types = (await readFile(join(root, 'tests/types/sdk-data.ts'), 'utf8')).replaceAll('../../src/index.js', 'trailbase-supabase');
    if (types.includes('../../src/') || !types.includes("from 'trailbase-supabase'")) throw new Error('Type consumer does not use shipped package');
    await writeFile(join(consumer, 'consumer.ts'), types);
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [] }, include: ['consumer.ts'] }));
    await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], consumer);
    report.checks.push('Generated Database positive/negative consumer compiled against installed tarball declarations and installed native dependency');
    stage = 'installed-data-transport';
    await writeFile(join(consumer, 'consumer.mjs'), await readFile(join(root, 'tests/package/sdk-data-consumer.mjs')));
    await run(process.execPath, ['consumer.mjs'], consumer);
    report.checks.push('Installed package transport boundary: lazy/fresh/isolated reads, codecs/filters/bounds/cardinality, null CRUD, validation and no automatic replay');
    const entryText = await readFile(join(installed, 'dist/index.js'), 'utf8');
    if (!entryText.includes("from 'trailbase'") || /(?:from\s+['"]node:|\brequire\s*\()/.test(entryText)) throw new Error('Unexpected browser ESM entry dependency');
    report.browser = { entry: './dist/index.js', format: 'ESM', nativeImport: 'trailbase@0.14.3', requirement: 'Bundler or complete import map must resolve trailbase and its transitive ESM imports; no standalone browser bundle is shipped', executed: false };
    report.missing = ['Installed-tarball real backend proof', 'Real Chromium/Firefox/WebKit consumer and built application proof', 'Auth/full package/security/coverage/CI/release layers and maintainer signoff'];
    if (await sourceHash() !== report.sourceSha256) throw new Error('Sources changed during package check');
    report.status = 'passed';
  } catch {
    report.failureStage = stage;
    console.error(`Focused SDK package check failed at ${stage}; private diagnostics retained.`);
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); report.cleanup = 'passed'; }
    catch { report.cleanup = 'failed'; report.status = 'failed'; }
    await mkdir('.runtime', { recursive: true, mode: 0o700 });
    await writeFile('.runtime/sdk-package.log', diagnostics, { mode: 0o600 });
    await mkdir('artifacts/sdk-package', { recursive: true });
    await writeFile('artifacts/sdk-package/latest.json', JSON.stringify(report, null, 2) + '\n');
    console.log(`Focused SDK package subset: ${report.status}; owned temporary cleanup ${report.cleanup}. Sanitized evidence: artifacts/sdk-package/latest.json`);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
