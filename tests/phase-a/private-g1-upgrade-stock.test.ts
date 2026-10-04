import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context, trailbase } from './helpers.js';
import { verifyOwner, waitReady } from '../../scripts/harness.mjs';
import { exec } from '../../scripts/tools.mjs';

it('stock TrailBase leaves a private pending identity in the existing depot for upgrade', async () => {
  const env = await context();
  expect(env.authVariant).toBe('stock');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  const project = verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const host = (await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
  expect(host.startsWith('unix:')).toBe(true);
  const container = `supabase_inbucket_${project}`;
  expect((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim()).toBe('true');

  const email = `private-g1-upgrade-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}-Aa1!`;
  const identities = () => {
    const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
    try {
      return db.prepare('SELECT id,email,unverified_email,password_hash FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id').all(email, email).map(row => ({
        id: Buffer.from(row.id as Uint8Array).toString('hex'),
        email: row.email as string | null,
        unverified_email: row.unverified_email as string | null,
        password_hash: row.password_hash as string | null
      }));
    } finally { db.close(); }
  };

  await exec('docker', ['stop', '--time', '1', container], { timeout: 15000 });
  try {
    await expect(trailbase(env).register({ email, password })).rejects.toMatchObject({ status: 424 });
    const rows = identities();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBeNull();
    expect(rows[0].unverified_email).toBe(email);
    expect(typeof rows[0].password_hash).toBe('string');
    await writeFile(resolve(env.directory, 'private-g1-upgrade-fixture.json'), JSON.stringify({ email, password, id: rows[0].id, passwordHash: rows[0].password_hash }), { mode: 0o600 });
  } finally {
    await exec('docker', ['start', container], { timeout: 15000 });
    await waitReady(`${env.mailUrl}/api/v1/messages`, 10000);
  }
});
