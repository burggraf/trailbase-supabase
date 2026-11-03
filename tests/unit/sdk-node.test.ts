import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

it('L1-26/PN01 shared owned tarball installer is available without browser or runner startup', async () => {
  const module = await import('../../scripts/sdk-browser.mjs');
  const prepare = Reflect.get(module, 'preparePackedConsumer');
  expect(prepare).toBeTypeOf('function');
  await expect(prepare('/tmp/not-an-owned-run')).rejects.toThrow('ownership');
});

it('L1-26/PN08 real packed Node CI runs independently and strictly on both pinned runtimes', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  expect(pkg.scripts['test:sdk:node']).toBe('node scripts/run-sdk-node.mjs');
  const workflow = await readFile('.github/workflows/phase-a.yml', 'utf8');
  const job = workflow.split('  sdk-node:\n')[1]?.split('  real-backends:\n')[0];
  expect(job).toBeDefined();
  expect(job).toContain("node: ['22.23.2', '24.21.0']");
  expect(job).toContain('needs: static-unit');
  expect(job).toContain('node-version: ${{ matrix.node }}');
  expect(job).toContain('npm run test:sdk:node');
  expect(job).toContain('artifacts/sdk-node/*.json');
  expect(job).toContain('if: always()');
  expect(job).not.toMatch(/continue-on-error|\|\|\s*true|path:.*\.runtime|docker (?:pull|prune)|SUPABASE_.*REGISTRY/);
});

it('L1-26/PN08 consumer proof accepts exact case IDs/statuses and rejects planted secrets without echo', async () => {
  const { parseNodeConsumerProof } = await import('../../scripts/run-sdk-node.mjs');
  const proof = { node: 'v22.23.2', tests: Array.from({ length: 8 }, (_, i) => ({ id: `PN0${i + 1}`, status: 'passed' })), owners: [{ id: '00000000-0000-4000-8000-000000000001', email: 'packed-node-00000000-0000-4000-8000-000000000001@example.test' }], rowIds: [1,2,3,4].map(i => `00000000-0000-4000-8000-00000000000${i}`) };
  expect(parseNodeConsumerProof(JSON.stringify(proof))).toEqual(proof);
  for (const value of [null, { ...proof, node: 'v24.22.1' }, { ...proof, password: 'PRIVATE_CANARY' }, { ...proof, tests: [] }, { ...proof, tests: proof.tests.map(t => ({ ...t, status: 'skipped' })) }, { ...proof, owners: [{ ...proof.owners[0], token: 'PRIVATE_CANARY' }] }, { ...proof, rowIds: Array(4).fill(proof.rowIds[0]) }]) expect(() => parseNodeConsumerProof(JSON.stringify(value))).toThrow('Invalid packed Node consumer proof');
  expect(() => parseNodeConsumerProof('PRIVATE_CANARY')).toThrow('Invalid packed Node consumer proof');
  expect(() => parseNodeConsumerProof('x'.repeat(1048577))).toThrow('Invalid packed Node consumer proof');
  expect(() => parseNodeConsumerProof({ toString() { throw Error('Must not coerce'); } })).toThrow('Invalid packed Node consumer proof');
});
