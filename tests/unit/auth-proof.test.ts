import { it,expect } from 'vitest';
import { authCoordinationProof,AuthProofHttpError,StaleAuthProofOperation } from '../proofs/auth-coordination.js';

it('L1-27 G7 stale cleanup failure exposes a failure flag/cause without changing its stale-operation category',()=>{
  const cause=new AuthProofHttpError(405),failure=new StaleAuthProofOperation(true,{cause});
  expect(failure).toMatchObject({name:'StaleAuthProofOperation',cleanupFailed:true,cause:{name:'AuthProofHttpError',status:405}});
  expect(new StaleAuthProofOperation().cleanupFailed).toBe(false);
});

it('L1-27 G7 test-only logout rejects unsupported scopes and is request-free when already signed out',async()=>{
  let calls=0;
  const proof=authCoordinationProof(()=>{calls++;throw new Error('Unexpected proof request');});
  await expect(proof.logout('others' as never)).rejects.toThrow('Unsupported proof logout scope');
  await proof.logout();await proof.logout('local');await proof.logout('global');
  expect(await proof.refresh()).toBe(false);expect(proof.tokens()).toBeUndefined();
  expect(proof.headers()).toEqual({'content-type':'application/json'});expect(calls).toBe(0);
});
