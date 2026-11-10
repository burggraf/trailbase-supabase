import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Unit fixture creators use private mkdtemp leaves; TMPDIR is not set on every host.
export function unitTestEnvironment() {
  return { ...process.env, TMPDIR: tmpdir() };
}
export const exec = promisify(execFile);
export const baseline = JSON.parse(await readFile(new URL('../tests/fixtures/baseline.json', import.meta.url)));
export function verifyChecksum(bytes, expected) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Tool archive checksum mismatch');
}
export function trailToolPaths(pin = baseline.trailbase, host = `${process.platform}-${process.arch}`) {
  const platforms = { 'darwin-arm64': 'aarch64_apple_darwin', 'darwin-x64': 'x86_64_apple_darwin', 'linux-arm64': 'aarch64_linux', 'linux-x64': 'x86_64_linux' };
  if (!pin || !/^\d+\.\d+\.\d+$/.test(pin.version) || !/^[a-f0-9]{40}$/.test(pin.commit)) throw new Error('Invalid native server pin');
  const asset = pin.assets?.[host];
  if (!Object.hasOwn(platforms, host) || !asset) throw new Error('Unsupported fixture host; use Linux/macOS arm64/x64');
  if (asset.name !== `trailbase_v${pin.version}_${platforms[host]}.zip` || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid native asset pin');
  const directory = resolve('.runtime/tools/trailbase', pin.version, host);
  return { archive: resolve('.runtime/tools', asset.name), directory, binary: resolve(directory, 'trail') };
}
export async function installTrail(pin = baseline.trailbase) {
  const asset = pin.assets[`${process.platform}-${process.arch}`];
  const { archive, directory, binary } = trailToolPaths(pin);
  await mkdir(resolve('.runtime/tools'), { recursive: true, mode: 0o700 });
  let bytes;
  try { bytes = await readFile(archive); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = `${archive}.part`;
    try {
      await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', '--output', temporary,
        `https://github.com/trailbaseio/trailbase/releases/download/v${pin.version}/${asset.name}`], { timeout: 125000 });
      bytes = await readFile(temporary);
    } finally { await rm(temporary, { force: true }); }
    verifyChecksum(bytes, asset.sha256);
    await writeFile(archive, bytes, { mode: 0o600 });
  }
  verifyChecksum(bytes, asset.sha256); // Always validate cache, never trust an existing executable.
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await exec('unzip', ['-q', archive, '-d', directory]);
  await chmod(binary, 0o700);
  return binary;
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const binary = await installTrail();
  console.log(`Verified TrailBase v${baseline.trailbase.version}: ${binary}`);
}
