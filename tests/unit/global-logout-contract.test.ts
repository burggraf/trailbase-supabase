import { expect, it } from 'vitest';
import { assertAuthenticatedGlobalLogout } from '../proofs/global-logout.mjs';
const before = { ownerSessions: 2, sibling: { sessions: 'complete-sibling-session-digest' }, protectedState: { accounts: 'complete-account-digest', rows: 'complete-data-digest' } };
const after = { ...before, ownerSessions: 0 };
it('L1-19/GL06 shared quiescent contract requires real acknowledgement plus all-owner revocation and preserved state', () => {
  expect(() => assertAuthenticatedGlobalLogout({ acknowledged: true, before, after })).not.toThrow();
});
it('L1-19/GL06 local success, redirect, health, or missing receipt cannot stand in for authenticated acknowledgement', () => {
  for (const state of [before, after]) expect(() => assertAuthenticatedGlobalLogout({ acknowledged: false, before, after: state })).toThrow();
});
it('L1-19/GL06 a claimed receipt cannot hide retained sessions, sibling revocation, account or data changes', () => {
  for (const state of [before, { ...after, sibling: null }, { ...after, protectedState: null }]) expect(() => assertAuthenticatedGlobalLogout({ acknowledged: true, before, after: state })).toThrow();
  for (const count of [0, 1, -1, NaN, Infinity]) expect(() => assertAuthenticatedGlobalLogout({ acknowledged: true, before: { ...before, ownerSessions: count }, after })).toThrow();
});
