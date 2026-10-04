import { createHash } from 'node:crypto';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLocalUrl, assertRunDirectory, verifyOwner, verifyImages, verifyLoopbackBindings, replaceTokens, freePort, waitReady, stopChild, nativeAuthConfig, setupImageInventory, fixtureAuthVariant, fixtureEnvironment, copyBrowserSdks } from '../../scripts/harness.mjs';
import { verifyChecksum } from '../../scripts/tools.mjs';
import { vitestArguments, testTimeoutMs } from '../../scripts/run-phase-a.mjs';

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
  it('setup inventory exposes only public image refs/digests and a port-safety boolean',()=>{
    const digest=`public.ecr.aws/supabase/gotrue@sha256:${'a'.repeat(64)}`,expected={supabase_auth:{}};
    expect(setupImageInventory([{service:'supabase_auth',image:'public.ecr.aws/supabase/gotrue:v2.197.0',repoDigests:[digest],publishedPorts:{'80/tcp':[{HostIp:'127.0.0.1',HostPort:'secret'}]},token:'secret'}],expected)).toEqual({containerCount:1,services:[{service:'supabase_auth',image:'public.ecr.aws/supabase/gotrue:v2.197.0',imageReferenceKind:'ecr-tag',repoDigests:[digest],loopbackOnly:true}]});
    const bad=setupImageInventory([{service:'secret',image:'https://user:secret@registry.invalid',repoDigests:['Bearer secret'],publishedPorts:{'80/tcp':[{HostIp:'secret',HostPort:'secret'}]}}],expected);
    expect(bad).toEqual({containerCount:1,services:[{service:'unknown-service',image:'unrecognized-image-reference',imageReferenceKind:'unrecognized',repoDigests:[],loopbackOnly:false}]});
    expect(JSON.stringify(bad)).not.toContain('secret');
    for(const [image,kind] of [
      ['ghcr.io/supabase/gotrue:v2.197.0','ghcr-tag'],
      ['supabase/gotrue:v2.197.0','docker-hub-tag'],
      ['docker.io/supabase/gotrue:v2.197.0','docker-hub-tag'],
      [`sha256:${'a'.repeat(64)}`,'image-id'],
      [`public.ecr.aws/supabase/gotrue@sha256:${'a'.repeat(64)}`,'public-digest-reference'],
      ['https://user:secret@registry.invalid','unrecognized']
    ]){
      const container={service:'supabase_auth',image,repoDigests:[digest],publishedPorts:{}};
      const inventory=setupImageInventory([container],expected);
      expect(inventory.services[0].imageReferenceKind).toBe(kind);
      expect(inventory.services[0].image).toBe('unrecognized-image-reference');
      expect(JSON.stringify(inventory)).not.toContain('secret');
      // Diagnostic recognition grants no permission to use mirrors, IDs or altered pins.
      expect(()=>verifyImages([container],{supabase_auth:{image:'public.ecr.aws/supabase/gotrue:v2.197.0',repoDigests:[digest]}})).toThrow('digest drift');
    }
  });
  it('verifies downloaded AND cached bytes rather than filenames', () => {
    const bytes = Buffer.from('fixture archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(() => verifyChecksum(bytes, digest)).not.toThrow();
    expect(() => verifyChecksum(Buffer.from('corrupt'), digest)).toThrow('checksum');
    expect(() => verifyChecksum(bytes, '0'.repeat(64))).toThrow('checksum');
  });
  it('forces the pinned ECR registry for every fixture while excluding inherited backend configuration',()=>{
    const inherited={PATH:'/fixture/bin',HOME:'/fixture/home',SUPABASE_INTERNAL_IMAGE_REGISTRY:'ghcr.io',SUPABASE_PROJECT_ID:'hosted-placeholder',SUPABASE_SERVICE_ROLE_KEY:'placeholder-not-a-key',TRAILBASE_URL:'https://hosted.invalid'};
    expect(fixtureEnvironment(inherited)).toEqual({PATH:'/fixture/bin',HOME:'/fixture/home',SUPABASE_INTERNAL_IMAGE_REGISTRY:'public.ecr.aws'});
    expect(inherited.SUPABASE_INTERNAL_IMAGE_REGISTRY).toBe('ghcr.io');
    expect(fixtureEnvironment({})).toEqual({SUPABASE_INTERNAL_IMAGE_REGISTRY:'public.ecr.aws'});
  });
  it('keeps stock/candidate/source-prototype fixtures disjoint and explicitly labelled',()=>{
    expect(fixtureAuthVariant()).toBe('stock');
    expect(fixtureAuthVariant({authMitigation:true})).toBe('candidate-email-reservation');
    expect(fixtureAuthVariant({privateNativePrototype:true})).toBe('private-native-prototype');
    expect(() => fixtureAuthVariant({authMitigation:true,privateNativePrototype:true})).toThrow('mutually exclusive');
  });
  it('budgets the three-engine 100-channel corpus without removing deadlines or extending other suites',()=>{
    expect(testTimeoutMs('playwright')).toBe(600000);
    for(const binary of ['vitest','unknown',''])expect(testTimeoutMs(binary)).toBe(300000);
  });
  it('excludes private G1 rehearsals from stock all, but not from explicitly selected suites',()=>{
    expect(vitestArguments('tests/phase-a','report.json')).toEqual(['run','tests/phase-a','--exclude','**/private-g1-*.test.ts','--reporter=json','--outputFile','report.json']);
    for(const path of ['tests/phase-a/database.test.ts','tests/phase-a/private-g1-prototype.test.ts','tests/phase-a/private-g1-ambiguous-stock.test.ts']) {
      expect(vitestArguments(path,'report.json')).toEqual(['run',path,'--reporter=json','--outputFile','report.json']);
    }
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
  it('serves byte-identical installed native ESM and reference UMD distributions, not replacements',async()=>{
    const directory=await mkdtemp(resolve(tmpdir(),'phase-a-browser-sdks-'));
    try{
      await copyBrowserSdks(directory);
      for(const [source,name] of [['node_modules/trailbase/dist/index.js','trailbase.js'],['node_modules/@supabase/supabase-js/dist/umd/supabase.js','supabase.js']]){
        expect(await readFile(resolve(directory,'fixtures',name))).toEqual(await readFile(source));
      }
    }finally{await rm(directory,{recursive:true,force:true});}
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
