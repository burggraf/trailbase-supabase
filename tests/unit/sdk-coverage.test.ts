import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import config from '../../vitest.config.js';

it('L1-24/L1-26 RQ01 runtime coverage includes every SDK module with unchanged global and per-module thresholds', () => {
  const coverage = config.test?.coverage;
  expect(coverage?.provider).toBe('v8');
  expect(coverage?.include).toEqual(['src/**/*.ts']);
  expect(coverage?.exclude).toEqual([]);
  expect(coverage?.thresholds).toEqual({ statements: 95, lines: 95, functions: 95, branches: 90, perFile: { statements: 95, lines: 95, functions: 95, branches: 90 } });
  expect(coverage?.reportOnFailure).toBe(true);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(pkg.devDependencies['@vitest/coverage-v8']).toBe(pkg.devDependencies.vitest);
  expect(pkg.scripts['test:sdk:coverage']).toBe('node scripts/run-sdk-coverage.mjs');
});
