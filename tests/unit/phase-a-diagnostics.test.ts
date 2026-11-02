import { expect, it } from 'vitest';
import { diagnosticStep, diagnosticFromMeta, diagnosticFromAnnotations, runnerFailure, vitestCase, playwrightCase } from '../../scripts/phase-a-diagnostics.mjs';

const unknown = { step: 'UNCLASSIFIED', category: 'unclassified' };
const known = { step: 'G1_SMTP_MAIL', category: 'smtp-redelivery' };
const planted = ['PLANTED_PASSWORD_91!', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJwbGFudGVkIn0.planted', 'Bearer PLANTED_AUTHORIZATION', 'PLANTED_REFRESH_27', 'PLANTED_CSRF_38', 'planted-private@example.test', 'PLANTED_PRIVATE_TASK_TEXT', ['-----BEGIN', 'PRIVATE KEY-----\nPLANTED_NOT_A_KEY\n-----END', 'PRIVATE KEY-----'].join(' '), 'https://example.invalid/path?token=PLANTED_QUERY_VALUE'];

it('L1-27/S07 failed diagnostic step tags only its registered ID and rethrows the identical original failure', async () => {
  const meta: Record<string, unknown> = {}, original = new Error(planted.join(' '));
  try { await diagnosticStep(meta, 'G1_SMTP_MAIL', () => { throw original; }); throw Error('Missing original failure'); }
  catch (error) { expect(error === original).toBe(true); }
  expect(diagnosticFromMeta(meta)).toEqual(known);
  expect(original.message).toBe(planted.join(' '));
});

it('L1-27 successful step has no failure tag and unregistered labels cannot run an operation', async () => {
  const meta: Record<string, unknown> = {}; let calls = 0;
  expect(await diagnosticStep(meta, 'G1_SMTP_MAIL', async () => { calls++; return 7; })).toBe(7);
  expect(meta).toEqual({}); expect(calls).toBe(1);
  for (const id of ['UNKNOWN_ID', '__proto__', 'constructor', ...planted]) await expect(diagnosticStep(meta, id, () => { calls++; })).rejects.toThrow('Unregistered Phase A diagnostic');
  expect(calls).toBe(1);
});

it('L1-27 nested failure preserves the innermost registered assertion, not an outer cleanup/step label', async () => {
  const meta: Record<string, unknown> = {}, error = Error('owned failure');
  await expect(diagnosticStep(meta, 'G1_SMTP_CONFIRM', () => diagnosticStep(meta, 'G1_SMTP_MAIL', () => { throw error; }))).rejects.toBe(error);
  expect(diagnosticFromMeta(meta)).toEqual(known);
});

it('L1-27/S07 registered IDs are reconstructed from literals; arbitrary fields and error payloads never leave projection', () => {
  for (const secret of planted) {
    const error = { message: secret, stack: secret, expected: secret, actual: secret, cause: { secret }, toJSON: () => secret };
    const meta = { phaseADiagnostic: 'G1_SMTP_MAIL', category: secret, diagnostics: error, error, step: secret };
    const result = diagnosticFromMeta(meta); expect(result).toEqual(known);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(diagnosticFromMeta({ phaseADiagnostic: secret, error })).toEqual(unknown);
    expect(diagnosticFromAnnotations([{ type: 'phase-a-step', description: secret, error }])).toEqual(unknown);
    expect(runnerFailure(error)).toBe('setup-or-run');
  }
});

it('L1-27/S07 getters/proxies/coercion/inherited metadata fail closed without invoking accessors or leaking values', async () => {
  let touched = 0; const trip = () => { touched++; throw Error(planted.join(' ')); };
  const cases: unknown[] = [null, undefined, 'G1_SMTP_MAIL', { phaseADiagnostic: { toString: trip, [Symbol.toPrimitive]: trip } }, Object.create({ phaseADiagnostic: 'G1_SMTP_MAIL' }), Object.defineProperty({}, 'phaseADiagnostic', { get: trip }), new Proxy({}, { get: trip, getOwnPropertyDescriptor: trip })];
  for (const value of cases) expect(diagnosticFromMeta(value)).toEqual(unknown);
  // A descriptor trap may throw, but accessors/coercion methods are never invoked.
  expect(touched).toBe(1); touched = 0;
  const error = Object.defineProperties({}, { message: { get: trip }, stack: { get: trip }, toString: { value: trip } });
  expect(runnerFailure(error)).toBe('setup-or-run');
  const meta: Record<string, unknown> = {};
  try { await diagnosticStep(meta, 'G7_NATIVE_LATE_REFRESH', () => { throw error; }); } catch (caught) { expect(caught === error).toBe(true); }
  expect(diagnosticFromMeta(meta)).toEqual({ step: 'G7_NATIVE_LATE_REFRESH', category: 'native-stale-refresh' }); expect(touched).toBe(0);
});

it('L1-27 Playwright uses the same literal registry, with no arbitrary annotation descriptions or retry normalization', async () => {
  const annotations: { type: string; description?: string }[] = [{ type: 'unrelated', description: planted.join(' ') }], error = Error('original');
  await expect(diagnosticStep(annotations, 'G7_REFERENCE_EVENT_ORDER', () => { throw error; })).rejects.toBe(error);
  expect(diagnosticFromAnnotations(annotations)).toEqual({ step: 'G7_REFERENCE_EVENT_ORDER', category: 'reference-event-order' });
  expect(diagnosticFromAnnotations([{ type: 'phase-a-step', description: '__proto__' }])).toEqual(unknown);
  expect(diagnosticFromAnnotations([{ type: 'other', description: 'G1_SMTP_MAIL' }])).toEqual(unknown);
});

it('L1-27/S07 malformed/accessor/inherited/non-array annotations remain unclassified without coercion', () => {
  let touched = 0; const trip = () => { touched++; throw Error(planted.join(' ')); };
  const inherited = Object.create({ type: 'phase-a-step', description: 'G1_SMTP_MAIL' });
  const getterType = Object.defineProperty({}, 'type', { get: trip });
  const getterDescription = Object.defineProperty({ type: 'phase-a-step' }, 'description', { get: trip });
  const getterElement = Object.defineProperty([], '0', { get: trip });
  const knownAnnotation = { type: 'phase-a-step', description: 'G1_SMTP_MAIL' };
  const cases = [null, undefined, {}, 'G1_SMTP_MAIL', { length: 1, 0: knownAnnotation }, Object.create([knownAnnotation]), [null], [inherited], [getterType], [getterDescription], getterElement, [{ type: 'phase-a-step', description: { toString: trip, [Symbol.toPrimitive]: trip } }]];
  for (const value of cases) expect(diagnosticFromAnnotations(value)).toEqual(unknown);
  expect(touched).toBe(0);
  const proxy = new Proxy([], { get: trip, getOwnPropertyDescriptor: trip });
  expect(diagnosticFromAnnotations(proxy)).toEqual(unknown); expect(touched).toBe(1);
  const revoked = Proxy.revocable([], {}); revoked.revoke();
  expect(diagnosticFromAnnotations(revoked.proxy)).toEqual(unknown);
  const frozen = Object.freeze({}), original = Error('owned original');
  return expect(diagnosticStep(frozen, 'G1_SMTP_MAIL', () => { throw original; })).rejects.toBe(original);
});

it('L1-27 public runner projections preserve strict outcomes/attempts and ignore raw error objects', () => {
  const error = { message: planted.join(' '), expected: planted, actual: planted, stack: planted.join(' ') };
  expect(vitestCase({ fullName: 'fixed owned case', status: 'failed', meta: { phaseADiagnostic: 'G1_SMTP_MAIL', error }, failureMessages: planted })).toEqual({ name: 'fixed owned case', status: 'failed', diagnostic: known });
  expect(vitestCase({ fullName: 'fixed owned case', status: 'passed', meta: { phaseADiagnostic: 'G1_SMTP_MAIL' } })).toEqual({ name: 'fixed owned case', status: 'passed' });
  const spec = { title: 'fixed browser case' }, test = { projectName: 'chromium', annotations: [{ type: 'phase-a-step', description: 'G1_SMTP_MAIL' }], results: [{ status: 'failed', error }, { status: 'passed' }] };
  expect(playwrightCase(spec, test)).toEqual({ name: 'fixed browser case [chromium]', status: 'failed', attempts: ['failed', 'passed'], diagnostic: known });
  expect(playwrightCase(spec, { ...test, results: [] })).toEqual({ name: 'fixed browser case [chromium]', status: 'failed', attempts: [], diagnostic: known });
  expect(JSON.stringify(playwrightCase(spec, test))).not.toContain('PLANTED');
});

it('L1-27 runner failure classification uses exact registered sentinels, never a message prefix or arbitrary error field', () => {
  expect(runnerFailure(Error('Phase A assertions failed; inspect private run diagnostics'))).toBe('assertions-failed');
  expect(runnerFailure(Error('Phase A browser assertions failed; inspect private run diagnostics'))).toBe('browser-assertions-failed');
  expect(runnerFailure(Error('Injected fixture setup failure'))).toBe('injected-setup');
  for (const secret of planted) {
    expect(runnerFailure(Error(`Phase A ${secret}`))).toBe('setup-or-run');
    expect(runnerFailure(Error(`Local Supabase ${secret}`))).toBe('setup-or-run');
  }
});
