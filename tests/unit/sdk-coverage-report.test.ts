import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { coverageEvidence } from '../../scripts/run-sdk-coverage.mjs';
it('L1-26/L1-27 RQ01 coverage evidence refuses absent modules and records zero-hit locations without source or arbitrary fields', () => {
  const metrics = Object.fromEntries(['statements','lines','functions','branches'].map(key => [key, { total: 10, covered: 10, skipped: 0, pct: 100 }]));
  const location = { start: { line: 2, column: 0 }, end: { line: 3, column: 1 } };
  const path = resolve('src/common.ts');
  const summary = { total: metrics, [path]: metrics };
  const raw = { [path]: { s: { 0: 0 }, f: { 0: 0 }, b: { 0: [0, 1] }, statementMap: { 0: location }, fnMap: { 0: { loc: location, name: 'SECRET_CANARY' } }, branchMap: { 0: { locations: [location, location] } }, source: 'SECRET_CANARY' } };
  const proof = coverageEvidence(summary, raw, ['src/common.ts']);
  expect(proof.thresholdsPassed).toBe(true);
  expect(proof.files[0].uncovered).toEqual({ statements: [location], functions: [location], branches: [location] });
  expect(JSON.stringify(proof)).not.toContain('SECRET_CANARY');
  expect(() => coverageEvidence(summary, raw, [])).toThrow();
  expect(() => coverageEvidence(summary, raw, ['src/auth.ts'])).toThrow();
  expect(() => coverageEvidence({}, raw, ['src/common.ts'])).toThrow();
  const below = structuredClone(summary); below[path].statements.pct = 94;
  expect(coverageEvidence(below, raw, ['src/common.ts']).thresholdsPassed).toBe(false);
});
