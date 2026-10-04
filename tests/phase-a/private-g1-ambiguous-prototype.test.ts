import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context } from './helpers.js';
import { verifyOwner } from '../../scripts/harness.mjs';

it('private G1 migration refuses ambiguous existing identities without changing rows, schema or history', async () => {
  const env = await context();
  expect(env.authVariant).toBe('private-native-prototype');
  const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
  verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
  const runContext = JSON.parse(await readFile(resolve(env.directory, 'context.json'), 'utf8'));
  expect(runContext.setupStage).toBe('private-prototype-ambiguous-refusal');
  const fixture = JSON.parse(await readFile(resolve(env.directory, 'private-g1-upgrade-fixture.json'), 'utf8')) as {
    email: string; before: { users: string[]; schema: string[]; schemaObjects: string[]; sqliteOptimizerStats: string[]; history: string[]; temp: string[] };
  };
  expect(fixture.email).toMatch(/^private-g1-ambiguous-[0-9a-f-]+@example\.test$/);
  expect(fixture.before.users).toHaveLength(2);

  const db = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  try {
    const values = (sql: string, ...params: string[]) => db.prepare(sql).all(...params).map(row => row.item as string);
    const after = {
      users: values("SELECT quote(id)||quote(email)||quote(unverified_email)||quote(password_hash) AS item FROM _user WHERE email = ? COLLATE NOCASE OR unverified_email = ? COLLATE NOCASE ORDER BY id", fixture.email, fixture.email),
      schema: values("SELECT quote(type)||quote(name)||quote(sql) AS item FROM sqlite_schema WHERE name NOT IN ('sqlite_stat1','sqlite_stat4') ORDER BY name"),
      schemaObjects: values("SELECT type||':'||name AS item FROM sqlite_schema WHERE name NOT IN ('sqlite_stat1','sqlite_stat4') ORDER BY name"),
      sqliteOptimizerStats: values("SELECT type||':'||name AS item FROM sqlite_schema WHERE name LIKE 'sqlite_stat%' ORDER BY name"),
      history: values('SELECT quote(version)||quote(name)||quote(applied_on)||quote(checksum) AS item FROM _schema_history ORDER BY version'),
      temp: values('SELECT quote(type)||quote(name)||quote(sql) AS item FROM sqlite_temp_schema ORDER BY name')
    };
    const addedOptimizerStats = after.sqliteOptimizerStats.filter(name => !fixture.before.sqliteOptimizerStats.includes(name));
    const removedOptimizerStats = fixture.before.sqliteOptimizerStats.filter(name => !after.sqliteOptimizerStats.includes(name));
    expect(addedOptimizerStats).toEqual(['table:sqlite_stat1', 'table:sqlite_stat4']);
    expect(removedOptimizerStats).toEqual([]);
    const changed = (['users', 'schema', 'schemaObjects', 'history', 'temp'] as const).filter(key => JSON.stringify(after[key]) !== JSON.stringify(fixture.before[key]));
    expect(changed).toEqual([]);
    expect(JSON.stringify(after.schema)).not.toContain('__user__pending_email_index');
    expect(JSON.stringify(after.schema)).not.toContain('__user__email_insert');
    expect(JSON.stringify(after.schema)).not.toContain('__user__email_update');
  } finally { db.close(); }
});
