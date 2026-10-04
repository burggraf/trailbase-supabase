import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context, trailbase } from './helpers.js';
import { verifyOwner, waitReady } from '../../scripts/harness.mjs';
import { exec } from '../../scripts/tools.mjs';

it('stock TrailBase can leave ambiguous legacy pending identities in an existing depot', async () => {
  const env = await context();
  expect(env.authVariant).toBe('stock');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  const project = verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const host = (await exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
  expect(host.startsWith('unix:')).toBe(true);
  const container = `supabase_inbucket_${project}`;
  expect((await exec('docker', ['inspect', '--format', '{{.State.Running}}', container])).stdout.trim()).toBe('true');

  const email = `private-g1-ambiguous-${randomUUID()}@example.test`;
  const snapshot = () => {
    // TrailBase's PRAGMA optimize may create SQLite-owned sqlite_stat* tables at startup.
    const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
    try {
      const values = (sql: string, ...params: string[]) => db.prepare(sql).all(...params).map(row => row.item as string);
      return {
        users: values("SELECT quote(id)||quote(email)||quote(unverified_email)||quote(password_hash) AS item FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id", email, email),
        schema: values("SELECT quote(type)||quote(name)||quote(sql) AS item FROM sqlite_schema WHERE name NOT IN ('sqlite_stat1','sqlite_stat4') ORDER BY name"),
        schemaObjects: values("SELECT type||':'||name AS item FROM sqlite_schema WHERE name NOT IN ('sqlite_stat1','sqlite_stat4') ORDER BY name"),
        sqliteOptimizerStats: values("SELECT type||':'||name AS item FROM sqlite_schema WHERE name LIKE 'sqlite_stat%' ORDER BY name"),
        history: values('SELECT quote(version)||quote(name)||quote(applied_on)||quote(checksum) AS item FROM _schema_history ORDER BY version'),
        temp: values('SELECT quote(type)||quote(name)||quote(sql) AS item FROM sqlite_temp_schema ORDER BY name')
      };
    } finally { db.close(); }
  };

  await exec('docker', ['stop', '--time', '1', container], { timeout: 15000 });
  try {
    const first = trailbase(env);
    const second = trailbase(env);
    await expect(first.register({ email, password: `Fixture-${randomUUID()}-Aa1!` })).rejects.toMatchObject({ status: 424 });
    await expect(second.register({ email: email.toUpperCase(), password: `Fixture-${randomUUID()}-Aa1!` })).rejects.toMatchObject({ status: 424 });
    expect(first.tokens()).toBeUndefined();
    expect(second.tokens()).toBeUndefined();
    const before = snapshot();
    expect(before.users).toHaveLength(2);
    await writeFile(resolve(env.directory, 'private-g1-upgrade-fixture.json'), JSON.stringify({ email, before }), { mode: 0o600 });
  } finally {
    await exec('docker', ['start', container], { timeout: 15000 });
    await waitReady(`${env.mailUrl}/api/v1/messages`, 10000);
  }
});
