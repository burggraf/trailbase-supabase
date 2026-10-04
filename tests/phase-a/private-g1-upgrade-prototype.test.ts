import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context, trailbase, confirmEmail } from './helpers.js';
import { verifyOwner } from '../../scripts/harness.mjs';

it('private G1 prototype upgrades a real existing depot without replacing its pending identity', async () => {
  const env = await context();
  expect(env.authVariant).toBe('private-native-prototype');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const fixture = JSON.parse(await readFile(resolve(env.directory, 'private-g1-upgrade-fixture.json'), 'utf8')) as {
    email: string; password: string; id: string; passwordHash: string;
  };
  expect(fixture.email).toMatch(/^private-g1-upgrade-[0-9a-f-]+@example\.test$/);
  expect(fixture.id).toMatch(/^[0-9a-f]{32}$/);
  expect(typeof fixture.password).toBe('string');
  expect(typeof fixture.passwordHash).toBe('string');

  const identities = () => {
    const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
    try {
      return db.prepare('SELECT id,email,unverified_email,password_hash FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id').all(fixture.email, fixture.email).map(row => ({
        id: Buffer.from(row.id as Uint8Array).toString('hex'),
        email: row.email as string | null,
        unverified_email: row.unverified_email as string | null,
        password_hash: row.password_hash as string | null
      }));
    } finally { db.close(); }
  };
  const before = identities();
  expect(before).toHaveLength(1);
  expect(before[0]).toEqual({ id: fixture.id, email: null, unverified_email: fixture.email, password_hash: fixture.passwordHash });

  const native = trailbase(env);
  const resend = await native.fetch(`/api/auth/v1/verify_email/trigger?email=${encodeURIComponent(fixture.email)}`);
  expect(resend.ok).toBe(true);
  await confirmEmail(env, fixture.email);
  const after = identities();
  expect(after).toHaveLength(1);
  expect(after[0]).toEqual({ id: fixture.id, email: fixture.email, unverified_email: null, password_hash: fixture.passwordHash });
  await native.login(fixture.email, fixture.password);
  expect(native.user()?.email).toBe(fixture.email);
});
