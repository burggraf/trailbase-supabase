import { readFile, readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadProgress, validateReviewHash } from './progress.mjs';
import { sourceHash } from './run-phase-a.mjs';
import { exec } from './tools.mjs';
for (const name of await readdir('scripts')) if (name.endsWith('.mjs')) await exec(process.execPath,['--check',`scripts/${name}`]);

const files=['README.md','PLAN.md','AGENTS.md',...(await readdir('docs')).filter(name=>name.endsWith('.md')).map(name=>`docs/${name}`)];
for (const file of files) {
  const text=await readFile(file,'utf8');
  if (!text.startsWith('# ') || !text.endsWith('\n') || (text.match(/^```/gm) ?? []).length % 2) throw new Error(`Invalid markdown structure: ${file}`);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(match[1])) continue;
    await access(resolve(file,'..',match[1].split('#')[0]));
  }
}
const plan=await readFile('docs/TEST_PLAN.md','utf8');
for (let i=1;i<=27;i++) if (!plan.includes(`**L1-${String(i).padStart(2,'0')} `)) throw new Error('Missing test matrix row');
const ledger=await loadProgress();
const hash=await sourceHash();
for (const row of [...ledger.deliverables,...ledger.features,...ledger.gates]) {
  let fresh=false;
  for (const reference of row.evidence) {
    if (reference.startsWith('https://github.com/')) continue; // Maintainer reviews CI links; never treat a URL alone as proof.
    if (!/^docs\/evidence\/[A-Za-z0-9._-]+\.json$/.test(reference)) throw new Error(`Invalid local evidence path: ${row.id}`);
    const report=JSON.parse(await readFile(reference,'utf8'));
    if (report.status==='passed' && report.sourceSha256===hash) fresh=true;
    // Current reports whitelist summaries; reject accidental auth material in checked-in evidence.
    if (/eyJ[A-Za-z0-9_-]{20}|Bearer\s+\S+|"(?:auth_token|refresh_token|csrf_token|password|anonKey|ANON_KEY|SERVICE_ROLE_KEY)"\s*:/.test(JSON.stringify(report))) throw new Error(`Unsafe evidence: ${reference}`);
  }
  validateReviewHash(row, hash);
  if (['verified','signed-off'].includes(row.status) && !fresh) throw new Error(`Stale/missing current-source evidence: ${row.id}`);
}
const pkg=JSON.parse(await readFile('package.json','utf8'));
if (pkg.private!==true || pkg.license!=='MIT') throw new Error('Harness must remain private and MIT licensed');
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
if (lock.packages[''].license!=='MIT') throw new Error('Lockfile license drift');
console.log(`PASS docs/links/traceability: ${files.length} markdown files, 27 feature rows, 7 gates, evidence freshness and secret scan.`);
