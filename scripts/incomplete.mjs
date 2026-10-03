const layer = process.argv[2] ?? 'all';
console.error(`The Level 1 SDK ${layer} gate is NOT IMPLEMENTED. Phase A upstream/browser infrastructure probes are not SDK conformance.`);
console.error('Run npm run progress for completed work, evidence, missing checks, and next steps. See docs/TEST_PLAN.md.');
process.exitCode = 1;
