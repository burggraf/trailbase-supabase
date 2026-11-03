import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { baseline, exec } from './tools.mjs';
import { createHarness } from './harness.mjs';
import { sourceHash } from './run-phase-a.mjs';
import { preparePackedConsumer } from './sdk-browser.mjs';

const names = [
  'L1-02/L1-26/PN01 installed bare-package resolution and shipped declarations',
  'L1-14/L1-15/PN02 real signup409 confirmation and password login',
  'L1-16/L1-17/L1-20/PN03 disk persistence separate Node reload and live user',
  'L1-03-L1-13/L1-24/PN04 owner CRUD filters bounds cardinality and forbidden writes',
  'L1-18/PN05 actual expiry and single-flight persisted renewal',
  'L1-18/L1-20/PN06 genuine background renewal and disabled storage',
  'L1-19/PN07 explicit local global uncertainty and aborted logout errors',
  'L1-24/L1-26/L1-27/PN08 independent cleanup and complete native postconditions',
];
export function parseNodeConsumerProof(text) {
  const invalid = () => { throw new Error('Invalid packed Node consumer proof'); };
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576) invalid();
  let proof; try { proof = JSON.parse(text); } catch { invalid(); }
  if (!proof || Array.isArray(proof) || Object.keys(proof).sort().join() !== 'node,owners,rowIds,tests' || !baseline.nodeVersions.some(v => proof.node === `v${v}`)) invalid();
  if (!Array.isArray(proof.tests) || proof.tests.length !== names.length || proof.tests.some((t, i) => !t || Object.keys(t).sort().join() !== 'id,status' || t.id !== `PN0${i + 1}` || !['passed','failed','not-executed'].includes(t.status))) invalid();
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
  if (!Array.isArray(proof.owners) || proof.owners.length > 2 || proof.owners.some(o => !o || Object.keys(o).sort().join() !== 'email,id' || !uuid(o.id) || typeof o.email !== 'string' || !/^packed-node-[a-f0-9-]{36}@example\.test$/.test(o.email))) invalid();
  if (!Array.isArray(proof.rowIds) || proof.rowIds.length !== 4 || !proof.rowIds.every(uuid) || new Set(proof.rowIds).size !== 4) invalid();
  return proof;
}
function snapshot(db, table) {
  assert(['_user','_session','todos','todo_audit'].includes(table));
  const statement = db.prepare(`SELECT * FROM ${table} ORDER BY ${table === '_session' ? 'user,refresh_token' : table === 'todo_audit' ? 'audit_key' : 'id'}`);
  statement.setReadBigInts(true); return statement.all();
}
async function main() {
  if (process.argv.length !== 2 || !baseline.nodeVersions.some(v => process.version === `v${v}`)) throw new Error('Use the pinned Node runtimes with no fixture overrides');
  await mkdir('.runtime', { recursive: true, mode: 0o700 });
  // Never touch a live fixture's lock (including the retained original demo).
  await mkdir('.runtime/phase-a.lock');
  await writeFile('.runtime/phase-a.lock/owner.json', JSON.stringify({ runnerPid: process.pid, runId: null }), { mode: 0o600 });
  const report = { scope: 'Real installed tarball Node CRUD/password-auth integration on owned official0358; documented null signup/global uncertainty, NOT full package/security/coverage/release/signoff', node: process.version, baseline, suite: 'sdk-node', authVariant: 'stock', nativeAuthProfile: 'short-native-auth', nativeServerProfile: 'default', nativeServerPin: { version: baseline.trailbase.version, commit: baseline.trailbase.commit }, status: 'failed', tests: [], cleanup: 'not-started' };
  let harness, mainDb, sessionDb, stage = 'initialize';
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    report.sourceSha256 = await sourceHash(); report.baseCommit = (await exec('git', ['rev-parse','HEAD'])).stdout.trim();
    if (process.env.GITHUB_RUN_ID) report.ci = { commit: process.env.GITHUB_SHA, runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` };
    stage = 'fixture-start'; harness = await createHarness({ nativeAuthProfile: 'short-native-auth' }); report.runId = harness.context.id;
    await writeFile('.runtime/phase-a.lock/owner.json', JSON.stringify({ runnerPid: process.pid, runId: report.runId }), { mode: 0o600 });
    const env = await harness.start(); assert.equal(env.authVariant, 'stock'); assert.equal(env.nativeServerProfile, 'default');
    report.environment = { trailVersion: env.trailVersion, cliVersion: env.cliVersion, containers: env.containers };
    if (controller.signal.aborted) throw Error('Interrupted');
    stage = 'packed-install'; const packed = await preparePackedConsumer(env.directory), { consumer } = packed;
    report.packedConsumer = { tarballSha256: createHash('sha256').update(await readFile(packed.tarball)).digest('hex'), runtimeDependencies: packed.runtimeDependencies, fileSha256: {} };
    for (const file of packed.files) report.packedConsumer.fileSha256[file] = createHash('sha256').update(await readFile(resolve(consumer,'node_modules/trailbase-supabase',file))).digest('hex');
    stage = 'shipped-type-consumers';
    for (const name of ['sdk-data','sdk-auth']) {
      const types = (await readFile(`tests/types/${name}.ts`, 'utf8')).replaceAll('../../src/index.js','trailbase-supabase');
      assert(!types.includes('../../src/')); assert(types.includes("from 'trailbase-supabase'"));
      await writeFile(resolve(consumer,`${name}.ts`), types);
    }
    await writeFile(resolve(consumer,'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [] }, include: ['sdk-data.ts','sdk-auth.ts'] }));
    const checked = await exec(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', resolve(consumer,'tsconfig.json')], { cwd: consumer, timeout: 60000, maxBuffer: 2000000, signal: controller.signal });
    await writeFile(resolve(env.directory,'node-types-private.log'), checked.stdout + checked.stderr, { mode: 0o600 });
    stage = 'consumer'; await cp('tests/package/sdk-node-consumer.mjs', resolve(consumer,'consumer.mjs'));
    await writeFile(resolve(consumer,'node-context-private.json'), JSON.stringify({ id: env.id, trailUrl: env.trailUrl, mailUrl: env.mailUrl }), { mode: 0o600 });
    mainDb = new DatabaseSync(resolve(env.directory,'traildepot/data/main.db'), { readOnly: true }); sessionDb = new DatabaseSync(resolve(env.directory,'traildepot/data/session.db'), { readOnly: true });
    const before = { users: snapshot(mainDb,'_user'), sessions: snapshot(sessionDb,'_session'), todos: snapshot(mainDb,'todos'), audit: snapshot(mainDb,'todo_audit') };
    let childFailed = false;
    try {
      const result = await exec(process.execPath, ['consumer.mjs'], { cwd: consumer, timeout: 300000, maxBuffer: 2000000, signal: controller.signal });
      await writeFile(resolve(env.directory,'node-consumer-private.log'), result.stdout + result.stderr, { mode: 0o600 });
    } catch (error) {
      childFailed = true; await writeFile(resolve(env.directory,'node-consumer-private.log'), String(error.stdout ?? '') + String(error.stderr ?? ''), { mode: 0o600 });
    }
    const raw = await readFile(resolve(consumer,'node-result-private.json'), 'utf8'); await writeFile(resolve(env.directory,'node-result-private.json'), raw, { mode: 0o600 });
    const proof = parseNodeConsumerProof(raw); assert.equal(proof.node, process.version);
    report.tests = proof.tests.map((test, index) => ({ name: names[index], status: test.status }));
    assert(!childFailed && proof.tests.every(t => t.status === 'passed'), 'Installed consumer failed; retained private primary and cleanup diagnostics');
    stage = 'database-postconditions'; assert.equal(proof.owners.length, 2); assert.equal(new Set(proof.owners.map(o => o.id)).size, 2);
    const bytes = id => Buffer.from(id.replaceAll('-',''), 'hex'), isOwner = value => proof.owners.some(o => bytes(o.id).equals(Buffer.from(value)));
    const users = snapshot(mainDb,'_user'), audit = snapshot(mainDb,'todo_audit');
    assert.deepEqual(users.filter(row => !isOwner(row.id)), before.users); assert.equal(users.length - before.users.length, 2);
    for (const owner of proof.owners) { const row = users.find(row => bytes(owner.id).equals(Buffer.from(row.id))); assert.equal(row.email, owner.email); assert.equal(row.unverified_email, null); }
    assert.deepEqual(snapshot(sessionDb,'_session'), before.sessions); assert.deepEqual(snapshot(mainDb,'todos'), before.todos); assert.deepEqual(audit.filter(row => !isOwner(row.user_id)), before.audit);
    assert.equal(audit.filter(row => isOwner(row.user_id)).length, 7);
    for (const [index, operations] of [['INSERT','UPDATE','DELETE'],['INSERT','DELETE'],['INSERT','DELETE'],[]].entries()) assert.deepEqual(audit.filter(row => bytes(proof.rowIds[index]).equals(Buffer.from(row.todo_id))).map(row => row.operation), operations);
    report.postconditions = { addedConfirmedOwners: 2, ownedPendingIdentities: 0, ownedRefreshSessions: 0, ownedRows: 0, expectedAuditOperations: 7, existingAccountsSessionsRowsAuditUnchanged: true };
    if (controller.signal.aborted || await sourceHash() !== report.sourceSha256) throw Error('Interrupted or source changed');
    report.status = 'passed';
  } catch (error) {
    if (harness) await writeFile(resolve(harness.context.directory,'node-controller-private.log'), String(error.stack ?? '') + '\n' + String(error.stdout ?? '') + String(error.stderr ?? ''), { mode: 0o600 });
    report.failureStage = stage; console.error(`Packed Node scope failed at ${stage}; private diagnostics retained, no success inferred.`);
    if (stage === 'database-postconditions' && report.tests.length) report.tests[7].status = 'failed';
  } finally {
    for (const db of [mainDb, sessionDb]) { try { db?.close(); } catch { report.status = 'failed'; report.databaseClose = 'failed'; } }
    report.setupStage = harness?.context.setupStage ?? 'not-created'; report.supabaseStartup = harness?.context.supabaseStartup; report.supabaseStartContext = harness?.context.supabaseStartContext;
    try { if (harness) { await harness.cleanup(); report.cleanup = 'passed'; } }
    catch { report.cleanup = 'failed'; report.status = 'failed'; }
    if (report.sourceSha256 && await sourceHash() !== report.sourceSha256) { report.status = 'failed'; report.sourceChanged = true; }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    await mkdir('artifacts/sdk-node', { recursive: true }); await writeFile(`artifacts/sdk-node/${report.runId ?? Date.now()}.json`, JSON.stringify(report,null,2)+'\n');
    await rm('.runtime/phase-a.lock', { recursive: true });
    console.log(`Packed Node scope: ${report.status}; ${report.tests.filter(t=>t.status==='passed').length}/8 cases passed; owned cleanup ${report.cleanup}.`);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
