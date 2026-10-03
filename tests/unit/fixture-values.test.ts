import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { nativeUuid, canonicalUuid, deadline } from '../phase-a/helpers.js';

describe('L1-27/U27 G2 fixture UUID inputs (not production codec)', () => {
  it('bounds asynchronous probes without changing results or hiding failures',async()=>{
    expect(await deadline(Promise.resolve(7))).toBe(7);
    await expect(deadline(Promise.reject(new Error('Original failure')))).rejects.toThrow('Original failure');
    await expect(deadline(new Promise<never>(()=>{}),1,'Fixture operation')).rejects.toThrow('Fixture operation deadline exceeded');
  });
  it('uses padding required by the native BLOB input decoder', () => {
    const id='11111111-1111-4111-8111-111111111111';
    expect(nativeUuid(id)).toBe('ERERERERQRGBEREREREREQ==');
    expect(canonicalUuid(nativeUuid(id))).toBe(id);
  });
  it('round-trips 1000 seeded UUIDv4 fixture values exactly', () => {
    for (let i=0;i<1000;i++) {
      const bytes=createHash('sha256').update(`phase-a-uuid-seed-1/${i}`).digest().subarray(0,16);
      bytes[6]=(bytes[6]! & 0x0f) | 0x40; bytes[8]=(bytes[8]! & 0x3f) | 0x80;
      const hex=bytes.toString('hex');
      const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      expect(canonicalUuid(nativeUuid(id))).toBe(id);
      expect(nativeUuid(id).endsWith('==')).toBe(true);
    }
  });
});
