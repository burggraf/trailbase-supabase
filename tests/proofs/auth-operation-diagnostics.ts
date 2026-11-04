import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { assertRunDirectory } from '../../scripts/harness.mjs';
import type { Context } from '../phase-a/helpers.js';
import { withCleanup } from '../sdk-browser/cleanup.js';

type Step = () => Promise<unknown>;
// Test-only diagnostics: JSON reporters abbreviate assertion values and may omit nested causes.
// Preserve original exceptions privately, without replacing them or changing auth/cleanup semantics.
export async function authOperationWithCleanup(env: Context, label: string, body: Step, cleanup: Step[], privateObservation?: () => Promise<unknown>) {
  async function validate() {
    assertRunDirectory(env.directory);
    if (!/^(native|expiry|chromium|firefox|webkit)$/.test(label) || resolve(env.directory) !== resolve('.runtime/runs', env.id) || await realpath(env.directory) !== resolve(env.directory) || !(await lstat(resolve(env.directory, 'owner.json'))).isFile()) throw new Error('Invalid AL diagnostic target');
    const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
    if (owner.id !== env.id || owner.project !== env.project || owner.project !== `trailbase-supabase-test-${env.id.split('-')[1]}` || owner.nativeServerProfile !== 'default' || env.nativeServerProfile !== 'default' || owner.nativeAuthProfile !== env.nativeAuthProfile || owner.authVariant !== 'stock' || env.authVariant !== 'stock') throw new Error('AL diagnostic fixture owner mismatch');
  }
  await validate();
  async function observed(phase: string, step: Step) {
    try { return await step(); }
    catch (error) {
      try {
        await validate();
        const observation = privateObservation ? await privateObservation() : undefined;
        const text = inspect({ error, ...(privateObservation ? { observation } : {}) }, { depth: null, maxArrayLength: null, maxStringLength: null, customInspect: false });
        if (Buffer.byteLength(text) > 1048576) throw new Error('AL private diagnostic exceeds1MiB');
        await writeFile(resolve(env.directory, `auth-operation-${label}-${phase}-private.log`), text, { mode: 0o600, flag: 'wx' });
      } catch (logging) { throw new AggregateError([error, logging], 'AL primary/private diagnostic failure', { cause: error }); }
      throw error;
    }
  }
  return withCleanup(() => observed('primary', body), cleanup.map((step, index) => () => observed(`cleanup-${index}`, step)));
}
