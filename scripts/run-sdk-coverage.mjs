import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { baseline, exec } from './tools.mjs';
import { sourceHash } from './run-phase-a.mjs';

const thresholds = { statements: 95, lines: 95, functions: 95, branches: 90 };
export function coverageEvidence(summary, raw, modules) {
  const metrics = value => Object.fromEntries(Object.keys(thresholds).map(key => {
    const metric = value?.[key];
    if (!metric || !['total', 'covered', 'skipped', 'pct'].every(field => typeof metric[field] === 'number' && Number.isFinite(metric[field])) || metric.skipped !== 0 || metric.total < metric.covered || metric.covered < 0) throw new Error('Invalid coverage metrics');
    return [key, { total: metric.total, covered: metric.covered, skipped: metric.skipped, pct: metric.pct }];
  }));
  if (!modules.length || Object.keys(raw).sort().join() !== modules.map(file => resolve(file)).sort().join()) throw new Error('Missing or unexpected runtime coverage module');
  const files = modules.map(file => {
    const path = resolve(file), data = raw[path];
    const location = entry => ({ start: { line: entry.start.line, column: entry.start.column }, end: { line: entry.end.line, column: entry.end.column } });
    return { path: relative(process.cwd(), path), metrics: metrics(summary[path]), uncovered: {
      statements: Object.entries(data.s).filter(([, hits]) => hits === 0).map(([id]) => location(data.statementMap[id])),
      functions: Object.entries(data.f).filter(([, hits]) => hits === 0).map(([id]) => location(data.fnMap[id].loc)),
      branches: Object.entries(data.b).flatMap(([id, hits]) => hits.flatMap((hit, index) => hit === 0 ? [location(data.branchMap[id].locations[index])] : [])),
    } };
  });
  const total = metrics(summary.total);
  return { thresholds, total, files, thresholdsPassed: [total, ...files.map(file => file.metrics)].every(value => Object.entries(thresholds).every(([key, minimum]) => value[key].pct >= minimum)) };
}
async function main() {
  if (process.argv.length !== 2 || !baseline.nodeVersions.includes(process.version.slice(1))) throw new Error('Use exact pinned Node with no coverage overrides');
  const sourceSha256 = await sourceHash();
  await mkdir('.runtime', { recursive: true, mode: 0o700 });
  await rm('.runtime/sdk-coverage', { recursive: true, force: true });
  let passed = false, log;
  try {
    const result = await exec(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit', '--coverage'], { timeout: 120000, maxBuffer: 20000000 });
    passed = true; log = result.stdout + result.stderr;
  } catch (error) { log = String(error.stdout ?? '') + String(error.stderr ?? ''); }
  await writeFile('.runtime/sdk-coverage.log', log, { mode: 0o600 });
  const modules = (await readdir('src', { recursive: true })).filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts')).map(file => `src/${file}`).sort();
  let evidence = null;
  try { evidence = coverageEvidence(JSON.parse(await readFile('.runtime/sdk-coverage/coverage-summary.json', 'utf8')), JSON.parse(await readFile('.runtime/sdk-coverage/coverage-final.json', 'utf8')), modules); }
  catch { passed = false; }
  const unchanged = await sourceHash() === sourceSha256;
  const status = passed && unchanged && evidence?.thresholdsPassed ? 'passed' : 'failed';
  const report = { scope: 'Runtime SDK unit coverage only; not critical-branch/security/release approval', status, sourceSha256, baseCommit: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(), node: process.version, sourceUnchanged: unchanged, evidence, signoff: false };
  if (process.env.GITHUB_RUN_ID) report.ci = { commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID };
  await mkdir('artifacts/sdk-coverage', { recursive: true });
  await writeFile(`artifacts/sdk-coverage/node-${process.version.slice(1)}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`Runtime SDK coverage: ${status}; artifacts/sdk-coverage/node-${process.version.slice(1)}.json`);
  if (evidence) for (const file of [{ path: 'TOTAL', metrics: evidence.total }, ...evidence.files]) console.log(file.path, JSON.stringify(file.metrics));
  process.exitCode = status === 'passed' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Runtime SDK coverage collection failed; no passing coverage evidence'); process.exitCode = 1; });
