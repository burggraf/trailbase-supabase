import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: mock.spawn }));
import * as native from '../../scripts/native-process.mjs';
it('L1-27/U27 role-only launch retains original RPC/lifetime streams before GO; normal native launch unchanged', async () => {
  const child: any = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdio = [child.stdin, child.stdout, child.stderr, null, new PassThrough(), new PassThrough()]; mock.spawn.mockReturnValue(child);
  let input = ''; child.stdin.on('data', (b: Buffer) => { input += b.toString(); });
  const owner = (native as any).createRoleProcess('/owned/node', ['/owned/role.mjs', 'runner'], { env: { PATH: '/usr/bin:/bin' }, logFd: 19 });
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); const starting = owner.start(() => gate);
  expect(mock.spawn.mock.calls[0][2].stdio).toEqual(['pipe', 'pipe', 'pipe', 19, 'pipe', 'pipe']);
  expect(owner.rpc).toBe(child.stdio[4]); expect(owner.lifetime).toBe(child.stdio[5]); expect(JSON.parse(input.trim()).roleIPC).toBe(true);
  child.stdout.write('{"type":"created","pid":517}\n'); await Promise.resolve(); expect(input).not.toContain('GO\n'); release(); await starting;
  child.stdout.write('{"type":"terminal"}\n{"type":"joined","code":0,"signal":null}\n'); child.stdout.end(); child.stderr.end(); child.emit('close', 0, null); await owner.join(); expect(owner.inventory().joined).toBe(true);
});
