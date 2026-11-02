// Only registered literals cross the public report boundary. Error payloads stay private.
const steps = Object.freeze({
  G1_PENDING_CONFIRM: 'signup-confirmation',
  G1_PENDING_LOGIN: 'signup-original-password',
  G1_SMTP_OUTAGE: 'smtp-failure-safety',
  G1_SMTP_RETRY: 'smtp-retry',
  G1_SMTP_RESEND: 'smtp-resend',
  G1_SMTP_MAIL: 'smtp-redelivery',
  G1_SMTP_CONFIRM: 'smtp-confirmation',
  G1_SMTP_LOGIN: 'smtp-original-password',
  G7_REFERENCE_EVENT_ORDER: 'reference-event-order',
  G7_NATIVE_LATE_REFRESH: 'native-stale-refresh',
  G7_NATIVE_LATE_STATUS: 'native-stale-status',
  G7_LOCAL_REVOCATION: 'native-local-revocation',
  G7_GLOBAL_REVOCATION: 'native-global-revocation',
});
function own(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch { return undefined; }
}
function registered(id) { return typeof id === 'string' && Object.hasOwn(steps, id); }
function diagnostic(id) {
  return registered(id) ? { step: id, category: steps[id] } : { step: 'UNCLASSIFIED', category: 'unclassified' };
}
export function diagnosticFromMeta(meta) { return diagnostic(own(meta, 'phaseADiagnostic')); }
export function diagnosticFromAnnotations(annotations) {
  try { if (!Array.isArray(annotations)) return diagnostic(); }
  catch { return diagnostic(); } // Array.isArray throws for a revoked Proxy.
  const length = own(annotations, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 1000) return diagnostic();
  for (let index = 0; index < length; index++) {
    const annotation = own(annotations, String(index));
    if (own(annotation, 'type') === 'phase-a-step') return diagnostic(own(annotation, 'description'));
  }
  return diagnostic();
}
/** @template T @param {object} sink @param {string} id @param {() => T | Promise<T>} operation @returns {Promise<T>} */
export async function diagnosticStep(sink, id, operation) {
  if (!registered(id)) throw new Error('Unregistered Phase A diagnostic');
  try { return await operation(); }
  catch (error) {
    try {
      if (Array.isArray(sink)) {
        if (!sink.some(item => own(item, 'type') === 'phase-a-step')) sink.push({ type: 'phase-a-step', description: id });
      } else if (!Object.hasOwn(sink, 'phaseADiagnostic')) {
        Object.defineProperty(sink, 'phaseADiagnostic', { value: id, enumerable: true });
      }
    } catch { /* Metadata failure cannot replace or hide the actual strict failure. */ }
    throw error;
  }
}
export function vitestCase(test) {
  const name = own(test, 'fullName'), status = own(test, 'status');
  return { name: typeof name === 'string' ? name : 'unnamed-test', status: ['passed', 'failed', 'pending', 'todo', 'skipped', 'disabled'].includes(status) ? status : 'failed', ...(status === 'passed' ? {} : { diagnostic: diagnosticFromMeta(own(test, 'meta')) }) };
}
export function playwrightCase(spec, test) {
  const name = own(spec, 'title'), project = own(test, 'projectName'), results = own(test, 'results');
  const attempts = Array.isArray(results) ? results.map(result => { const status = own(result, 'status'); return ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(status) ? status : 'failed'; }) : [];
  const status = attempts.length === 1 && attempts[0] === 'passed' ? 'passed' : 'failed';
  return { name: `${typeof name === 'string' ? name : 'unnamed-test'} [${typeof project === 'string' ? project : 'unknown-project'}]`, status, attempts, ...(status === 'failed' ? { diagnostic: diagnosticFromAnnotations(own(test, 'annotations')) } : {}) };
}
export function runnerFailure(error) {
  switch (own(error, 'message')) {
    case 'Injected fixture setup failure': return 'injected-setup';
    case 'Phase A assertions failed; inspect private run diagnostics': return 'assertions-failed';
    case 'Phase A browser assertions failed; inspect private run diagnostics': return 'browser-assertions-failed';
    case 'Phase A missing/skipped/failed tests': return 'incomplete-tests';
    default: return 'setup-or-run';
  }
}
