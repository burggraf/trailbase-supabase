import assert from 'node:assert/strict';
// Shared quiescent-fixture assertions only; this is not SDK code or an authorization layer.
// Callers must obtain complete observations from their owned backend, with no concurrent new login.
/** @param {{acknowledged:boolean,before:{ownerSessions:number,sibling:unknown,protectedState:unknown},after:{ownerSessions:number,sibling:unknown,protectedState:unknown}}} observation */
export function assertAuthenticatedGlobalLogout({ acknowledged, before, after }) {
  assert.equal(acknowledged, true, 'Local completion, redirect or health is not an authenticated acknowledgement');
  assert(Number.isSafeInteger(before.ownerSessions) && before.ownerSessions >= 2, 'Fixture must establish two independent owner sessions');
  assert.equal(after.ownerSessions, 0, 'A quiescent acknowledged logout must revoke every owner session');
  assert.deepEqual(after.sibling, before.sibling, 'Global logout must preserve every unrelated session');
  assert.deepEqual(after.protectedState, before.protectedState, 'Global logout must preserve complete protected account/data state');
}
