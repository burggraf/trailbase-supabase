import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { baseline, exec } from './tools.mjs';
import { createHarness } from './harness.mjs';

export async function sourceHash() {
  const paths = ['package.json','package-lock.json','tsconfig.json','vitest.config.ts','playwright.config.ts','.gitignore','README.md','PLAN.md','AGENTS.md','docs/LEVEL1_PLAN.md','docs/RESEARCH.md','docs/TEST_PLAN.md','docs/AUTH_MIGRATION_INVESTIGATION.md'];
  const listed = (await exec('git',['ls-files','--cached','--others','--exclude-standard','-z'])).stdout.split('\0');
  const inputs = [...new Set(listed.filter(path => paths.includes(path) || /^(scripts|tests|\.github|src|examples)\//.test(path)))].sort();
  const hash = createHash('sha256');
  for (const path of inputs) {
    let bytes;
    try { bytes = await readFile(path); } catch(error) { if(error.code==='ENOENT') continue; throw error; }
    hash.update(path).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}
async function main() {
  const suite = process.argv[2] ?? 'all';
  const options = process.argv.slice(3);
  if (options.some(option => option !== '--auth-mitigation') || options.length > 1) throw new Error('Unknown Phase A option');
  const authMitigation = options.includes('--auth-mitigation');
  if (!['all','database','characterization','domains','boundaries','streaming','smtp','lifecycle','browser'].includes(suite)) throw new Error('Unknown Phase A suite');
  await mkdir('.runtime', { recursive: true, mode: 0o700 });
  // ponytail: one local stack at a time; per-run locks/port reservations if concurrent local runs matter.
  // Refuse overlap rather than stopping someone else's fixtures.
  await mkdir('.runtime/phase-a.lock');
  await writeFile('.runtime/phase-a.lock/owner.json', JSON.stringify({ runnerPid: process.pid, runId: null }), { mode: 0o600 });
  let harness, testChild;
  const report = { scope: 'Phase A upstream/infrastructure harness, NOT SDK verification', authVariant:authMitigation ? 'candidate-email-reservation' : 'stock', suite, status: 'failed', startedAt: new Date().toISOString(), baseline, node: process.version, platform: `${process.platform}-${process.arch}`, tests: [], cleanup: 'not-started' };
  let interrupted = false;
  const interrupt = () => { interrupted = true; testChild?.kill('SIGTERM'); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  async function runTests(name, binary, args, extraEnv = {}) {
    let output = '';
    testChild = spawn(resolve('node_modules/.bin', binary), args, {
      env: { ...process.env, ...extraEnv, PHASE_A_CONTEXT: resolve(harness.context.directory, 'context.json') }, stdio: ['ignore','pipe','pipe']
    });
    // Never stream assertion dumps/auth replies. Only sanitized case summaries leave the private run directory.
    for (const stream of [testChild.stdout,testChild.stderr]) stream.on('data', bytes => { if (output.length < 2_000_000) output += bytes; });
    const timer = setTimeout(() => testChild.kill('SIGTERM'), 300000);
    const killTimer = setTimeout(() => testChild.kill('SIGKILL'), 305000);
    let code;
    try { code = await new Promise((yes,no) => { testChild.once('error',no); testChild.once('exit',yes); }); }
    finally { clearTimeout(timer); clearTimeout(killTimer); }
    await writeFile(resolve(harness.context.directory, `${name}.log`), output, { mode: 0o600 });
    if (interrupted || code !== 0) return false;
    return true;
  }
  try {
    report.sourceSha256 = await sourceHash();
    report.baseCommit = (await exec('git', ['rev-parse','HEAD'])).stdout.trim();
    if (process.env.GITHUB_RUN_ID) report.ci = { commit:process.env.GITHUB_SHA, runUrl:`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` };
    harness = await createHarness({ authMitigation });
    report.runId = harness.context.id;
    await writeFile('.runtime/phase-a.lock/owner.json', JSON.stringify({ runnerPid:process.pid, runId:harness.context.id }), { mode:0o600 });
    const environment = await harness.start();
    report.runId = environment.id;
    report.environment = { trailVersion:environment.trailVersion, cliVersion:environment.cliVersion, containers:environment.containers };
    if (interrupted) throw new Error('Run interrupted');
    console.log('Phase A backends ready; running real upstream checks.');
    if (suite === 'lifecycle') { report.injectedFailure='after-start'; throw new Error('Injected fixture setup failure'); }
    if (suite !== 'browser') {
      const file = resolve(harness.context.directory,'vitest.json');
      const args = ['run', ...(suite === 'all' ? ['tests/phase-a'] : [`tests/phase-a/${suite}.test.ts`]), '--reporter=json','--outputFile',file];
      const success = await runTests('vitest','vitest',args);
      const results = JSON.parse(await readFile(file,'utf8'));
      report.tests.push(...results.testResults.flatMap(result => result.assertionResults.map(test => ({ name:test.fullName, status:test.status }))));
      if (!success) throw new Error('Phase A assertions failed; inspect private run diagnostics');
    }
    if (suite === 'all' || suite === 'browser') {
      const file = resolve(harness.context.directory,'playwright.json');
      const success = await runTests('playwright','playwright',['test'],{ PLAYWRIGHT_JSON_OUTPUT_FILE:file });
      const results = JSON.parse(await readFile(file,'utf8'));
      function collect(suites) {
        for (const suite of suites) {
          for (const spec of suite.specs ?? []) for (const test of spec.tests) report.tests.push({ name:`${spec.title} [${test.projectName}]`, status:test.results.length === 1 && test.results[0].status === 'passed' ? 'passed' : 'failed' });
          collect(suite.suites ?? []);
        }
      }
      collect(results.suites);
      report.browserRevisions = JSON.parse(await readFile('node_modules/playwright-core/browsers.json','utf8')).browsers;
      if (!success) throw new Error('Phase A browser assertions failed; inspect private run diagnostics');
    }
    if (!report.tests.length || report.tests.some(test => test.status !== 'passed')) throw new Error('Phase A missing/skipped/failed tests');
    report.status = 'passed';
  } catch (error) {
    if (suite === 'lifecycle' && report.injectedFailure === 'after-start' && error.message === 'Injected fixture setup failure') {
      console.log('Injected setup failure reached finally-cleanup; passing requires no owned resources remain.');
      report.status='passed';
      report.tests=[{ name:'L1-27/I27 injected setup failure reaches unconditional owned-resource cleanup', status:'passed' }];
    } else {
      console.error(error.message.startsWith('Local Supabase') || error.message.startsWith('Phase A') ? error.message : 'Phase A setup/run failed; inspect private .runtime diagnostics');
      report.status='failed';
    }
  } finally {
    try { if (harness) { await harness.cleanup(); report.cleanup='passed'; } else { report.cleanup='not-started'; } }
    catch { report.cleanup='failed'; report.status='failed'; console.error('Fixture cleanup failed; see private run logs before restarting.'); }
    if (report.sourceSha256 && await sourceHash() !== report.sourceSha256) { report.status='failed'; console.error('Harness sources changed during run; evidence is stale, rerun.'); }
    report.finishedAt=new Date().toISOString();
    await mkdir('artifacts/phase-a',{recursive:true});
    const path=`artifacts/phase-a/${report.runId ?? Date.now()}.json`;
    await writeFile(path,JSON.stringify(report,null,2)+'\n');
    for (const test of report.tests) console.log(`${test.status.toUpperCase()} ${test.name}`);
    console.log(`Sanitized evidence: ${path} (${report.status}; cleanup ${report.cleanup})`);
    await rm('.runtime/phase-a.lock',{recursive:true});
    process.exitCode=report.status === 'passed' ? 0 : 1;
  }
}
if (resolve(process.argv[1] ?? '') === resolve('scripts/run-phase-a.mjs')) await main();
