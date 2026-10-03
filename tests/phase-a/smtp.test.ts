import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { context, trailbase, supabase, confirmEmail } from './helpers.js';
import { verifyOwner, waitReady } from '../../scripts/harness.mjs';
import { exec } from '../../scripts/tools.mjs';

it('L1-27 G1/S04 real SMTP outage reports failure, creates no session, and distinguishes native retry from reference recovery', async () => {
  const env = await context();
  const owner = JSON.parse(await readFile(resolve(env.directory,'owner.json'),'utf8'));
  const project = verifyOwner(env.id,owner,await readFile(resolve(env.directory,'supabase/config.toml'),'utf8'));
  const host = (await exec('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'])).stdout.trim();
  if (!host.startsWith('unix://') || process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) throw new Error('Fault requires local Docker');
  const container = `supabase_inbucket_${project}`;
  expect((await exec('docker',['inspect','--format','{{.State.Running}}',container])).stdout.trim()).toBe('true');
  const email = `smtp-native-${randomUUID()}@example.test`, referenceEmail = `smtp-reference-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}-Aa1!`;
  const native = trailbase(env), reference = supabase(env);
  try {
    await exec('docker',['stop','--time','1',container],{timeout:15000});
    expect((await exec('docker',['inspect','--format','{{.State.Running}}',container])).stdout.trim()).toBe('false');
    await expect(native.register({email,password})).rejects.toMatchObject({status:424});
    expect(native.tokens()).toBeUndefined(); expect(native.user()).toBeUndefined();
    await expect(native.login(email,password)).rejects.toMatchObject({status:401});
    await expect(native.records('todos').list()).rejects.toBeDefined();
    const signup = await reference.auth.signUp({email:referenceEmail,password});
    expect(signup.error?.status).toBe(500);
    expect(signup.data.session).toBeNull(); expect(signup.data.user).toBeNull();
    expect((await reference.auth.getSession()).data.session).toBeNull();
    expect((await reference.auth.signInWithPassword({email:referenceEmail,password})).error).not.toBeNull();
    expect((await reference.from('todos').select('*')).error).not.toBeNull();
    // Native retries attempt delivery again while SMTP is still down. Never relabel 424 as success.
    await expect(native.register({email,password})).rejects.toMatchObject({status:424});
    expect(native.tokens()).toBeUndefined();
  } finally {
    await exec('docker',['start',container],{timeout:15000});
    await waitReady(`${env.mailUrl}/api/v1/messages`,10000);
  }
  expect(await native.register({email,password})).toBeUndefined();
  const controlEmail = `smtp-control-${randomUUID()}@example.test`, control = trailbase(env);
  await control.register({email:controlEmail,password});
  await confirmEmail(env,controlEmail); // Correlated delivery barrier, not a sleep-based absence claim.
  await control.login(controlEmail,password);
  expect(control.user()?.email).toBe(controlEmail);
  const inbox = await fetch(`${env.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,{signal:AbortSignal.timeout(5000)});
  expect(inbox.ok).toBe(true);
  expect((await inbox.json()).messages.length).toBeGreaterThan(0);
  await expect(native.login(email,password)).rejects.toMatchObject({status:401});
  expect(native.tokens()).toBeUndefined();
  const recovered = await reference.auth.signUp({email:referenceEmail,password});
  expect(recovered.error).toBeNull(); expect(recovered.data.session).toBeNull();
  await confirmEmail(env,referenceEmail);
  const login = await reference.auth.signInWithPassword({email:referenceEmail,password});
  expect(login.error).toBeNull(); expect(login.data.user?.email).toBe(referenceEmail);
  // Recovery must include successful verification/login, not merely delivery after SMTP returns.
  // Stock v0.34.3 currently fails this regression: retained duplicate pending rows conflict.
  await confirmEmail(env,email);
  await native.login(email,password);
  expect(native.user()?.email).toBe(email);
},60000);
