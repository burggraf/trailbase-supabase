import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, dirname, basename } from 'node:path';

// Genuine owned server/config failures, not fabricated HTTP replies. Never a shipped SDK API.
export async function registrationPolicyFault(harness, kind) {
  assert(['pre-spawn', 'partial-write'].includes(kind));
  const env = harness.context, path = resolve(env.directory, 'traildepot/config.textproto');
  assert.equal(env.registrationPolicyTest, true); assert.equal(env.registrationDisabled, false);
  const original = await readFile(path, 'utf8'), primary = new Error(`Owned registration ${kind} failure`);
  const operation = kind === 'pre-spawn' ? 'open' : 'writeFile', previous = fs.promises[operation];
  let injected = false, failure;
  fs.promises[operation] = async function(target, ...args) {
    const name = resolve(String(target));
    const matches = kind === 'pre-spawn' ? name === resolve(env.directory, 'trail-registration-disabled.log') : dirname(name) === dirname(path) && (name === path || basename(name).startsWith('.registration-'));
    if (!injected && matches) {
      injected = true;
      if (kind === 'partial-write') await previous.call(this, target, 'auth {', ...args.slice(1));
      throw primary;
    }
    return previous.call(this, target, ...args);
  };
  syncBuiltinESMExports();
  try { await harness.setRegistrationDisabled(true); }
  catch (error) { failure = error; }
  finally { fs.promises[operation] = previous; syncBuiltinESMExports(); }
  assert(injected, 'Owned policy failure must actually execute');
  assert.equal(failure, primary, 'Original control error must survive successful rollback');
  assert.equal(await readFile(path, 'utf8'), original, 'Failed owned transition must restore exact original bytes');
  await harness.setRegistrationDisabled(false);
  assert.equal(env.registrationDisabled, false);
  assert.equal(await readFile(path, 'utf8'), original);
  const marker = await fetch(`${env.trailUrl}/phase-a-owner.txt`, { signal: AbortSignal.timeout(5000) });
  assert.equal(marker.status, 200); assert.equal(await marker.text(), env.id);
  assert.equal((await fetch(`${env.trailUrl}/api/healthcheck`, { signal: AbortSignal.timeout(5000) })).status, 200);
  await writeFile(resolve(env.directory, `registration-${kind}-proof-private.json`), JSON.stringify({ kind, injected, exactOriginalConfig: true, originalErrorIdentity: true, ownedOrigin: true, healthy: true }), { mode: 0o600, flag: 'wx' });
}
