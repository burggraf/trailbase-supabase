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

it('L1-27 candidate SMTP and characterization remain independent strict steps after an earlier research failure', () => {
  const workflow = readFileSync('.github/workflows/phase-a.yml', 'utf8');
  const research = workflow.split('  real-backends:\n')[1]!;
  const steps = research.split(/^      - /m).slice(1);
  const characterization = steps.find(step => step.includes('npm run test:phase-a -- characterization --auth-mitigation'));
  const smtp = steps.find(step => step.includes('npm run test:phase-a -- smtp --auth-mitigation'));
  expect(characterization).toBeDefined(); expect(smtp).toBeDefined(); expect(smtp).not.toBe(characterization);
  for (const step of [characterization!, smtp!]) {
    expect(step).toContain('if: always()');
    expect(step.match(/npm run test:phase-a/g)).toHaveLength(1);
    expect(step).not.toMatch(/continue-on-error|\|\|\s*true/);
  }
  expect(research).not.toContain('continue-on-error'); expect(research).toContain('needs: static-unit');
});

it('L1-26/L1-27 CI independently executes current native upgrade safety and uploads only its sanitized report', () => {
  const research = readFileSync('.github/workflows/phase-a.yml', 'utf8').split('  real-backends:\n')[1]!;
  const upgrade = research.split(/^      - /m).find(step => step.includes('npm run test:native:upgrade'));
  expect(upgrade).toBeDefined(); expect(upgrade).toContain('if: always()');
  expect(upgrade).not.toMatch(/continue-on-error|\|\|\s*true/);
  expect(research).toContain('artifacts/native-upgrade/*.json');
  expect(research).toContain('npm run test:cleanup'); expect(research).not.toContain('path: .runtime');
});

it('L1-14/R01-R06 independent pinned reference auth contracts execute strictly despite upstream native research failures', () => {
  const research = readFileSync('.github/workflows/phase-a.yml', 'utf8').split('  real-backends:\n')[1]!;
  const reference = research.split(/^      - /m).find(step => step.includes('npm run test:auth:reference'));
  expect(reference).toBeDefined(); expect(reference).toContain('if: always()');
  expect(reference).not.toMatch(/continue-on-error|\|\|\s*true/);
  expect(reference!.match(/npm run/g)).toHaveLength(1);
});

it('L1-26/P26 CI cache warmup uses only exact currently locked runtime packages, not dependency upgrades', () => {
  const workflow = readFileSync('.github/workflows/phase-a.yml', 'utf8'), lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const references = [...workflow.matchAll(/npm cache add (\S+)/g)].map(match => match[1]); expect(references).toHaveLength(12);
  for (const reference of references) {
    const separator = reference.lastIndexOf('@'), name = reference.slice(0, separator), version = reference.slice(separator + 1);
    expect(lock.packages[`node_modules/${name}`].version).toBe(version);
  }
});
