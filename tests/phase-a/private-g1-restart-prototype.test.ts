import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context, trailbase } from './helpers.js';
import { verifyOwner } from '../../scripts/harness.mjs';

it('private G1 prototype preserves a confirmed identity across a second server restart', async () => {
  const env = await context();
  expect(env.authVariant).toBe('private-native-prototype');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const fixture = JSON.parse(await readFile(resolve(env.directory, 'private-g1-upgrade-fixture.json'), 'utf8')) as {
    email: string; password: string; id: string; passwordHash: string;
  };
  expect(fixture.email).toMatch(/^private-g1-upgrade-[0-9a-f-]+@example\.test$/);

  const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  let rows;
  try {
    rows = db.prepare('SELECT id,email,unverified_email,password_hash FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id').all(fixture.email, fixture.email).map(row => ({
      id: Buffer.from(row.id as Uint8Array).toString('hex'),
      email: row.email as string | null,
      unverified_email: row.unverified_email as string | null,
      password_hash: row.password_hash as string | null
    }));
  } finally { db.close(); }
  expect(rows).toEqual([{ id: fixture.id, email: fixture.email, unverified_email: null, password_hash: fixture.passwordHash }]);

  const native = trailbase(env);
  await native.login(fixture.email, fixture.password);
  expect(native.user()?.email).toBe(fixture.email);
});
