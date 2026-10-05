import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertRunDirectory, verifyOwner } from '../../scripts/harness.mjs';
import { baseline, exec, verifyChecksum } from '../../scripts/tools.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const email = /^sdk-live-(?:changed-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.test$/;
export function ownedUserArguments(depot, owner, operation, newEmail) {
  if (!owner || !uuid.test(owner.id) || !email.test(owner.email)) throw new Error('Invalid generated owned identity');
  if (operation !== 'delete' && operation !== 'change-email') throw new Error('Unsupported owned user operation');
  if (operation === 'change-email' ? !email.test(newEmail ?? '') : newEmail !== undefined) throw new Error('Invalid owned email operand');
  return ['--depot', depot, 'user', operation, owner.id, ...(operation === 'change-email' ? [newEmail] : [])];
}
export function databaseDigest(db, table, column, owner) {
  // Fixed internal table/column vocabulary, never caller SQL. Hash secret-bearing sentinel rows.
  if (!(table === '_user' && column === 'id' || table === '_session' && column === 'user')) throw new Error('Invalid sentinel table');
  return createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${table} WHERE ${column} <> ? ORDER BY rowid`).all(owner))).digest('hex');
}
const statisticsSchema = [
  { type: 'table', name: 'sqlite_stat1', tbl_name: 'sqlite_stat1', sql: 'CREATE TABLE sqlite_stat1(tbl,idx,stat)' },
  { type: 'table', name: 'sqlite_stat4', tbl_name: 'sqlite_stat4', sql: 'CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)' },
];
const schemaFields = ['type', 'name', 'tbl_name', 'sql'];
function validatedSchema(value) {
  if (!Array.isArray(value)) throw new TypeError('Invalid native schema snapshot');
  const keys = new Set();
  return value.map(record => {
    if (!record || typeof record !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(record)) || Reflect.ownKeys(record).length !== 4 || !schemaFields.every(key => Object.hasOwn(record, key)) || !['table', 'index', 'trigger', 'view'].includes(record.type) || typeof record.name !== 'string' || !record.name || typeof record.tbl_name !== 'string' || !record.tbl_name || !(record.sql === null || typeof record.sql === 'string')) throw new TypeError('Invalid native schema record');
    const key = JSON.stringify([record.type, record.name]);
    if (keys.has(key)) throw new TypeError('Duplicate native schema object');
    keys.add(key);
    const canonical = statisticsSchema.find(row => row.name === record.name.toLowerCase() || row.name === record.tbl_name.toLowerCase());
    if (canonical && !schemaFields.every(field => record[field] === canonical[field])) throw new TypeError('Noncanonical native statistics schema record');
    return Object.fromEntries(schemaFields.map(field => [field, record[field]]));
  });
}
export function compareNativeSchema(before, after) {
  const prior = validatedSchema(before), current = validatedSchema(after);
  const allowedBookkeepingAdded = statisticsSchema.filter(row => !prior.some(record => record.name === row.name) && current.some(record => record.name === row.name)).map(row => row.name);
  const retained = current.filter(record => !allowedBookkeepingAdded.includes(record.name));
  return { rawSchemaChanged: JSON.stringify(prior) !== JSON.stringify(current), prohibitedSchemaChange: JSON.stringify(prior) !== JSON.stringify(retained), allowedBookkeepingAdded };
}
export function changedNativeState(before, after) {
  return {
    ...compareNativeSchema(before.schema, after.schema),
    config: JSON.stringify(before.config) !== JSON.stringify(after.config),
    unrelatedIdentities: JSON.stringify(before.unrelatedIdentities) !== JSON.stringify(after.unrelatedIdentities),
    unrelatedSessions: JSON.stringify(before.unrelatedSessions) !== JSON.stringify(after.unrelatedSessions),
  };
}
export function ownedCleanupIdentity(owner, changedEmail, currentEmail) {
  ownedUserArguments('', owner, 'change-email', changedEmail);
  if (currentEmail === undefined) return null;
  if (currentEmail !== owner.email && currentEmail !== changedEmail) throw new Error('Owned cleanup encountered unexpected email');
  return { id: owner.id, email: currentEmail };
}
export async function writeNativeDiagnostic(root, invocation, stage, payload) {
  if (!/^[a-z0-9-]+$/.test(invocation) || !['before', 'after', 'cli'].includes(stage)) throw new Error('Invalid private diagnostic label');
  const path = resolve(root, `native-owned-user-${invocation}-${stage}-private.json`);
  await writeFile(path, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return path;
}
export async function mutateOwnedNativeUser(env, main, sessions, owner, operation, newEmail) {
  // Caller obtains env through context(), then revalidate the on-disk run identity here.
  assertRunDirectory(env.directory);
  const root = await realpath(env.directory), depot = await realpath(resolve(root, 'traildepot'));
  if (root !== resolve(env.directory) || depot !== resolve(root, 'traildepot')) throw new Error('Owned user depot path mismatch');
  const recorded = JSON.parse(await readFile(resolve(root, 'owner.json'), 'utf8'));
  verifyOwner(env.id, recorded, await readFile(resolve(root, 'supabase/config.toml'), 'utf8'));
  if (root !== resolve('.runtime/runs', env.id)) throw new Error('Owned run path identity mismatch');
  if (recorded.id !== env.id || recorded.project !== env.project || recorded.authVariant !== env.authVariant || recorded.nativeAuthProfile !== env.nativeAuthProfile) throw new Error('Owned user fixture mismatch');
  const args = ownedUserArguments(depot, owner, operation, newEmail), id = Buffer.from(owner.id.replaceAll('-', ''), 'hex');
  if (main.prepare('SELECT email FROM _user WHERE id=?').get(id)?.email !== owner.email) throw new Error('Owned identity email precondition failed');
  const snapshot = async () => ({
    schema: main.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),
    config: (await readFile(resolve(depot, 'config.textproto'))).toString('base64'),
    unrelatedIdentities: main.prepare('SELECT * FROM _user WHERE id <> ? ORDER BY rowid').all(id),
    unrelatedSessions: sessions.prepare('SELECT * FROM _session WHERE user <> ? ORDER BY rowid').all(id),
    ownedIdentity: main.prepare('SELECT * FROM _user WHERE id=?').get(id),
  });
  const before = await snapshot(), invocation = randomUUID();
  await writeNativeDiagnostic(root, invocation, 'before', { operation, before });
  const asset = baseline.trailbase.assets[`${process.platform}-${process.arch}`], tools = resolve('.runtime/tools');
  if (!asset) throw new Error('Unsupported owned fixture platform');
  verifyChecksum(await readFile(resolve(tools, asset.name)), asset.sha256); // Existing harness-verified archive, never download/build.
  const binary = resolve(tools, `${process.platform}-${process.arch}`, 'trail');
  if (await realpath(binary) !== binary) throw new Error('Owned native binary path mismatch');
  const version = await exec(binary, ['--version'], { timeout: 10000 });
  if (!version.stdout.includes(baseline.trailbase.version)) throw new Error('Owned native version mismatch');
  let failed = false, stdout = '', stderr = '';
  try { const result = await exec(binary, args, { timeout: 20000 }); stdout = result.stdout; stderr = result.stderr; }
  catch (error) { failed = true; stdout = String(error.stdout ?? ''); stderr = String(error.stderr ?? ''); }
  // Record even successful CLI output before evaluating invariants; never overwrite earlier cleanup/main diagnostics.
  await writeNativeDiagnostic(root, invocation, 'cli', { failed, stdout, stderr });
  let after;
  try { after = await snapshot(); }
  catch {
    await writeNativeDiagnostic(root, invocation, 'after', { snapshotFailed: true });
    throw new Error('Owned native mutation snapshot read failed; inspect private diagnostics');
  }
  await writeNativeDiagnostic(root, invocation, 'after', { after });
  const changed = changedNativeState(before, after);
  const prohibited = changed.prohibitedSchemaChange || changed.config || changed.unrelatedIdentities || changed.unrelatedSessions;
  if (prohibited) throw new Error(`Owned native mutation changed unrelated state: ${JSON.stringify(changed)}`);
  if (failed) throw new Error('Owned native user mutation failed; inspect private diagnostics');
  const current = main.prepare('SELECT email FROM _user WHERE id=?').get(id);
  if (operation === 'delete' ? current !== undefined : current?.email !== newEmail) throw new Error('Owned native user mutation postcondition failed');
  return changed; // Schema metadata only, not statistics contents or physical database/query-plan equality.
}
