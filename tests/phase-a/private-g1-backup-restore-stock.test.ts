import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context } from './helpers.js';
import { verifyOwner } from '../../scripts/harness.mjs';

it('stock G1 backup restore recovers the original pending identity and schema after prototype migration', async () => {
  const env = await context();
  expect(env.authVariant).toBe('stock');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const fixture = JSON.parse(await readFile(resolve(env.directory, 'private-g1-upgrade-fixture.json'), 'utf8')) as {
    email: string; password: string; id: string; passwordHash: string;
  };
  expect(fixture.email).toMatch(/^private-g1-upgrade-[0-9a-f-]+@example\.test$/);

  const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  try {
    const identities = db.prepare('SELECT id,email,unverified_email,password_hash FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id').all(fixture.email, fixture.email).map(row => ({
      id: Buffer.from(row.id as Uint8Array).toString('hex'),
      email: row.email as string | null,
      unverified_email: row.unverified_email as string | null,
      password_hash: row.password_hash as string | null
    }));
    expect(identities).toEqual([{ id: fixture.id, email: null, unverified_email: fixture.email, password_hash: fixture.passwordHash }]);
    const prototypeObjects = db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('__user__pending_email_index','__user__email_insert','__user__email_update') ORDER BY name").all().map(row => row.name);
    expect(prototypeObjects).toEqual([]);
    const prototypeHistory = db.prepare("SELECT name FROM _schema_history WHERE name LIKE '%reserve_auth_email%'").all();
    expect(prototypeHistory).toEqual([]);
  } finally { db.close(); }
});
