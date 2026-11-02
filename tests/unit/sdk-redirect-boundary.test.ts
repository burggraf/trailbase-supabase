import { expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createClient } from '../../src/index.js';

const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const } } } } };
const credentials = { email: 'synthetic@example.test', password: 'SYNTHETIC_PASSWORD_ONLY' };
function tokens() {
  const now = Math.floor(Date.now() / 1000), encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  // Unsigned synthetic material: only these two ephemeral test servers ever receive it.
  return { auth_token: `${encode({ alg: 'EdDSA' })}.${encode({ sub: Buffer.from('12345678123442348234123456789abc', 'hex').toString('base64url'), email: null, iat: now, exp: now + 600 })}.synthetic`, refresh_token: 'SYNTHETIC_REFRESH_ONLY', csrf_token: 'SYNTHETIC_CSRF_ONLY' };
}
const headersPresent = (request: IncomingMessage) => ({ authorization: Boolean(request.headers.authorization), refresh: Boolean(request.headers['refresh-token']), csrf: Boolean(request.headers['csrf-token']), cookie: Boolean(request.headers.cookie) });
async function listen(server: Server) {
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Owned listener missing');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  if (server.listening) { server.closeAllConnections(); await new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes())); }
  expect(server.listening).toBe(false);
}
async function withOrigins(run: (fixture: { base: string; redirect: (path: string) => void; received: ReturnType<typeof headersPresent>[]; source: { path: string; method: string; headers: ReturnType<typeof headersPresent> }[] }) => Promise<void>) {
  const received: ReturnType<typeof headersPresent>[] = [], source: { path: string; method: string; headers: ReturnType<typeof headersPresent> }[] = [];
  let redirectPath = '', sinkUrl = '';
  const sink = createServer((req, res) => { received.push(headersPresent(req)); req.resume(); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(tokens())); });
  const server = createServer((req, res) => {
    req.resume(); const path = new URL(req.url!, 'http://owned.invalid').pathname;
    source.push({ path, method: req.method!, headers: headersPresent(req) });
    if (path === redirectPath) { res.writeHead(req.method === 'POST' ? 307 : 303, { location: `${sinkUrl}/landed` }); res.end(); }
    else { res.setHeader('content-type', 'application/json'); res.end(path === '/api/auth/v1/login' ? JSON.stringify(tokens()) : '{}'); }
  });
  try { sinkUrl = await listen(sink); const base = await listen(server); await run({ base, redirect: path => { redirectPath = path; }, received, source }); }
  finally { await Promise.all([close(server), close(sink)]); }
}

for (const action of ['register', 'login', 'status', 'refresh', 'local-logout', 'global-logout', 'data-read', 'data-write'] as const) {
  it(`L1-14/L1-19/L1-24/S01/S07 actual SDK ${action} refuses a foreign redirect and preserves fail-closed state`, async () => {
    await withOrigins(async fixture => {
      const values = new Map<string, string>([['unrelated', 'keep']]), events: string[] = [];
      const client = createClient(fixture.base, undefined, { trailbase: mapping, auth: { persistSession: true, autoRefreshToken: false, storageKey: 'owned', storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } } } });
      const subscription = client.auth.onAuthStateChange(event => { events.push(event); }).data.subscription;
      try {
        const login = await client.auth.signInWithPassword(credentials); expect(login.error).toBeNull();
        const actualAccessToken = login.data.session!.access_token;
        const before = values.get('owned'); expect(before).toBeDefined();
        const path = ['register', 'login', 'status', 'refresh'].includes(action) ? `/api/auth/v1/${action}` : action.endsWith('logout') ? '/api/auth/v1/logout' : '/api/records/v1/todos';
        fixture.redirect(path); const start = fixture.source.length;
        const result = action === 'register' ? await client.auth.signUp(credentials) : action === 'login' ? await client.auth.signInWithPassword(credentials) : action === 'status' ? await client.auth.getUser() : action === 'refresh' ? await client.auth.refreshSession() : action === 'local-logout' || action === 'global-logout' ? await client.auth.signOut({ scope: action === 'local-logout' ? 'local' : 'global' }) : action === 'data-read' ? await client.from('todos').select('*') : await client.from('todos').insert({ id: '12345678-1234-4234-8234-123456789abc' });
        expect(fixture.received).toEqual([]);
        expect(result.error).not.toBeNull();
        expect(fixture.source.slice(start)).toEqual([{ path, method: action === 'status' || action === 'global-logout' || action === 'data-read' ? 'GET' : 'POST', headers: { authorization: ['status', 'global-logout', 'data-read', 'data-write'].includes(action), refresh: action === 'status', csrf: false, cookie: false } }]);
        for (const secret of [credentials.password, actualAccessToken, tokens().refresh_token, tokens().csrf_token]) expect(JSON.stringify(result)).not.toContain(secret);
        if ('data' in result) expect(Object.values(result.data ?? {}).every(value => value === null)).toBe(true);
        if (action.endsWith('logout')) {
          expect(result.error?.name).toBe(action === 'local-logout' ? 'AuthSignOutRequestError' : 'AuthGlobalSignOutUnconfirmedError');
          expect(values.has('owned')).toBe(false); expect((await client.auth.getSession()).data.session).toBeNull();
          expect(events.filter(event => event === 'SIGNED_OUT')).toHaveLength(1);
          const count = fixture.source.length; expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull(); expect(fixture.source).toHaveLength(count);
        } else {
          expect(values.get('owned')).toBe(before); expect((await client.auth.getSession()).data.session?.refresh_token).toBe(tokens().refresh_token);
          expect(events.filter(event => event === 'SIGNED_IN')).toHaveLength(1); expect(events).not.toContain('TOKEN_REFRESHED');
        }
        expect(values.get('unrelated')).toBe('keep');
      } finally { fixture.redirect(''); subscription.unsubscribe(); await client.auth.signOut({ scope: 'local' }); }
    });
  });
}

it('L1-24/S07 raw Fetch follow control forwards synthetic custom headers; NOT an SDK defect or live-session leak', async () => {
  await withOrigins(async fixture => {
    fixture.redirect('/raw');
    const response = await fetch(`${fixture.base}/raw`, { credentials: 'omit', redirect: 'follow', headers: { authorization: 'Bearer SYNTHETIC_ONLY', 'Refresh-Token': 'SYNTHETIC_ONLY', 'CSRF-Token': 'SYNTHETIC_ONLY' } });
    await response.body?.cancel();
    expect(fixture.received).toEqual([{ authorization: false, refresh: true, csrf: true, cookie: false }]);
  });
});
