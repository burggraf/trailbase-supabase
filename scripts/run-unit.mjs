import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exec } from './tools.mjs';
import { sourceHash } from './run-phase-a.mjs';

await mkdir('.runtime',{recursive:true,mode:0o700});
await mkdir('artifacts/unit',{recursive:true});
await rm('.runtime/unit.json',{force:true});
const sourceSha256 = await sourceHash();
let exitPassed = false;
try {
  const result = await exec(resolve('node_modules/.bin/vitest'),['run','tests/unit','--reporter=json','--outputFile',resolve('.runtime/unit.json')],{ timeout:60000 });
  await writeFile('.runtime/unit.log',result.stdout+result.stderr,{mode:0o600});
  exitPassed = true;
} catch (error) { await writeFile('.runtime/unit.log',String(error.stdout??'')+String(error.stderr??''),{mode:0o600}); }
let tests = [];
try {
  const results = JSON.parse(await readFile('.runtime/unit.json','utf8'));
  tests = results.testResults.flatMap(file=>file.assertionResults.map(test=>({name:test.fullName,status:test.status})));
} catch { /* Startup failure is a failed run, not an empty green suite. */ }
const status = exitPassed && tests.length > 0 && tests.every(test=>test.status==='passed') && await sourceHash()===sourceSha256 ? 'passed' : 'failed';
const report = { scope:'Phase A harness unit/traceability checks, NOT SDK coverage/signoff', status, node:process.version, platform:`${process.platform}-${process.arch}`, sourceSha256, finishedAt:new Date().toISOString(), tests };
await writeFile('artifacts/unit/latest.json',JSON.stringify(report,null,2)+'\n');
for (const test of tests) console.log(`${test.status.toUpperCase()} ${test.name}`);
console.log(`Harness unit checks: ${status}; sanitized evidence artifacts/unit/latest.json`);
process.exitCode = status==='passed' ? 0 : 1;
