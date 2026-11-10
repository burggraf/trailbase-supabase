import { beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: mock.spawn }));
import { createNativeProcess } from '../../scripts/native-process.mjs';
let child: any, input: string, owner: any;
const frame = (value: object) => child.stdout.write(JSON.stringify(value) + '\n');
const turn = () => new Promise(resolve => setImmediate(resolve));
const joined = () => { frame({ type: 'terminal' }); frame({ type: 'joined', code: 0, signal: null }); };
const close = (code = 0) => { child.stdout.end(); child.stderr.end(); child.emit('exit', code, null); child.emit('close', code, null); };
beforeEach(() => {
  input = ''; child = new EventEmitter(); child.pid = 313;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin.on('data', (b: Buffer) => { input += b.toString(); }); child.kill = vi.fn(() => { throw Error('Numeric signalling forbidden'); });
  mock.spawn.mockReset().mockReturnValue(child);
  owner = createNativeProcess('/owned/trail', ['--depot', '/owned/depot'], { env: { PATH: '/usr/bin:/bin' }, logFd: 19 });
});
it('L1-27/U27 native owner gates target exec behind original creation and owner recording', async () => {
  let release!: () => void; const recorded = new Promise<void>(r => { release = r; });
  const start = owner.start(async (pid: number) => { expect(pid).toBe(517); await recorded; });
  expect(mock.spawn.mock.calls[0][0]).toBe('/usr/bin/python3');
  expect(mock.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['-I', '-B', '-S']));
  expect(mock.spawn.mock.calls[0][2].stdio).toEqual(['pipe', 'pipe', 'pipe', 19]);
  frame({ type: 'created', pid: 517 }); await turn(); expect(input).not.toContain('GO\n');
  release(); await start; expect(input.endsWith('GO\n')).toBe(true); expect(owner.pid).toBe(517);
  joined(); close(); await owner.stop(); expect(child.kill).not.toHaveBeenCalled();
});
it('L1-27/U27 native owner retains original channel, refuses repeat launch and coalesces stop', async () => {
  const start = owner.start(); frame({ type: 'created', pid: 517 }); await start;
  await expect(owner.start()).rejects.toThrow(); const a = owner.stop(), b = owner.stop(); expect(a).toBe(b);
  expect(input.split('STOP\n')).toHaveLength(2); joined(); close(); await a;
  expect(mock.spawn).toHaveBeenCalledTimes(1); expect(child.kill).not.toHaveBeenCalled();
});
it('L1-27/U27 native owner does not replace join with observed terminal state or a joined frame alone', async () => {
  const start = owner.start(); frame({ type: 'created', pid: 517 }); await start;
  let done = false; const stop = owner.stop().then(() => { done = true; });
  frame({ type: 'terminal' }); await turn(); expect(owner.exited).toBe(true); expect(done).toBe(false);
  frame({ type: 'joined', code: 0, signal: null }); await turn(); expect(done).toBe(false);
  close(); await stop; expect(owner.exitCode).toBe(0);
});
it.each(['missing-join', 'helper-failed', 'malformed', 'duplicate-join'])('L1-27/U27 native owner retains %s as sticky unknown', async fault => {
  const start = owner.start(); frame({ type: 'created', pid: 517 }); await start;
  const stop = owner.stop(); const observed = expect(stop).rejects.toThrow();
  if (fault === 'malformed') child.stdout.write('not-json\n');
  else if (fault !== 'missing-join') { joined(); if (fault === 'duplicate-join') frame({ type: 'joined', code: 0, signal: null }); }
  close(fault === 'helper-failed' ? 1 : 0); await observed; await expect(owner.stop()).rejects.toThrow();
  expect(child.kill).not.toHaveBeenCalled(); expect(input.split('STOP\n')).toHaveLength(2);
});
it('L1-27/U27 native owner retains the same object after owner-recording failure, without GO', async () => {
  const failure = Error('owner record write failed'); const start = owner.start(async () => { throw failure; });
  frame({ type: 'created', pid: 517 }); await expect(start).rejects.toBe(failure); expect(input).not.toContain('GO\n');
  const stop = owner.stop(); joined(); close(); await stop;
});
it('L1-27/U27 native owner stops a gated target without later releasing it through concurrent start', async () => {
  let release!: () => void; const recorded = new Promise<void>(r => { release = r; });
  const start = owner.start(() => recorded); const refused = expect(start).rejects.toThrow();
  frame({ type: 'created', pid: 517 }); await turn(); const stop = owner.stop(); release(); await refused;
  expect(input).not.toContain('GO\n'); joined(); close(); await stop;
});
it('L1-27/U27 native owner returns frozen partial observations, not PID control/adoption', () => {
  expect(Object.isFrozen(owner)).toBe(true); expect(Object.isFrozen(owner.inventory())).toBe(true);
  expect(owner.inventory()).toMatchObject({ complete: false, pid: null, joined: false });
  expect(owner.kill).toBeUndefined(); expect(owner.fromPid).toBeUndefined();
});
it('L1-27/U27 native owner can join natural exit without sending any stop request', async () => {
  const start = owner.start(); frame({ type: 'created', pid: 517 }); await start;
  const waiting = owner.join(); joined(); close(); await waiting; expect(input).not.toContain('STOP\\n');
});
it('L1-27/U27 native owner observes early native exit but still awaits original helper close', async () => {
  const start = owner.start(); frame({ type: 'created', pid: 517 }); await start;
  frame({ type: 'terminal' }); frame({ type: 'joined', code: null, signal: 'SIGTERM' });
  expect(owner.signalCode).toBe('SIGTERM'); close(); await owner.stop(); expect(input).not.toContain('STOP\n');
});
