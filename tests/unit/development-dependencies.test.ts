import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

it('L1-24/L1-27 DP01 retains the integrity-verified Vite security patch as development-only with matching Vitest coverage', () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  expect(lock.packages['node_modules/vite']).toMatchObject({
    version: '8.3.3',
    resolved: 'https://registry.npmjs.org/vite/-/vite-8.3.3.tgz',
    integrity: 'sha512-cTAldKPImjg6c+gk48U19POPn3GCBzZwpdsN8ZMEEcbpes+6/wvfqUd0C2y3qYY4wsj8PwgFwrZ/1jBPVttMSg==',
    dev: true,
  });
  expect(lock.packages['node_modules/vitest'].version).toBe('5.0.3');
  expect(lock.packages['node_modules/@vitest/coverage-v8'].version).toBe('5.0.3');
  expect(JSON.parse(readFileSync('package.json', 'utf8')).dependencies).not.toHaveProperty('vite');
});
