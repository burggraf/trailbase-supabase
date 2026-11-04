import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { negativeContext, save, baseline, enrollOwner, identity, ordinaryLogin, nativeState, type State } from './helpers.js';
import { supabase, confirmEmail } from '../phase-a/helpers.js';

it('L1-15/L1-27/AN01 real confirmed owners, native ordinary TOTP enrollment and full protected baselines', async () => {
  const env = await negativeContext(false), state: State = { runId: env.id, owners: [], rejected: [] };
  await save(env, state); await baseline(env);
  await writeFile(resolve(env.directory, 'registration-original-config-private.txt'), await readFile(resolve(env.directory, 'traildepot/config.textproto')), { mode: 0o600 });
  for (const label of ['plain', 'control', 'mfa']) await enrollOwner(env, state, label, label === 'mfa');
  const mfa = state.owners.find(owner => owner.label === 'mfa')!;
  expect(nativeState(env).users.find(row => row.email === mfa.email)?.totp_secret).toBeTypeOf('string');
  expect((await (await ordinaryLogin(env, mfa)).records('todos').list()).records).toHaveLength(1);
  state.reference = identity(env, 'reference'); await save(env, state);
  const reference = supabase(env), input = { email: state.reference.email, password: state.reference.password };
  const signup = await reference.auth.signUp(input); expect(signup.error).toBeNull(); expect(signup.data.session).toBeNull();
  state.reference.id = signup.data.user!.id; await save(env, state); await confirmEmail(env, input.email);
  const login = await reference.auth.signInWithPassword(input); expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(state.reference.id);
  expect((await reference.auth.mfa.listFactors()).data?.all).toEqual([]);
});
