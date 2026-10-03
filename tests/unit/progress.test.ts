import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateProgress, validateReviewHash } from '../../scripts/progress.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('../../docs/progress.json', import.meta.url),'utf8'));
describe('L1-27/U27 resumable progress and honest signoff', () => {
  it('validates the real checked-in ledger', () => { expect(() => validateProgress(fixture())).not.toThrow(); });
  it('rejects missing or duplicate feature IDs', () => {
    const missing = fixture(); missing.features.pop(); expect(() => validateProgress(missing)).toThrow();
    const duplicate = fixture(); duplicate.features[1].id=duplicate.features[0].id; expect(() => validateProgress(duplicate)).toThrow();
  });
  it('rejects undocumented states and missing restart actions', () => {
    const bad = fixture(); bad.features[0].status='done'; expect(() => validateProgress(bad)).toThrow();
    const empty = fixture(); empty.nextSteps=[]; expect(() => validateProgress(empty)).toThrow();
  });
  it('cannot claim verification without evidence', () => {
    const bad = fixture(); bad.features[0].status='verified'; bad.features[0].evidence=[];
    expect(() => validateProgress(bad)).toThrow('No evidence');
  });
  it('cannot sign off with missing tests, reviewer, date or evidence', () => {
    const signed = fixture();
    const approval={status:'signed-off',evidence:['docs/evidence/example.json'],missing:[],reviewer:signed.maintainer,reviewedAt:'2026-10-02',reviewedSourceSha256:'0'.repeat(64)};
    Object.assign(signed.features[0],approval);
    for(const gate of signed.gates) Object.assign(gate,approval);
    expect(() => validateProgress(signed)).not.toThrow();
    for (const change of [{evidence:[]},{missing:['security tests']},{reviewer:null},{reviewer:'automated-agent'},{reviewedAt:null},{reviewedAt:'not a date'},{reviewedSourceSha256:null},{reviewedSourceSha256:'old'}]) {
      const bad=structuredClone(signed); Object.assign(bad.features[0],change); expect(() => validateProgress(bad)).toThrow();
    }
  });
  it('a fresh report cannot silently carry old maintainer approval onto changed sources', () => {
    const row={id:'L1-01',status:'signed-off',reviewedSourceSha256:'0'.repeat(64)};
    expect(() => validateReviewHash(row,'0'.repeat(64))).not.toThrow();
    expect(() => validateReviewHash(row,'1'.repeat(64))).toThrow('approval is stale');
  });
  it('cannot sign off a feature while compatibility decisions remain open', () => {
    const bad=fixture(); Object.assign(bad.features[0],{status:'signed-off',evidence:['docs/evidence/example.json'],missing:[],reviewer:bad.maintainer,reviewedAt:'2026-10-02',reviewedSourceSha256:'0'.repeat(64)});
    expect(() => validateProgress(bad)).toThrow('Research gates');
  });
  it('rejects an approval attached to work that remains unsigned', () => {
    const bad=fixture(); bad.features[0].reviewer=bad.maintainer; expect(() => validateProgress(bad)).toThrow('unsigned');
  });
  it('rejects external/private-token style evidence references', () => {
    const bad=fixture(); bad.features[0].evidence=['https://example.test/token']; expect(() => validateProgress(bad)).toThrow();
  });
});
