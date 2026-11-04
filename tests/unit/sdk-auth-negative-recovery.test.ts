import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as runner from '../../scripts/run-phase-a.mjs';
import * as helpers from '../auth-negative/helpers.js';

it('L1-27/AN06 ordered bounded private control diagnostics preserve primary/restoration and do not overwrite or publish raw errors', async () => {
  expect((runner as Record<string, unknown>).writeNegativeControlDiagnostic).toBeTypeOf('function');
  const directory = await mkdtemp(resolve(tmpdir(), 'negative-private-diagnostic-'));
  try {
    await mkdir(resolve(directory, 'tests/fixtures/trailbase'), { recursive: true });
    await writeFile(resolve(directory, 'tests/fixtures/trailbase/config.textproto'), 'auth {}');
    const module = pathToFileURL(resolve('scripts/run-phase-a.mjs')).href, harness = pathToFileURL(resolve('scripts/harness.mjs')).href;
    const code = `import assert from'node:assert/strict';import{readFile,stat}from'node:fs/promises';import{resolve}from'node:path';import{writeNegativeControlDiagnostic as write}from${JSON.stringify(module)};import{createHarness}from${JSON.stringify(harness)};const fixture=await createHarness({registrationPolicyTest:true});try{const primary=Error('private-primary-marker'),restore=Error('private-restoration-marker'),error=new AggregateError([primary,restore],'private control errors',{cause:primary});await write(fixture.context,error);const path=resolve(fixture.context.directory,'negative-control-errors-private.log'),text=await readFile(path,'utf8');assert(text.includes(primary.message)&&text.includes(restore.message));assert(text.indexOf(primary.message)<text.indexOf(restore.message));assert.equal((await stat(path)).mode&0o777,0o600);await assert.rejects(write(fixture.context,error),e=>e instanceof AggregateError&&e.errors[0]===error);assert.equal(await readFile(path,'utf8'),text);const huge=Error('x'.repeat(1048576));await assert.rejects(write(fixture.context,huge),e=>e instanceof AggregateError&&e.errors[0]===huge);assert.equal(await readFile(path,'utf8'),text);await assert.rejects(write({...fixture.context,id:'foreign'},error));}finally{await fixture.cleanup();}`;
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, stdio: 'pipe' })).not.toThrow();
  } finally { await rm(directory, { recursive: true }); }
});

it('L1-27/AN06 reference audit proof rejects removed/modified history despite positive all-owned counts', () => {
  const check = (helpers as Record<string, unknown>).assertReferenceAuditPreserved;
  expect(check).toBeTypeOf('function'); if (typeof check !== 'function') throw new Error('Missing reference audit preservation');
  const old = [{ id: 'first', sha256: 'a', owned: true }, { id: 'second', sha256: 'b', owned: true }];
  expect(() => check(old, [...old, { id: 'third', sha256: 'c', owned: true }])).not.toThrow();
  expect(() => check(old, old)).not.toThrow();
  for (const after of [[old[1]], [{ ...old[0], sha256: 'changed' }, old[1]], [...old, { id: 'foreign', sha256: 'd', owned: false }], [...old, old[0]]]) expect(() => check(old, after)).toThrow();
});
