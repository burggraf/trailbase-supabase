import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const states = ['planned','in-progress','implemented','verified','signed-off','blocked'];
export function validateReviewHash(row, hash) {
  if (row.status==='signed-off' && row.reviewedSourceSha256!==hash) throw new Error(`Maintainer approval is stale: ${row.id}`);
}
export function validateProgress(ledger) {
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.nextSteps) || ledger.nextSteps.length === 0 || ledger.nextSteps.some(step => typeof step !== 'string' || !step.trim())) throw new Error('Missing restart instructions');
  for (const [field, expected] of [['deliverables',6],['features',27],['gates',7]]) {
    const rows = ledger[field];
    if (!Array.isArray(rows) || rows.length !== expected || new Set(rows.map(row => row.id)).size !== expected) throw new Error(`Invalid ${field} IDs/count`);
    for (const row of rows) {
      if (!states.includes(row.status)) throw new Error(`Invalid status for ${row.id}`);
      if (!row.title || !Array.isArray(row.missing) || !Array.isArray(row.evidence)) throw new Error(`Incomplete tracking for ${row.id}`);
      if (['verified','signed-off'].includes(row.status) && row.evidence.length === 0) throw new Error(`No evidence for ${row.id}`);
      if (row.evidence.some(reference => typeof reference !== 'string' || !(reference.startsWith('docs/evidence/') || reference.startsWith('https://github.com/burggraf/trailbase-supabase/')))) throw new Error(`Invalid evidence reference for ${row.id}`);
      if (row.status === 'signed-off' && (row.reviewer !== ledger.maintainer || !Number.isFinite(Date.parse(row.reviewedAt ?? '')) || !/^[a-f0-9]{64}$/.test(row.reviewedSourceSha256 ?? '') || row.missing.length > 0)) throw new Error(`Incomplete maintainer signoff for ${row.id}`);
      if (row.status !== 'signed-off' && (row.reviewer || row.reviewedAt || row.reviewedSourceSha256)) throw new Error(`Approval attached to unsigned ${row.id}`);
    }
  }
  if (ledger.features.some(row => row.status === 'signed-off') && ledger.gates.some(row => row.status !== 'signed-off')) throw new Error('Research gates need maintainer approval before feature signoff');
  for (let i = 1; i <= 6; i++) if (!ledger.deliverables.some(row => row.id === `A${String(i).padStart(2,'0')}`)) throw new Error('Missing Phase A deliverable');
  for (let i = 1; i <= 27; i++) if (!ledger.features.some(row => row.id === `L1-${String(i).padStart(2,'0')}`)) throw new Error('Missing feature ID');
  for (let i = 1; i <= 7; i++) if (!ledger.gates.some(row => row.id === `G${i}`)) throw new Error('Missing research gate');
}
export async function loadProgress() {
  const ledger = JSON.parse(await readFile(new URL('../docs/progress.json', import.meta.url), 'utf8'));
  validateProgress(ledger);
  return ledger;
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const ledger = await loadProgress();
  const { sourceHash } = await import('./run-phase-a.mjs');
  const hash = await sourceHash();
  for (const row of [...ledger.deliverables,...ledger.features,...ledger.gates]) validateReviewHash(row, hash);
  console.log(`Current phase: ${ledger.currentPhase}\nMaintainer: ${ledger.maintainer}\n`);
  for (const [heading, rows] of [['Phase A deliverables',ledger.deliverables],['Research gates',ledger.gates]]) {
    console.log(heading);
    for (const row of rows) {
      console.log(`  ${row.id.padEnd(5)} ${row.status.padEnd(12)} ${row.title}`);
      if (row.missing.length) console.log(`        Missing: ${row.missing.join('; ')}`);
    }
  }
  const signed = ledger.features.filter(row => row.status === 'signed-off').length;
  console.log(`\nSDK features signed off: ${signed}/27 (upstream probes do not verify the adapter).\n\nNext steps:`);
  ledger.nextSteps.forEach((step,i) => console.log(`${i+1}. ${step}`));
}
