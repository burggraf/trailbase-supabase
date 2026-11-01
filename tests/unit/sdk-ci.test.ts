import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('L1-26/L1-27 focused SDK CI keeps real scopes, packed consumers and sanitized unconditional teardown separate from release gates', () => {
  const workflow = readFileSync('.github/workflows/phase-a.yml', 'utf8');
  const sdk = workflow.split('  sdk-mvp:\n')[1]?.split('  real-backends:\n')[0];
  for (const command of ['test:sdk:auth', 'test:sdk:refresh', 'test:sdk:data', 'test:db', 'test:phase-a -- constraints', 'test:sdk:browser', 'test:example:todos', 'test:cleanup']) expect(sdk).toContain(`npm run ${command}`);
  expect(sdk).toContain('if: always()'); expect(sdk).toContain('artifacts/phase-a/*.json'); expect(sdk).toContain('artifacts/todos/*.json'); expect(sdk).not.toContain('.runtime');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const gate of ['contract', 'security', 'e2e', 'package', 'all']) expect(pkg.scripts[`test:${gate}`]).toBe(`node scripts/incomplete.mjs ${gate}`);
});

it('L1-26/P26 CI cache warmup uses only exact currently locked runtime packages, not dependency upgrades', () => {
  const workflow = readFileSync('.github/workflows/phase-a.yml', 'utf8'), lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const references = [...workflow.matchAll(/npm cache add (\S+)/g)].map(match => match[1]); expect(references).toHaveLength(12);
  for (const reference of references) {
    const separator = reference.lastIndexOf('@'), name = reference.slice(0, separator), version = reference.slice(separator + 1);
    expect(lock.packages[`node_modules/${name}`].version).toBe(version);
  }
});
