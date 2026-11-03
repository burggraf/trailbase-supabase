import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as app from '../../examples/todos/app.js';

it('L1-14–20/E02–08 auth example mounts through the same module as the existing data application', () => {
  expect(Reflect.get(app, 'mountAuthTodos')).toBeTypeOf('function');
});

it('L1-14–20/E08 login 401 gives actionable guidance without claiming a specific account state', () => {
  const message = Reflect.get(app, 'authErrorMessage');
  expect(message({ name: 'FetchError', status: 401, message: 'FetchError(401, , https://private.example.test/api/auth/v1/login)' }, 'login')).toBe('Sign-in rejected (HTTP 401). Check the email and password and confirm the signup email in the test inbox. Accounts from other apps or earlier disposable runs are not available here.');
});

it('L1-14–20/E08 auth status survives plain SDK errors and remains operation-specific', () => {
  const message = Reflect.get(app, 'authErrorMessage');
  for (const action of ['refresh', 'validate']) expect(message({ status: 401 }, action)).toBe('Your session was rejected (HTTP 401). Sign in again.');
  expect(message({ status: 429 }, 'login')).toBe('Too many authentication requests (HTTP 429). Wait before retrying; do not repeatedly submit sign-up.');
  expect(message({ status: 503 }, 'login')).toBe('The authentication service could not complete the request (HTTP 503). Try again later; do not repeatedly submit sign-up.');
});

it('L1-14/OA04 signup409 is a rejection, not proof of an account or delivered mail', () => {
  expect(Reflect.get(app, 'authErrorMessage')({ status: 409, message: 'private-canary' }, 'signup')).toBe('Sign-up was rejected (HTTP 409). No new registration or verification email is confirmed. Check any earlier signup message; do not repeatedly register. This app has no confirmation resend or automatic account repair.');
});

it('L1-14/OA04 signup424 explains official pending-registration uncertainty without suggesting blind retry', () => {
  expect(Reflect.get(app, 'authErrorMessage')({ status: 424, message: 'private-canary' }, 'signup')).toBe('Confirmation delivery failed (HTTP 424). A pending registration may remain on official TrailBase 0.35.9; retrying can return HTTP 409. Do not repeatedly sign up. This app cannot resend confirmation or repair the account.');
});

it('L1-19/OGL02 example declares minimum/no detection and keeps lost-reply/access-JWT caveats without claiming global is always unconfirmed', async () => {
  const source = await readFile('examples/todos/app.js', 'utf8'), html = await readFile('examples/todos/index.html', 'utf8');
  for (const text of [source, html]) {
    expect(text).toContain('official TrailBase 0.35.9 or newer'); expect(text).toContain('does not detect versions');
    expect(text).not.toContain('cannot authenticate server-wide sign-out'); expect(text).not.toContain('global sign-out remains unconfirmed on official');
    expect(text).toContain('lost replies'); expect(text).toContain('access tokens may remain valid until expiry');
  }
});

it('L1-19/E08 explicit global logout uncertainty is retained, never changed into success', () => {
  expect(Reflect.get(app, 'authErrorMessage')({ name: 'AuthGlobalSignOutUnconfirmedError', message: 'private diagnostic' }, 'global')).toBe('Global sign-out could not be authenticated. Local state was cleared, but server-wide revocation remains unconfirmed.');
});

it('L1-14–20/E08 unexpected auth failures never render backend messages, URLs, details or credentials', () => {
  const message = Reflect.get(app, 'authErrorMessage');
  for (const failure of [new TypeError('private-canary'), 'private-canary', null, { name: 'FetchError', message: 'FetchError(401, private-canary, https://private.example.test/?token=private-canary)', details: 'private-canary', hint: 'private-canary' }]) {
    expect(message(failure, 'login')).toBe('Authentication could not be completed. Check your connection and Tailscale, then try again. If it persists, report the operation and HTTP status without sharing credentials.');
  }
  expect(message({ status: 403, message: 'private-canary' }, 'signup')).toBe('Authentication request was rejected (HTTP 403). Check the app requirements and test inbox. If signing up, do not repeatedly register a pending address.');
  for (const status of ['401', 401.5, -1, 0, 600, Infinity, NaN]) expect(message({ status }, 'login')).not.toContain('(HTTP');
});
