import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context, trailbase, confirmEmail } from './helpers.js';
import { verifyOwner, waitReady } from '../../scripts/harness.mjs';
import { exec } from '../../scripts/tools.mjs';

it('private G1 source prototype preserves the pending identity and recovers through real HTTP/mail after SMTP outage', async () => {
  const env = await context();
  expect(env.authVariant).toBe('private-native-prototype');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  const project = verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const host = (await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
  expect(host.startsWith('unix://')).toBe(true);
  const container = `supabase_inbucket_${project}`;
  expect((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim()).toBe('true');

  const email = `private-g1-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}-Aa1!`;
  const replacement = `Fixture-${randomUUID()}-Aa1!`;
  const native = trailbase(env);
  const identities = () => {
    const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
    try {
      return db.prepare('SELECT id,email,unverified_email,password_hash FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id').all(email, email).map(row => ({
        id: Buffer.from(row.id as Uint8Array).toString('hex'),
        email: row.email,
        unverified_email: row.unverified_email,
        password_hash: row.password_hash
      }));
    } finally { db.close(); }
  };

  await exec('docker', ['stop', '--time', '1', container], { timeout: 15000 });
  expect((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim()).toBe('false');
  let original: ReturnType<typeof identities>;
  try {
    await expect(native.register({ email, password })).rejects.toMatchObject({ status: 424 });
    original = identities();
    expect(original).toHaveLength(1);
    expect(original[0].email).toBeNull();
    expect(original[0].unverified_email).toBe(email);
    expect(typeof original[0].password_hash).toBe('string');
    expect(native.tokens()).toBeUndefined();
    expect(native.user()).toBeUndefined();
    await expect(native.login(email, password)).rejects.toMatchObject({ status: 401 });
    let protectedStatus: number | undefined;
    try { await native.records('todos').list(); }
    catch (error) { protectedStatus = (error as { status?: number }).status; }
    expect([401, 403]).toContain(protectedStatus);
  } finally {
    await exec('docker', ['start', container], { timeout: 15000 });
    await waitReady(`${env.mailUrl}/api/v1/messages`, 10000);
  }

  expect(await native.register({ email, password: replacement })).toBeUndefined();
  expect(native.tokens()).toBeUndefined();
  expect(identities()).toEqual(original!);
  const resend = await native.fetch(`/api/auth/v1/verify_email/trigger?email=${encodeURIComponent(email)}`);
  expect(resend.ok).toBe(true);
  expect(identities()).toEqual(original!);
  await confirmEmail(env, email);

  const confirmed = identities();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0].id).toBe(original![0].id);
  expect(confirmed[0].email).toBe(email);
  expect(confirmed[0].unverified_email).toBeNull();
  expect(confirmed[0].password_hash).toBe(original![0].password_hash);
  const wrong = trailbase(env);
  await expect(wrong.login(email, replacement)).rejects.toMatchObject({ status: 401 });
  expect(wrong.tokens()).toBeUndefined();
  await native.login(email, password);
  expect(native.user()?.email).toBe(email);
}, 60000);

it('private G1 prototype retains one identity across concurrent case-insensitive signups', async () => {
  const env = await context();
  expect(env.authVariant).toBe('private-native-prototype');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const email = `private-g1-race-${randomUUID()}@example.test`;
  const identities = () => {
    const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
    try {
      return db.prepare('SELECT id,email,unverified_email,password_hash FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id').all(email, email).map(row => ({
        email: row.email as string | null,
        unverified_email: row.unverified_email as string | null,
        password_hash: row.password_hash as string | null
      }));
    } finally { db.close(); }
  };
  const first = trailbase(env);
  const second = trailbase(env);
  const results = await Promise.allSettled([
    first.register({ email, password: `Fixture-${randomUUID()}-Aa1!` }),
    second.register({ email: email.toUpperCase(), password: `Fixture-${randomUUID()}-Aa1!` })
  ]);
  expect(results).toHaveLength(2);
  expect(results.some(result => result.status === 'fulfilled')).toBe(true);
  expect(first.tokens()).toBeUndefined();
  expect(second.tokens()).toBeUndefined();
  const rows = identities();
  expect(rows).toHaveLength(1);
  expect(rows[0].email).toBeNull();
  expect(rows[0].unverified_email?.toLowerCase()).toBe(email.toLowerCase());
  expect(typeof rows[0].password_hash).toBe('string');
});
