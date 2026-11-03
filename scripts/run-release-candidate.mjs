import { mkdir, writeFile, rm, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { baseline, exec } from './tools.mjs';
import { sourceHash } from './run-phase-a.mjs';

// Existing supported suites only; strict upstream research remains a separate job.
export const candidateCommands = [
  ['check', 'check'], ['units', 'test:unit'], ['coverage', 'test:sdk:coverage'],
  ['package', 'test:sdk:package'], ['node', 'test:sdk:node'],
  ['auth', 'test:sdk:auth'], ['refresh', 'test:sdk:refresh'], ['data', 'test:sdk:data'],
  ['database', 'test:db'], ['constraints', 'test:phase-a', 'constraints'],
  ['browser', 'test:sdk:browser'], ['example', 'test:example:todos'], ['cleanup', 'test:cleanup'],
].map(([id, script, ...args]) => Object.freeze({ id, script, args: Object.freeze(args) }));
Object.freeze(candidateCommands);
export const remainingAcceptance = Object.freeze([
  'complete-active-matrix-and-critical-security-branch-review',
  'real-disabled-registration-and-mfa-negative-controls',
  'browser-cap-operator-expiry-race-and-storage-failure-matrix',
  'trusted-local-tls-auth-smoke-and-security-assessment',
  'complete-accessibility-and-100-cycle-auth-app-resource-proof',
  'physical-device-and-advertised-platform-acceptance',
  'three-consecutive-clean-same-candidate-runs',
  'named-maintainer-feature-limitations-and-release-signoff',
]);
export function assessCandidate(results, sourceMatches) {
  const passed = sourceMatches === true && Array.isArray(results) && results.length === candidateCommands.length && candidateCommands.every((entry, index) => results[index]?.id === entry.id && results[index]?.status === 'passed');
  return { automation: passed ? 'passed' : 'failed', qualification: 'blocked', remainingAcceptance, signoff: false };
}
export async function runCandidateCommands(run) {
  const results = [];
  for (const entry of candidateCommands) {
    let status = 'failed';
    try { await run(entry); status = 'passed'; } catch { /* Preserve every independent outcome, including cleanup. */ }
    results.push({ id: entry.id, status });
  }
  return results;
}
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function main() {
  const automationOnly = process.argv[2] === '--automation';
  if (process.argv.length !== (automationOnly ? 3 : 2) || !baseline.nodeVersions.includes(process.version.slice(1))) throw new Error('Use an exact pinned Node and no fixture overrides; optional --automation reports automation only');
  if (await exists('.runtime/phase-a.lock')) throw new Error('Existing fixture lock: use an independent clean checkout; never bypass a live lock');
  await mkdir('.runtime', { recursive: true, mode: 0o700 });
  const lock = '.runtime/release-candidate.lock';
  await mkdir(lock); // Exclusive; never remove an existing runner lock.
  const id = randomUUID(), directory = resolve('.runtime/release-candidate', id);
  let report;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(lock, 'owner.json'), JSON.stringify({ id, pid: process.pid }), { mode: 0o600 });
    const sourceSha256 = await sourceHash(), commit = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim();
    report = { schemaVersion: 1, id, scope: 'Official-supported existing automation; NOT full matrix/security/device/release approval', node: process.version, sourceSha256, baseCommit: commit, startedAt: new Date().toISOString(), commands: [], sourceUnchanged: false, automation: 'failed', qualification: 'blocked', remainingAcceptance, signoff: false };
    if (process.env.GITHUB_RUN_ID) report.ci = { commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID };
    report.commands = await runCandidateCommands(async entry => {
      let log = '', failure;
      try {
        const result = await exec('npm', ['run', entry.script, ...(entry.args.length ? ['--', ...entry.args] : [])], { timeout: 1800000, maxBuffer: 20000000 });
        log = result.stdout + result.stderr;
      } catch (error) { failure = error; log = String(error.stdout ?? '') + String(error.stderr ?? ''); }
      await writeFile(resolve(directory, `${entry.id}.log`), log, { mode: 0o600 });
      console.log(`${entry.id}: ${failure ? 'failed' : 'passed'}`);
      if (failure) throw failure;
    });
    report.sourceUnchanged = await sourceHash() === sourceSha256;
    Object.assign(report, assessCandidate(report.commands, report.sourceUnchanged), { finishedAt: new Date().toISOString() });
    await mkdir('artifacts/release-candidate', { recursive: true });
    await writeFile(`artifacts/release-candidate/${id}.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(`Automation: ${report.automation}; release qualification: BLOCKED (${remainingAcceptance.length} acceptance requirements). See docs/RELEASE_QUALIFICATION.md.`);
    process.exitCode = automationOnly && report.automation === 'passed' ? 0 : 1;
  } finally {
    // Only this invocation's successfully acquired runner lock is removed.
    await rm(lock, { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Candidate verification failed; inspect private owned diagnostics. No release approval.'); process.exitCode = 1; });
