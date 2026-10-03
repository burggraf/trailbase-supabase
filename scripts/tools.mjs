import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const exec = promisify(execFile);
export const baseline = JSON.parse(await readFile(new URL('../tests/fixtures/baseline.json', import.meta.url)));
export function verifyChecksum(bytes, expected) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Tool archive checksum mismatch');
}
export async function installTrail() {
  const asset = baseline.trailbase.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('Unsupported fixture host; use Linux/macOS arm64/x64');
  const cache = resolve('.runtime/tools');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archive = resolve(cache, asset.name);
  let bytes;
  try { bytes = await readFile(archive); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = `${archive}.part`;
    try {
      await exec('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', '--output', temporary,
        `https://github.com/trailbaseio/trailbase/releases/download/v${baseline.trailbase.version}/${asset.name}`], { timeout: 125000 });
      bytes = await readFile(temporary);
    } finally { await rm(temporary, { force: true }); }
    verifyChecksum(bytes, asset.sha256);
    await writeFile(archive, bytes, { mode: 0o600 });
  }
  verifyChecksum(bytes, asset.sha256); // Always validate cache, never trust an existing executable.
  const directory = resolve(cache, `${process.platform}-${process.arch}`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await exec('unzip', ['-q', archive, '-d', directory]);
  const binary = resolve(directory, 'trail');
  await chmod(binary, 0o700);
  return binary;
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const binary = await installTrail();
  console.log(`Verified TrailBase v${baseline.trailbase.version}: ${binary}`);
}
