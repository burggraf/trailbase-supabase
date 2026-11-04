import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { resolve } from 'node:path';
import { negativeContext, load, original, nativeState, deleteNativeOwner, deleteReferenceOwner, referenceAuditSnapshot, assertReferenceAuditPreserved } from './helpers.js';
import { authSnapshot } from '../auth-reference/helpers.js';
import { nativeUuid } from '../phase-a/helpers.js';
import { withCleanup } from '../sdk-browser/cleanup.js';

it('L1-18/L1-27/AN05–06 primary failure preserves identity through fresh ordinary-MFA/exact owned cleanup and full postconditions', async () => {
  const env = await negativeContext(false), state = await load(env), before = await original(env);
  const auditBefore = state.reference?.id ? await referenceAuditSnapshot(env, state.reference) : [];
  await writeFile(resolve(env.directory, 'reference-audit-before-cleanup-private.json'), JSON.stringify(auditBefore), { mode: 0o600, flag: 'wx' });
  const primary = new Error('Owned AN primary failure after completed native assertions');
  const owners = [...new Map([...state.owners, ...state.rejected].map(owner => [owner.email, owner])).values()];
  await expect(withCleanup(async () => { throw primary; }, [
    ...owners.map((owner, index) => async () => {
      if (index || !owner.rowId) { await deleteNativeOwner(env, owner); return; }
      const transport = globalThis.fetch, rowFailure = new Error('Owned row DELETE reply lost after genuine commit');
      let injected = false, failure: unknown;
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const response = await transport(input, init);
        if (!injected && init?.method === 'DELETE' && url.origin === env.trailUrl && url.pathname.includes('/todos/') && decodeURIComponent(url.pathname.split('/').at(-1)!) === nativeUuid(owner.rowId!)) {
          expect(response.ok).toBe(true); await response.arrayBuffer(); injected = true; throw rowFailure;
        }
        return response;
      };
      try { await deleteNativeOwner(env, owner); } catch (error) { failure = error; }
      finally { globalThis.fetch = transport; }
      expect(injected).toBe(true);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toContain(rowFailure);
      const after = nativeState(env), own = Uint8Array.from(Buffer.from(nativeUuid(owner.id!), 'base64url'));
      expect(after.users.some(row => Buffer.from(row.id as Uint8Array).equals(own))).toBe(false);
      expect(after.sessions.some(row => Buffer.from(row.user as Uint8Array).equals(own))).toBe(false);
    }),
    async () => { if (state.reference) await deleteReferenceOwner(env, state.reference); },
    async () => {
      expect(await readFile(resolve(env.directory, 'traildepot/config.textproto'), 'utf8')).toBe(await readFile(resolve(env.directory, 'registration-original-config-private.txt'), 'utf8'));
      const after = nativeState(env);
      expect(after.users).toEqual(before.native.users); expect(after.sessions).toEqual(before.native.sessions); expect(after.todos).toEqual(before.native.todos);
      const seeded = state.owners.filter(owner => owner.rowId), operations = ['INSERT', 'DELETE'].flatMap(operation => seeded.map(owner => ({ owner, operation })));
      const firstKey = (before.native.audit.at(-1)?.audit_key as bigint | undefined) ?? 0n;
      expect(after.audit).toEqual([...before.native.audit, ...operations.map(({ owner, operation }, index) => ({ audit_key: firstKey + BigInt(index + 1), todo_id: Uint8Array.from(Buffer.from(nativeUuid(owner.rowId!), 'base64url')), user_id: Uint8Array.from(Buffer.from(nativeUuid(owner.id!), 'base64url')), operation }))]);
      const reference = await authSnapshot(env);
      expect(reference.filter(row => row.name !== 'audit_log_entries')).toEqual(before.reference.filter(row => row.name !== 'audit_log_entries'));
      if (state.reference?.id) {
        const audit = await referenceAuditSnapshot(env, state.reference);
        expect(auditBefore.length).toBeGreaterThan(0);
        assertReferenceAuditPreserved(auditBefore, audit);
      }
    },
  ]).catch(async error => {
    // Preserve complete nested primary/cleanup errors privately; the public case remains a fixed safe summary.
    try {
      const diagnostic = inspect(error, { depth: null, maxArrayLength: null, maxStringLength: null });
      if (Buffer.byteLength(diagnostic) > 1048576) throw new Error('Owned private cleanup diagnostic exceeds1MiB');
      await writeFile(resolve(env.directory, 'negative-cleanup-errors-private.log'), diagnostic, { mode: 0o600 });
    }
    catch (loggingError) { throw new AggregateError([error, loggingError], 'Owned cleanup and private diagnostic failures'); }
    throw error;
  })).rejects.toBe(primary);
});
