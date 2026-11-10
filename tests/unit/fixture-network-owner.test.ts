import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const mock = vi.hoisted(() => ({ exec: vi.fn(), install: vi.fn() }));
vi.mock('../../scripts/tools.mjs', async original => ({ ...await original<typeof import('../../scripts/tools.mjs')>(), exec: mock.exec, installTrail: mock.install }));
// Network models retain their exact exec boundary; actual CLI ownership is independently exercised.
vi.mock('../../scripts/fixture-cli.mjs',()=>({createFixtureFrontendCli:(_files:unknown,env:unknown)=>({run:(_name:string,args:string[])=>mock.exec(resolve('node_modules/.bin/supabase'),args,{env,timeout:300000,maxBuffer:20000000}),fence:async()=>{},inventory:async()=>({complete:false,unknown:false,commands:[]})})}));
vi.mock('../../scripts/fixture-docker.mjs',async()=>{const m=await import('../fixtures/docker-command-model.js');return{localDockerTarget:m.localDockerTarget,createFixtureDocker:(_f:unknown,env:any)=>m.dockerCommandModel(mock.exec,env)};});
import { fixtureNetwork } from '../../scripts/fixture-network.mjs';
import { dockerCommandModel } from '../fixtures/docker-command-model.js';
import { createHarness, cli, assertRunDirectory } from '../../scripts/harness.mjs';
import { baseline } from '../../scripts/tools.mjs';
const run = '1780400000000-abcdef123456', host = 'unix:///fixture/docker.sock', id = 'a'.repeat(64);
let owner = run, engine = 'original-engine', exists = false, collision = false, endpoints: object = {}, changed: Record<string, unknown>;
let createError: Error | undefined, removeError: Error | undefined, reply: string, pause: Promise<void> | undefined;
const name = () => 'supabase_network_trailbase-supabase-test-' + owner.split('-')[1];
const calls = (verb: string) => mock.exec.mock.calls.filter(([file, args]) => file === 'docker' && args.includes(verb));
beforeEach(() => {
  vi.clearAllMocks(); owner = run; engine = 'original-engine'; exists = false; collision = false; endpoints = {}; changed = {}; createError = undefined; removeError = undefined; pause = undefined; reply = id;
  mock.install.mockResolvedValue('/fixture/trail');
  mock.exec.mockImplementation(async (file: string, args: string[]) => {
    if (file === cli && args[0] === '--version') return { stdout: baseline.supabaseCli + '\n', stderr: '' };
    if (file === cli && args[0] === 'start') throw Error('test stops before real Supabase start');
    if (file !== 'docker') return { stdout: args[0] === '--version' ? 'TrailBase v' + baseline.trailbase.version : '', stderr: '' };
    const a = args[0] === '--host' ? args.slice(2) : args;
    let out = '';
    if (a[0] === 'context') out = host;
    else if (a[0] === 'info') out = engine;
    else if (a[0] === 'network' && a[1] === 'create') { await pause; if (createError) throw createError; exists = true; out = reply; }
    else if (a[0] === 'network' && a[1] === 'ls') out = a.some(x => x === 'id=' + id) ? (exists ? id : '') : (collision ? 'b'.repeat(64) : '');
    else if (a[0] === 'network' && a[1] === 'inspect') out = JSON.stringify({ Id: id, Name: name(), Driver: 'bridge', Scope: 'local', Labels: { 'trailbase-supabase.run': owner }, Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' }, Containers: endpoints, ...changed });
    else if (a[0] === 'network' && a[1] === 'rm') { if (removeError) throw removeError; expect(a).toEqual(['network', 'rm', id]); exists = false; out = id; }
    return { stdout: out + (out ? '\n' : ''), stderr: '' };
  });
});
const factory = () => { const env={ PATH:'/usr/bin:/bin',DOCKER_CONTEXT:'changed-context' };const commands=dockerCommandModel(mock.exec,env);commands.bind(host);return fixtureNetwork(owner,host,env,commands); };
describe('L1-27/U27/S01 creating-owner fixture network', () => {
  it('does not grant a cleanup ID before the actual creating operation', async () => {
    const n = factory(); expect(() => n.id).toThrow(); await expect(n.inventory()).rejects.toThrow(); await expect(n.remove()).rejects.toThrow(); expect(mock.exec).not.toHaveBeenCalled();
  });
  it('retains Docker create result and pins local transport even if ambient context differs', async () => {
    const n = factory(); await n.create(); expect(n.id).toBe(id); expect(calls('create')).toHaveLength(1);
    const call = calls('create')[0]; expect(call[1]).toEqual(['--host', host, 'network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', 'trailbase-supabase.run=' + owner, name()]);
    expect(call[2].env.DOCKER_CONTEXT).toBeUndefined(); expect(Object.isFrozen(n)).toBe(true);
    const snapshot = await n.inventory(); expect(snapshot.id).toBe(id); expect(snapshot.exists).toBe(true);
  });
  it('never adopts an existing matching network', async () => {
    collision = true; const n = factory(); await expect(n.create()).rejects.toThrow(); await expect(n.remove()).rejects.toThrow(); expect(calls('create')).toHaveLength(0); expect(calls('rm')).toHaveLength(0);
  });
  it.each(['Id', 'Name', 'Driver', 'Scope', 'Labels', 'Options'])('refuses changed %s without removing anything', async key => {
    const n = factory(); await n.create(); changed[key] = key === 'Labels' || key === 'Options' ? {} : 'foreign'; await expect(n.remove()).rejects.toThrow(); expect(calls('rm')).toHaveLength(0);
    changed = {}; await expect(n.remove()).rejects.toThrow(); expect(calls('rm')).toHaveLength(0);
  });
  it('refuses a changed daemon instead of operating on a matching ID there', async () => {
    const n = factory(); await n.create(); engine = 'other-engine'; await expect(n.remove()).rejects.toThrow(); expect(calls('rm')).toHaveLength(0);
  });
  it('keeps attached endpoints and does not force disconnect them', async () => {
    const n = factory(); await n.create(); endpoints = { ['c'.repeat(64)]: { Name: 'attached' } }; await expect(n.remove()).rejects.toThrow(); expect(calls('rm')).toHaveLength(0);
  });
  it('removes exactly its created ID and confirms absence, never name fallback/replay', async () => {
    const n = factory(); await n.create(); await n.remove(); expect(calls('rm')).toHaveLength(1); expect(exists).toBe(false); await expect(n.remove()).rejects.toThrow(); expect(calls('rm')).toHaveLength(1);
  });
  it('observes original-ID absence without deleting a same-name replacement', async () => {
    const n = factory(); await n.create(); exists = false; collision = true; await n.remove(); expect(calls('rm')).toHaveLength(0);
  });
  it('retains unknown create outcome and original error; no discovery/adoption/retry', async () => {
    const n = factory(); createError = Error('create response lost'); await expect(n.create()).rejects.toBe(createError); await expect(n.create()).rejects.toThrow(); await expect(n.remove()).rejects.toThrow(); expect(calls('create')).toHaveLength(1); expect(calls('rm')).toHaveLength(0);
  });
  it('does not turn malformed create output into an ID or cleanup permission', async () => {
    reply = 'a'.repeat(12); const n = factory(); await expect(n.create()).rejects.toThrow(); await expect(n.remove()).rejects.toThrow(); expect(calls('rm')).toHaveLength(0);
  });
  it('does not retry an unknown removal even after apparent metadata restoration', async () => {
    const n = factory(); await n.create(); removeError = Error('remove response lost'); await expect(n.remove()).rejects.toBe(removeError); removeError = undefined; await expect(n.remove()).rejects.toThrow(); expect(calls('rm')).toHaveLength(1);
  });
  it('blocks a concurrent create while original creation is pending', async () => {
    let done!: () => void; pause = new Promise<void>(r => { done = r; }); const n = factory(); const first = n.create(); await expect(n.create()).rejects.toThrow(); done(); await first; expect(calls('create')).toHaveLength(1);
  });
  it.each(['https://remote.invalid', 'unix://relative', 'unix:///tmp/../socket'])('rejects noncanonical/nonlocal daemon %s', h => { expect(() => fixtureNetwork(run, h, {}, undefined)).toThrow(); expect(mock.exec).not.toHaveBeenCalled(); });
  it('wires actual createHarness CLI and cleanup to original network ID', async () => {
    const h = await createHarness(); owner = h.context.id;
    try {
      await expect(h.start()).rejects.toThrow('Local Supabase start failed');
      const start = mock.exec.mock.calls.find(([file, a]) => file === cli && a[0] === 'start')!; expect(start[1][start[1].indexOf('--network-id') + 1]).toBe(id); expect(start[2].env.DOCKER_HOST).toBe(host); expect(start[2].env.DOCKER_CONTEXT).toBeUndefined();
      for (const [file, a, options] of mock.exec.mock.calls) if (file === 'docker' && a[0] !== 'context') {
        if (a[0] === '--host') expect(a[1]).toBe(host);
        else expect(options.env.DOCKER_HOST).toBe(host);
        expect(options.env.DOCKER_CONTEXT).toBeUndefined();
      }
      const inventory = await h.inventoryResources(); expect(inventory.network!.id).toBe(id); expect(inventory.complete).toBe(false);
      await h.cleanup(); const stop = mock.exec.mock.calls.find(([file, a]) => file === cli && a[0] === 'stop')!; expect(stop[1][stop[1].indexOf('--network-id') + 1]).toBe(id); expect(calls('rm')).toHaveLength(1);
    } finally { assertRunDirectory(h.context.directory); await rm(h.context.directory, { recursive: true }); }
  });
  it('denies disk-metadata recovery when the original creating owner is unavailable', async () => {
    const h = await createHarness(); owner = h.context.id;
    try {
      await expect(h.start()).rejects.toThrow('Local Supabase start failed');
      await expect(promisify(execFile)(process.execPath, ['scripts/cleanup.mjs', h.context.id], { env: { PATH: resolve(h.context.directory, 'no-programs'), HOME: h.context.directory }, timeout: 5000, maxBuffer: 65536 })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Original fixture network owner is unavailable') });
      await h.cleanup();
    } finally { assertRunDirectory(h.context.directory); await rm(h.context.directory, { recursive: true }); }
  });
  it('retains a partially allocated fixture when creation outcome is unknown', async () => {
    const h = await createHarness(); owner = h.context.id; createError = Error('create result lost');
    try {
      await expect(h.start()).rejects.toThrow(); await expect(h.cleanup()).rejects.toThrow(); expect(mock.exec.mock.calls.some(([file, a]) => file === cli && a[0] === 'stop')).toBe(false); expect(calls('rm')).toHaveLength(0);
    } finally { assertRunDirectory(h.context.directory); await rm(h.context.directory, { recursive: true }); }
  });
});
