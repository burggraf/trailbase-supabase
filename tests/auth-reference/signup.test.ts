import { expect, it } from 'vitest';
import { confirmEmail, supabase, verificationLink, type Context } from '../phase-a/helpers.js';
import { account, authSnapshot, confirmationCooldown, identity, mailCount, observedResendClient, referenceContext, replacementPassword, withSmtpStopped } from './helpers.js';

async function signup(env: Context, credentials: { email: string; password: string }) {
  const client = supabase(env), result = await client.auth.signUp(credentials);
  expect(result.error).toBeNull(); expect(result.data.session).toBeNull();
  expect(result.data.user?.email).toBe(credentials.email);
  const stored = await account(env, credentials.email);
  expect(stored?.confirmed).toBe(false); expect(result.data.user?.id).toBe(stored?.id);
  expect(stored?.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
  expect((await client.auth.getSession()).data.session).toBeNull();
  return { client, user: result.data.user!, stored: stored! };
}
async function provePasswordAfterRealConfirmation(env: Context, credentials: { email: string; password: string }, wrong: string, id: string) {
  await confirmEmail(env, credentials.email);
  const invalid = supabase(env), denied = await invalid.auth.signInWithPassword({ email: credentials.email, password: wrong });
  expect(denied.error?.code).toBe('invalid_credentials'); expect(denied.data.session).toBeNull();
  expect((await invalid.auth.getSession()).data.session).toBeNull();
  const valid = supabase(env), login = await valid.auth.signInWithPassword(credentials);
  expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(id); expect(login.data.session).not.toBeNull();
  expect((await account(env, credentials.email))?.confirmed).toBe(true);
  expect((await valid.auth.signOut({ scope: 'local' })).error).toBeNull();
}
async function deliveryBarrier(env: Context) {
  const control = identity('mail-barrier'); await signup(env, control); await verificationLink(env, control.email);
}

it('L1-14/R01 reference NEW signup detected SMTP failure rolls back complete auth state, then returns real user and confirms after recovery', async () => {
  const env = await referenceContext(), credentials = identity('new-smtp'), before = await authSnapshot(env), client = supabase(env);
  expect(await account(env, credentials.email)).toBeNull(); expect(await mailCount(env, credentials.email)).toBe(0);
  await withSmtpStopped(env, async () => {
    const failed = await client.auth.signUp(credentials);
    expect(failed.error?.status).toBe(500); expect(failed.data).toEqual({ user: null, session: null });
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(await authSnapshot(env)).toEqual(before); expect(await account(env, credentials.email)).toBeNull();
  });
  await deliveryBarrier(env); expect(await mailCount(env, credentials.email)).toBe(0);
  const recovered = await signup(env, credentials);
  const denied = await supabase(env).auth.signInWithPassword(credentials);
  expect(denied.error?.code).toBe('email_not_confirmed'); expect(denied.data.session).toBeNull();
  await provePasswordAfterRealConfirmation(env, credentials, replacementPassword(), recovered.user.id);
}, 60000);

it('L1-14/R02 reference EXISTING pending SMTP failure preserves identity/password/tokens and public resend genuinely recovers confirmation', async () => {
  const env = await referenceContext(), credentials = identity('pending-smtp'), first = await signup(env, credentials), wrong = replacementPassword();
  await verificationLink(env, credentials.email); await confirmationCooldown(env);
  const before = await authSnapshot(env);
  await withSmtpStopped(env, async () => {
    const failed = await supabase(env).auth.signUp({ email: credentials.email, password: wrong });
    expect(failed.error?.status).toBe(500); expect(failed.data).toEqual({ user: null, session: null });
    expect(await authSnapshot(env)).toEqual(before); expect(await account(env, credentials.email)).toEqual(first.stored);
  });
  const resend = await supabase(env).auth.resend({ type: 'signup', email: credentials.email });
  expect(resend.error).toBeNull(); expect(resend.data).toEqual({ user: null, session: null });
  expect(await account(env, credentials.email)).toEqual(first.stored);
  await provePasswordAfterRealConfirmation(env, credentials, wrong, first.user.id);
}, 60000);

it('L1-14/R03 reference pending signup retry preserves original password and real identity, respecting configured public resend429 without busy retries', async () => {
  const env = await referenceContext(), credentials = identity('pending-retry'), client = supabase(env);
  // Immediate resend, before slow database probes, deliberately exercises the unchanged fixture1s policy.
  const first = await client.auth.signUp(credentials); expect(first.error).toBeNull(); expect(first.data.session).toBeNull();
  const limited = await supabase(env).auth.resend({ type: 'signup', email: credentials.email });
  expect(limited.error?.status).toBe(429); expect(limited.error?.code).toBe('over_email_send_rate_limit');
  expect(limited.data).toEqual({ user: null, session: null });
  const original = await account(env, credentials.email); expect(first.data.user?.id).toBe(original?.id); expect(original?.confirmed).toBe(false);
  const before = await authSnapshot(env); const denied = await supabase(env).auth.signInWithPassword(credentials);
  expect(denied.error?.code).toBe('email_not_confirmed'); expect(denied.data.session).toBeNull();
  await confirmationCooldown(env);
  const wrong = replacementPassword(), retry = await supabase(env).auth.signUp({ email: credentials.email, password: wrong });
  expect(retry.error).toBeNull(); expect(retry.data.session).toBeNull(); expect(retry.data.user?.id).toBe(original?.id);
  expect(await account(env, credentials.email)).toEqual(original);
  const after = await authSnapshot(env);
  for (const table of ['users', 'identities', 'sessions', 'refresh_tokens']) {
    const a = after.find(t => t.name === table)!, b = before.find(t => t.name === table)!;
    expect(a.count).toBe(b.count); if (table !== 'users') expect(a).toEqual(b);
  }
  await provePasswordAfterRealConfirmation(env, credentials, wrong, original!.id);
}, 60000);

it('L1-14/R04 reference public signup resend for UNKNOWN address is generic success with no auth rows or confirmation mail', async () => {
  const env = await referenceContext(), credentials = identity('unknown-resend'), before = await authSnapshot(env), { client, observed } = observedResendClient(env);
  const result = await client.auth.resend({ type: 'signup', email: credentials.email });
  expect(observed).toEqual({ status: 200, emptyObject: true });
  expect(result.error).toBeNull(); expect(result.data).toEqual({ user: null, session: null });
  expect(await authSnapshot(env)).toEqual(before); expect(await account(env, credentials.email)).toBeNull();
  await deliveryBarrier(env); expect(await mailCount(env, credentials.email)).toBe(0);
}, 60000);

it('L1-14/R05 reference public signup resend for CONFIRMED address is generic success with unchanged complete auth state and no new confirmation mail', async () => {
  const env = await referenceContext(), credentials = identity('confirmed-resend'); await signup(env, credentials); await confirmEmail(env, credentials.email);
  const before = await authSnapshot(env), mailBefore = await mailCount(env, credentials.email), { client, observed } = observedResendClient(env);
  const result = await client.auth.resend({ type: 'signup', email: credentials.email });
  expect(observed).toEqual({ status: 200, emptyObject: true });
  expect(result.error).toBeNull(); expect(result.data).toEqual({ user: null, session: null });
  expect(await authSnapshot(env)).toEqual(before); expect((await account(env, credentials.email))?.confirmed).toBe(true);
  await deliveryBarrier(env); expect(await mailCount(env, credentials.email)).toBe(mailBefore);
}, 60000);

it('L1-14/R06 reference aligned confirmation-enabled duplicate uses intentional placeholder, not a real new user or password/session overwrite', async () => {
  const env = await referenceContext(), credentials = identity('confirmed-duplicate'), first = await signup(env, credentials); await confirmEmail(env, credentials.email);
  const before = await authSnapshot(env), mailBefore = await mailCount(env, credentials.email), wrong = replacementPassword();
  const duplicate = await supabase(env).auth.signUp({ email: credentials.email, password: wrong });
  expect(duplicate.error).toBeNull(); expect(duplicate.data.session).toBeNull(); expect(duplicate.data.user?.email).toBe(credentials.email);
  expect(duplicate.data.user?.id).toBeTruthy(); expect(duplicate.data.user?.id).not.toBe(first.user.id); expect(duplicate.data.user?.identities).toEqual([]);
  const after = await authSnapshot(env);
  expect(after.filter(t => t.name !== 'audit_log_entries')).toEqual(before.filter(t => t.name !== 'audit_log_entries'));
  expect(after.find(t => t.name === 'audit_log_entries')!.count).toBe(before.find(t => t.name === 'audit_log_entries')!.count + 1);
  await deliveryBarrier(env); expect(await mailCount(env, credentials.email)).toBe(mailBefore);
  const invalid = await supabase(env).auth.signInWithPassword({ email: credentials.email, password: wrong }); expect(invalid.error?.code).toBe('invalid_credentials');
  const original = await supabase(env).auth.signInWithPassword(credentials); expect(original.error).toBeNull(); expect(original.data.user?.id).toBe(first.user.id);
}, 60000);
