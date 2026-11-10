import { expect, it } from 'vitest';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createNativeProcess } from '../../scripts/native-process.mjs';

// Newly owned finite stdlib stand-ins, not TrailBase/Docker/backend or old native proof controls.
for (const mode of ['natural-output', 'explicit-stop', 'exec-failure']) it(`L1-27/U27 Linux original fork/pidfd/owning-wait ${mode}`, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'native-owner-linux-'));
  const path = resolve(directory, 'native-private.log'), log = await open(path, 'wx', 0o600);
  const program = mode === 'natural-output'
    ? 'import os\ntry:\n os.fstat(3)\n os._exit(18)\nexcept OSError:\n os.write(1,b"owned-stdout\\n");os.write(2,b"owned-stderr\\n");os._exit(17)'
    : 'import signal,time;signal.alarm(3);time.sleep(3)';
  const owner = createNativeProcess(mode === 'exec-failure' ? resolve(directory, 'absent-owned-target') : '/usr/bin/python3', ['-I', '-B', '-S', '-c', program], { env: { PATH: '/usr/bin:/bin' }, logFd: log.fd });
  try {
    await owner.start();
    if (mode === 'explicit-stop') {
      const a = owner.stop(), b = owner.stop(); expect(a).toBe(b); await a;
      expect(owner.signalCode === 'SIGTERM' || owner.exitCode === 125).toBe(true);
    } else {
      await owner.join(); expect(owner.exitCode).toBe(mode === 'natural-output' ? 17 : 127);
      const raw = await readFile(path, 'utf8');
      if (mode === 'natural-output') { expect(raw).toContain('owned-stdout\n'); expect(raw).toContain('owned-stderr\n'); }
      else expect(raw).toBe('Native fixture exec failed\n');
      await owner.stop();
    }
    expect(owner.inventory()).toMatchObject({ complete: false, terminal: true, joined: true, unknown: false });
  } finally {
    // Never delete a failed/unknown run or close its original file as though join succeeded.
    if (owner.inventory().joined) { await log.close(); await rm(directory, { recursive: true }); }
  }
});
