import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { negativeContext, load, save, recoverSignup } from './helpers.js';

it('L1-15/AN05 exact policy restoration allows genuine confirmation/login of both previously rejected native addresses', async () => {
  const env = await negativeContext(false), state = await load(env);
  expect(await readFile(resolve(env.directory, 'traildepot/config.textproto'), 'utf8')).toBe(await readFile(resolve(env.directory, 'registration-original-config-private.txt'), 'utf8'));
  const rejected = state.rejected.filter(owner => owner.label.startsWith('node-')); expect(rejected).toHaveLength(2);
  for (const owner of rejected) { await recoverSignup(env, owner); await save(env, state); }
});
