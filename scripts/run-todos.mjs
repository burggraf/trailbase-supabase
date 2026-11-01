import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness, todosPublicOrigin } from './harness.mjs';
import { sourceHash } from './run-phase-a.mjs';
import { baseline } from './tools.mjs';

export function todosOptions(args, version = process.version) {
  if (!baseline.nodeVersions.map(value => `v${value}`).includes(version)) throw new Error(`Use pinned Node ${baseline.nodeVersions.join(' or ')}`);
  if (new Set(args).size !== args.length || args.some(arg => !['--check', '--tailnet'].includes(arg))) throw new Error('Only --check and approved --tailnet canonical origin are accepted; all fixture listeners remain loopback');
  return { check: args.includes('--check'), ...(args.includes('--tailnet') ? { publicOrigin: todosPublicOrigin } : {}) };
}

async function main({ check, publicOrigin }) {
  await mkdir('.runtime', { recursive: true, mode: 0o700 });
  const sourceSha256 = await sourceHash();
  // The same lock protects tests and the interactive app; never remove somebody else's lock.
  await mkdir('.runtime/phase-a.lock');
  let harness;
  const report = { scope: 'Owned local todos launcher readiness and shutdown; NOT browser/compatibility/release signoff', status: 'failed', node: process.version, sourceSha256, baseline, ...(publicOrigin ? { publicOrigin } : {}), tests: [], cleanup: 'not-started' };
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stop = () => finish();
  const input = createInterface({ input: process.stdin });
  input.on('line', line => { if (line.trim() === 'quit') stop(); else console.log('Type quit and Enter to stop this disposable instance.'); });
  input.once('close', stop);
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await writeFile('.runtime/phase-a.lock/owner.json', JSON.stringify({ runnerPid: process.pid, runId: null }), { mode: 0o600 });
    harness = await createHarness({ sdkBrowser: true, publicOrigin });
    report.runId = harness.context.id;
    await writeFile('.runtime/phase-a.lock/owner.json', JSON.stringify({ runnerPid: process.pid, runId: report.runId }), { mode: 0o600 });
    console.log(`Owned run: ${report.runId}`);
    const env = await harness.start();
    report.environment = { trailVersion: env.trailVersion, cliVersion: env.cliVersion, containers: env.containers };
    report.packedBrowser = env.packedBrowser;
    report.tests.push({ name: 'L1-27/S10 isolated real native/mail fixture with original pins and loopback bindings', status: 'passed' });
    for (const asset of ['index.html', 'main.js', 'app.js', 'sdk.js', 'styles.css']) {
      const response = await fetch(`${env.trailUrl}/sdk-data/${asset}`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Local example asset readiness failed');
      const text = await response.text();
      if (!text || asset === 'index.html' && (!text.includes('<script type="module" src="./main.js"></script>') || !text.includes('type="importmap"'))) throw new Error('Local example entrypoint missing');
    }
    report.tests.push({ name: 'L1-26/E01 packed standalone entrypoint and assets served by real TrailBase', status: 'passed' });
    console.log(`App: ${publicOrigin ?? env.trailUrl}/sdk-data/index.html`);
    console.log(`Loopback app: ${env.trailUrl}`);
    console.log(`Local test inbox: ${env.mailUrl}`);
    if (publicOrigin) console.log(`Private test inbox: ${new URL(publicOrigin).origin.replace(':18443', ':18444')} (separate approved Serve required)`);
    console.log('Use disposable credentials. Sign up once, follow the real inbox link, then explicitly sign in.');
    console.log('All app data is deleted on shutdown. Ctrl-C or type quit and Enter to stop.');
    if (!check) await done;
    report.status = 'passed';
  } catch (error) {
    if (harness) await writeFile(resolve(harness.context.directory, 'todos-launcher-private.log'), String(error.stack ?? error), { mode: 0o600 });
    console.error('Local todos startup/run failed; inspect this owned run’s private diagnostics.');
  } finally {
    input.close();
    report.setupStage = harness?.context.setupStage ?? 'not-created';
    try {
      if (harness) await harness.cleanup();
      report.cleanup = 'passed';
      const owner = JSON.parse(await readFile('.runtime/phase-a.lock/owner.json', 'utf8'));
      if (owner.runnerPid !== process.pid || owner.runId !== (report.runId ?? null)) throw new Error('Refusing unrelated lock removal');
      await rm('.runtime/phase-a.lock', { recursive: true });
    } catch {
      report.cleanup = 'failed'; report.status = 'failed';
      console.error('Owned cleanup incomplete; do not bypass the lock. Use guarded fixtures:cleanup only after its runner exits.');
    }
    if (await sourceHash() !== report.sourceSha256) { report.status = 'failed'; console.error('Sources changed during this run; restart to load and verify the new app.'); }
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    report.finishedAt = new Date().toISOString();
    await mkdir('artifacts/todos', { recursive: true });
    const path = `artifacts/todos/${report.runId ?? Date.now()}.json`;
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    console.log(`Todos launcher evidence: ${path} (${report.status}; cleanup ${report.cleanup})`);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
if (resolve(process.argv[1] ?? '') === resolve('scripts/run-todos.mjs')) {
  try { await main(todosOptions(process.argv.slice(2))); }
  catch { console.error('Cannot start local todos. Use pinned Node and local Docker; check the fixture lock and prerequisites in examples/todos/README.md. No existing lock is bypassed.'); process.exitCode = 1; }
}
