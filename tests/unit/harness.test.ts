import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLocalUrl, assertRunDirectory, verifyOwner, verifyImages, verifyLoopbackBindings, replaceTokens, freePort, waitReady, stopChild, nativeAuthConfig } from '../../scripts/harness.mjs';
import { verifyChecksum } from '../../scripts/tools.mjs';

describe('L1-27/U27 harness safety', () => {
  const origin = 'http://127.0.0.1:55431';
  it('allows only exact owned loopback origins', () => {
    expect(assertLocalUrl(`${origin}/auth/v1`, [origin]).origin).toBe(origin);
    for (const bad of ['https://project.supabase.co', 'http://localhost:55431', 'http://127.0.0.1:1', 'http://127.0.0.1.evil:55431', 'http://user:password@127.0.0.1:55431', 'file:///tmp/test']) {
      expect(() => assertLocalUrl(bad, [origin])).toThrow();
    }
  });
  it('rejects traversal and non-owned cleanup directories', () => {
    expect(() => assertRunDirectory('.runtime/runs/1780400000000-abcdef123456')).not.toThrow();
    for (const bad of ['.', '/tmp', '.runtime/runs', '.runtime/runs/../../..', '.runtime/runs/1780400000000-abcdef123456/depot', '.runtime/runs/random']) {
      expect(() => assertRunDirectory(resolve(bad))).toThrow();
    }
  });
  it('refuses foreign/comment-spoofed project ownership before cleanup', () => {
    const id='1780400000000-abcdef123456', project='trailbase-supabase-test-abcdef123456';
    const owner={id,project};
    expect(verifyOwner(id,owner,`project_id = "${project}"\n`)).toBe(project);
    expect(() => verifyOwner(id,{...owner,project:'live'},`project_id = "${project}"`)).toThrow();
    expect(() => verifyOwner(id,owner,`# project_id = "${project}"\nproject_id = "live"`)).toThrow();
    expect(() => verifyOwner(id,owner,`project_id = "${project}"\nproject_id = "live"`)).toThrow();
  });
  it('refuses externally published fixture ports', () => {
    expect(() => verifyLoopbackBindings({'5432/tcp':[{HostIp:'127.0.0.1'},{HostIp:'::1'}]})).not.toThrow();
    expect(() => verifyLoopbackBindings({'internal/tcp':null})).not.toThrow();
    for(const ip of ['0.0.0.0','::','192.168.1.1','']) expect(() => verifyLoopbackBindings({'5432/tcp':[{HostIp:ip}]})).toThrow('non-loopback');
  });
  it('rejects service image/digest/count drift', () => {
    const expected={auth:{image:'auth:v1',repoDigests:['auth@sha256:expected']}};
    const good={service:'auth',image:'auth:v1',repoDigests:['auth@sha256:expected']};
    expect(() => verifyImages([good],expected)).not.toThrow();
    for(const bad of [[],[{...good,image:'auth:latest'}],[{...good,repoDigests:['changed']}],[{...good,service:'unknown'}]]) expect(() => verifyImages(bad,expected)).toThrow();
  });
  it('verifies downloaded AND cached bytes rather than filenames', () => {
    const bytes = Buffer.from('fixture archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(() => verifyChecksum(bytes, digest)).not.toThrow();
    expect(() => verifyChecksum(Buffer.from('corrupt'), digest)).toThrow('checksum');
    expect(() => verifyChecksum(bytes, '0'.repeat(64))).toThrow('checksum');
  });
  it('keeps default auth configuration unchanged and confines short TTL to a labelled owned profile',()=>{
    const config='auth { user_identifier: ONLY_EMAIL }';
    expect(nativeAuthConfig(config,'default')).toBe(config);
    expect(nativeAuthConfig(config,'short-native-auth')).toBe('auth { auth_token_ttl_sec: 3 user_identifier: ONLY_EMAIL }');
    for(const bad of ['unknown','',3])expect(()=>nativeAuthConfig(config,bad)).toThrow('Invalid');
    for(const bad of ['',config+'\n'+config,'auth { auth_token_ttl_sec: 60 }'])expect(()=>nativeAuthConfig(bad,'short-native-auth')).toThrow('Invalid');
  });
  it('fails closed on missing fixture variables', () => {
    expect(replaceTokens('port = __PORT__', { PORT: 1234 })).toBe('port = 1234');
    expect(() => replaceTokens('__MISSING__', {})).toThrow('Missing');
  });
  it('allocates local ports and releases the allocation socket', async () => {
    const port = await freePort();
    expect(Number.isInteger(port) && port > 0 && port <= 65535).toBe(true);
  });
  it('fails a stopped child immediately rather than reporting a skipped setup', async () => {
    await expect(waitReady(`${origin}/health`, 1000, { exitCode: 1, signalCode: null })).rejects.toThrow('exited');
  });
  it('has a finite readiness deadline', async () => {
    await expect(waitReady(`${origin}/health`, 0)).rejects.toThrow('deadline');
  });
  it('cleanup tolerates an absent or already stopped child', async () => {
    await expect(stopChild(undefined)).resolves.toBeUndefined();
    await expect(stopChild({ exitCode: 0, signalCode: null })).resolves.toBeUndefined();
  });
});
