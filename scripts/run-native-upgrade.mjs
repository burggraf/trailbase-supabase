// Narrow owned 0.34.3 -> active native release rehearsal. Never attach to an existing run.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm, readdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initClient } from 'trailbase';
import { createHarness, assertLocalUrl, verifyOwner } from './harness.mjs';
import { baseline } from './tools.mjs';
import { sourceHash } from './run-phase-a.mjs';

await mkdir('.runtime', { recursive: true, mode: 0o700 });
await mkdir('.runtime/phase-a.lock'); // Existing lock (including the preserved demo) is a hard stop.
const report = { scope: 'Owned generated native release fresh/upgrade/complete backup/restore and destructive-migration characterization; NOT production adoption or release signoff', status: 'failed', sourceSha256: await sourceHash(), node: process.version, from: '0.34.3', to: baseline.trailbase.version, tests: [], cleanup: 'not-started' };
let harness, env, backup, step = 'setup';
async function check(name, operation) { step = name; await operation(); report.tests.push({ name, status: 'passed' }); }
async function manifest(directory, prefix = '') {
  const entries = [];
  for (const name of (await readdir(resolve(directory, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name, file = resolve(directory, path), info = await lstat(file);
    if (info.isDirectory()) entries.push(...await manifest(directory, path));
    else { assert(info.isFile() && !info.isSymbolicLink()); entries.push({ path, mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, size: info.size, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }); }
  }
  return entries;
}
function snapshot() {
  const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true });
  const sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
  try { return { users: main.prepare('SELECT * FROM _user ORDER BY id').all(), tasks: main.prepare('SELECT * FROM todos ORDER BY id').all(), audit: main.prepare('SELECT * FROM todo_audit ORDER BY audit_key').all(), sessions: sessions.prepare('SELECT * FROM _session ORDER BY rowid').all() }; }
  finally { main.close(); sessions.close(); }
}
async function confirm(email) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const inbox = await fetch(`${env.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then(r => r.json());
    if (inbox.messages?.length) {
      const message = await fetch(`${env.mailUrl}/api/v1/message/${inbox.messages[0].ID}`).then(r => r.json());
      const links = `${message.HTML ?? ''}\n${message.Text ?? ''}`.replaceAll('&amp;', '&').match(/https?:\/\/[^\s<>"']+/g) ?? [];
      let target = links.find(link => new URL(link).pathname.includes('verify')); assert(target);
      for (let n = 0; n < 5; n++) { assertLocalUrl(target, env.origins); const r = await fetch(target, { redirect: 'manual' }); if (r.status < 300 || r.status >= 400) { assert(r.ok); return; } assert(r.headers.get('location')); target = new URL(r.headers.get('location'), target).href; }
      throw Error('Owned confirmation redirect limit');
    }
    await new Promise(yes => setTimeout(yes, 100));
  }
  throw Error('Owned confirmation mail deadline');
}
const nativeId = id => Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64').replaceAll('+', '-').replaceAll('/', '_');
try {
  harness = await createHarness({ nativeServerProfile: 'legacy-upgrade' }); env = harness.context; report.runId = env.id;
  await writeFile('.runtime/phase-a.lock/owner.json', JSON.stringify({ runnerPid: process.pid, runId: env.id }), { mode: 0o600 });
  env = await harness.start(); report.legacyVersion = env.trailVersion; report.containers = env.containers; assert(env.trailVersion.includes('0.34.3'));
  const depot = resolve(env.directory, 'traildepot'); backup = resolve(env.directory, 'native-upgrade-backup');
  const accounts = [], taskIds = [];
  await check('legacy genuine confirmation/password accounts, sessions and owner-isolated rows', async () => {
    for (let n = 0; n < 2; n++) {
      const email = `native-upgrade-${randomUUID()}@example.test`, password = `Fixture-${randomUUID()}-Aa1!`, client = initClient(env.trailUrl);
      await client.register({ email, password }); await confirm(email); await client.login(email, password); assert(client.user());
      const id = nativeId(randomUUID()); taskIds.push(id); await client.records('todos').create({ id, user_id: client.user().id, title: `upgrade-${randomUUID()}` }); accounts.push({ client, email, password, tokens: { ...client.tokens() } });
    }
    assert.equal((await accounts[0].client.records('todos').list()).records.length, 1);
    await assert.rejects(accounts[1].client.records('todos').read(taskIds[0]), e => e.status === 403 || e.status === 404);
  });
  let before, files;
  await check('complete stopped depot/keys/config/WAL backup and byte/permission manifest', async () => {
    await harness.stopNativeForUpgrade(); before = snapshot(); files = await manifest(depot);
    await cp(depot, backup, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true }); assert.deepEqual(await manifest(backup), files);
    await writeFile(resolve(env.directory, 'native-upgrade-backup-manifest-private.json'), JSON.stringify(files), { mode: 0o600 });
  });
  async function restore() {
    await harness.stopNativeForUpgrade();
    const owner = JSON.parse(await readFile(resolve(env.directory, 'owner.json'), 'utf8'));
    verifyOwner(env.id, owner, await readFile(resolve(env.directory, 'supabase/config.toml'), 'utf8'));
    assert.equal(resolve(env.directory), resolve('.runtime/runs', env.id));
    assert.deepEqual(await manifest(backup), files);
    await rm(depot, { recursive: true }); await cp(backup, depot, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true }); assert.deepEqual(await manifest(depot), files);
    await harness.startNativeForUpgrade('legacy-upgrade'); assert.deepEqual(snapshot(), before);
  }
  await check('official native upgrade preserves full generated identity/password/task/audit/session rows', async () => {
    const result = await harness.startNativeForUpgrade(); report.upgradedVersion = result.version; assert(result.version.includes(baseline.trailbase.version)); assert.deepEqual(snapshot(), before);
    for (const account of accounts) {
      assert.equal((await account.client.records('todos').list()).records.length, 1);
      const r = await fetch(`${env.trailUrl}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: account.tokens.refresh_token }), redirect: 'error' }); assert.equal(r.status, 200); await r.body?.cancel();
      const login = initClient(env.trailUrl); await login.login(account.email, account.password); assert.equal(login.user().id, account.client.user().id);
    }
    await assert.rejects(accounts[1].client.records('todos').read(taskIds[0]), e => e.status === 403 || e.status === 404);
  });
  await check('repeat current-release startup preserves upgraded rows and sessions', async () => { await harness.stopNativeForUpgrade(); const prior = snapshot(); await harness.startNativeForUpgrade(); assert.deepEqual(snapshot(), prior); });
  for (let cycle = 1; cycle <= 2; cycle++) await check(`complete rollback/restore cycle${cycle} returns original rows/keys/config and usable legacy sessions`, async () => {
    await restore(); for (const account of accounts) { const r = await fetch(`${env.trailUrl}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: account.tokens.refresh_token }), redirect: 'error' }); assert.equal(r.status, 200); await r.body?.cancel(); }
  });
  // These custom SQL fixtures CREATE deliberately invalid/aged generated identities; never repair
  // or alter timestamps of existing identities, and never operate on the original demo.
  const ownerHex = Buffer.from(accounts[0].client.user().id, 'base64url').toString('hex');
  const sqlPath = resolve(depot, 'migrations/main/U1791097700__generated_upgrade_negative.sql');
  async function assertMigrationRefused(reason) {
    const logPath = resolve(env.directory, `trail-upgrade-${baseline.trailbase.version}.log`), prior = await readFile(logPath, 'utf8');
    await assert.rejects(harness.startNativeForUpgrade(), error => error.message === 'Fixture exited before readiness');
    await harness.stopNativeForUpgrade(); assert((await readFile(logPath, 'utf8')).slice(prior.length).includes(reason));
  }
  await check('negative characterization: upstream migration deletes generated older24h pending account without dependent data', async () => {
    await harness.stopNativeForUpgrade(); const id = randomUUID().replaceAll('-', ''), email = `aged-${randomUUID()}@example.test`;
    await writeFile(sqlPath, `INSERT INTO _user(id,unverified_email,password_hash,created) SELECT X'${id}','${email}',password_hash,unixepoch()-90000 FROM _user WHERE id=X'${ownerHex}';\n`, { mode: 0o600 });
    await harness.startNativeForUpgrade('legacy-upgrade'); const prior = snapshot(); assert.equal(prior.users.length, before.users.length + 1); assert.deepEqual(prior.tasks, before.tasks);
    await harness.stopNativeForUpgrade(); await harness.startNativeForUpgrade(); const after = snapshot(); assert.deepEqual(after.users, before.users); assert.deepEqual(after.tasks, before.tasks);
    report.generatedDeletionObservation = { accountsRemoved: prior.users.length - after.users.length, tasksRemoved: prior.tasks.length - after.tasks.length, notApprovalForUserDataDeletion: true };
  });
  await restore();
  await check('negative characterization: aged pending owner with dependent task refuses migration and preserves all generated rows', async () => {
    await harness.stopNativeForUpgrade(); const id = randomUUID().replaceAll('-', ''), task = randomUUID().replaceAll('-', ''), email = `aged-owner-${randomUUID()}@example.test`;
    await writeFile(sqlPath, `INSERT INTO _user(id,unverified_email,password_hash,created) SELECT X'${id}','${email}',password_hash,unixepoch()-90000 FROM _user WHERE id=X'${ownerHex}';\nINSERT INTO todos(id,user_id,title) VALUES(X'${task}',X'${id}','generated-aged-${randomUUID()}');\n`, { mode: 0o600 });
    await harness.startNativeForUpgrade('legacy-upgrade'); const prior = snapshot(); assert.equal(prior.users.length, before.users.length + 1); assert.equal(prior.tasks.length, before.tasks.length + 1);
    await harness.stopNativeForUpgrade(); await assertMigrationRefused('FK violations: ["todos"]'); assert.deepEqual(snapshot(), prior);
    report.generatedDependentOwnerObservation = { pendingIdentities: 1, dependentTasks: 1, startupRefused: true, fullGeneratedRowsUnchanged: true };
  });
  await restore();
  await check('negative characterization: duplicate pending index conflict refuses upgrade with original generated rows intact', async () => {
    await harness.stopNativeForUpgrade(); const email = `duplicate-${randomUUID()}@example.test`;
    const sql = [1, 2].map(() => `INSERT INTO _user(id,unverified_email,password_hash,created) SELECT X'${randomUUID().replaceAll('-', '')}','${email}',password_hash,unixepoch() FROM _user WHERE id=X'${ownerHex}';`).join('\n');
    await writeFile(sqlPath, sql, { mode: 0o600 }); await harness.startNativeForUpgrade('legacy-upgrade'); const prior = snapshot(); assert.equal(prior.users.length, before.users.length + 2);
    await harness.stopNativeForUpgrade(); await assertMigrationRefused('UNIQUE constraint failed: _user.unverified_email'); assert.deepEqual(snapshot(), prior);
    report.generatedDuplicateObservation = { pendingIdentities: 2, startupRefused: true, fullGeneratedRowsUnchanged: true };
  });
  await restore(); report.status = 'passed';
} catch (error) {
  report.tests.push({ name: step, status: 'failed' });
  if (env) await writeFile(resolve(env.directory, 'native-upgrade-failure-private.log'), String(error.stack ?? error), { mode: 0o600 });
  report.failure = 'owned-native-upgrade-assertion-or-setup-failure';
} finally {
  try { if (harness) await harness.cleanup(); if (backup) await rm(backup, { recursive: true, force: true }); report.cleanup = 'passed'; }
  catch { report.cleanup = 'failed'; report.status = 'failed'; }
  if (await sourceHash() !== report.sourceSha256) { report.status = 'failed'; report.failure = 'source-drift'; }
  await mkdir('artifacts/native-upgrade', { recursive: true }); await writeFile('artifacts/native-upgrade/latest.json', JSON.stringify(report, null, 2) + '\n');
  await rm('.runtime/phase-a.lock', { recursive: true });
}
console.log(JSON.stringify({ scope: report.scope, status: report.status, tests: report.tests, cleanup: report.cleanup, evidence: 'artifacts/native-upgrade/latest.json' }));
process.exitCode = report.status === 'passed' ? 0 : 1;
