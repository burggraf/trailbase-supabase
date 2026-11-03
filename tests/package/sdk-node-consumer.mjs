import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from 'trailbase-supabase';

const config = JSON.parse(await readFile('node-context-private.json', 'utf8'));
const directory = await realpath('.');
assert.match(config.id, /^\d{13}-[a-f0-9]{12}$/);
for (const origin of [config.trailUrl, config.mailUrl]) {
  const u = new URL(origin); assert.equal(u.origin, origin); assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.protocol, 'http:'); assert(u.port);
}
assert.equal(fileURLToPath(import.meta.resolve('trailbase-supabase')), resolve(directory, 'node_modules/trailbase-supabase/dist/index.js'));
assert.equal(await realpath(fileURLToPath(import.meta.resolve('trailbase-supabase'))), fileURLToPath(import.meta.resolve('trailbase-supabase')));
const wire = async (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(10000), credentials: 'omit', redirect: 'manual' });
const marker = await wire(`${config.trailUrl}/phase-a-owner.txt`); assert.equal(marker.status, 200); assert.equal(await marker.text(), config.id);
const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' }, user_id: { type: 'uuid' }, title: { type: 'text' }, completed: { type: 'boolean' }, priority: { type: 'integer' }, note: { type: 'text', nullable: true }, created_at: { type: 'integer' } } } } };
const storagePath = resolve(directory, 'sessions-private.json'), key = 'packed-owner-a';
const stored = () => JSON.parse(readFileSync(storagePath, 'utf8'));
const storage = {
  async getItem(k) { return stored()[k] ?? null; },
  async setItem(k, v) { const data = stored(); data[k] = v; await writeFile(storagePath, JSON.stringify(data), { mode: 0o600 }); },
  async removeItem(k) { const data = stored(); delete data[k]; await writeFile(storagePath, JSON.stringify(data), { mode: 0o600 }); },
};
const counts = { register: 0, refresh: 0, records: 0, local: 0, global: 0 };
let abortLocal = false;
const transport = async (input, init) => {
  const url = new URL(input); assert.equal(url.origin, config.trailUrl); assert.equal(init.credentials, 'omit');
  const path = url.pathname;
  if (path.endsWith('/register')) counts.register++;
  if (path.endsWith('/refresh')) counts.refresh++;
  if (path.startsWith('/api/records/')) { counts.records++; assert.equal(init.redirect, 'error'); assert(!new Headers(init.headers).has('refresh-token')); }
  if (path.endsWith('/logout')) {
    if (init.method === 'POST') { counts.local++; if (abortLocal) return fetch(input, { ...init, signal: AbortSignal.abort() }); }
    else { counts.global++; assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual'); assert.equal(new Headers(init.headers).get('content-type'), 'application/json'); assert.deepEqual([...new Headers(init.headers).keys()], ['authorization', 'content-type']); assert.equal(init.body, undefined); }
  }
  return fetch(input, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
};
const clients = [];
const make = (auth = {}) => {
  const client = createClient(config.trailUrl, undefined, { trailbase: mapping, auth: { persistSession: false, autoRefreshToken: false, ...auth }, global: { fetch: transport } });
  clients.push(client); return client;
};
const ok = result => { assert.equal(result.error, null); return result.data; };
const session = result => { const data = ok(result); assert(data.session); return data.session; };
async function rawRefresh(token) {
  const r = await wire(`${config.trailUrl}/api/auth/v1/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: token }) });
  const status = r.status; await r.body?.cancel(); return status;
}
async function rawLocal(tokens, bearer = tokens.access_token) {
  const r = await wire(`${config.trailUrl}/api/auth/v1/logout`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ refresh_token: tokens.refresh_token }) });
  assert.equal(r.status, 200); await r.body?.cancel();
}
async function confirm(email) {
  const end = Date.now() + 30000; let link;
  while (Date.now() < end && !link) {
    const r = await wire(`${config.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`); assert.equal(r.status, 200);
    const inbox = await r.json();
    if (inbox.messages?.length) {
      const message = await wire(`${config.mailUrl}/api/v1/message/${encodeURIComponent(inbox.messages[0].ID)}`); assert.equal(message.status, 200);
      const body = await message.json(); const urls = `${body.HTML ?? ''}\n${body.Text ?? ''}`.replaceAll('&amp;', '&').match(/https?:\/\/[^\s<>"']+/g) ?? [];
      link = urls.find(url => new URL(url).pathname.includes('verify')); assert(link);
    } else await new Promise(yes => setTimeout(yes, 100));
  }
  assert(link, 'Genuine confirmation mail deadline');
  for (let i = 0; i < 5; i++) {
    assert.equal(new URL(link).origin, config.trailUrl);
    const r = await wire(link);
    const location = r.headers.get('location'); await r.body?.cancel();
    if (r.status >= 300 && r.status < 400) { assert(location); link = new URL(location, link).href; }
    else { assert.equal(r.status, 200); return; }
  }
  throw new Error('Owned confirmation redirect limit');
}

if (process.argv[2] === '--reload') {
  const expected = JSON.parse(await readFile('reload-owner-private.json', 'utf8'));
  const reloaded = make({ persistSession: true, storage, storageKey: key });
  assert.equal(session(await reloaded.auth.getSession()).user.id, expected.id);
  assert.equal(ok(await reloaded.from('todos').select().eq('id', expected.row).single()).user_id, expected.id);
  assert.equal(ok(await reloaded.auth.getUser()).user.id, expected.id);
  assert.equal(stored().unrelated, 'keep');
  await writeFile('reload-result-private.json', JSON.stringify({ node: process.version, persistedOwnerAndRow: true, liveUser: true }), { mode: 0o600 });
} else {
  const proof = { node: process.version, tests: Array.from({ length: 8 }, (_, i) => ({ id: `PN0${i + 1}`, status: 'not-executed' })), owners: [], rowIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()] };
  const credentials = [0, 1].map(() => ({ email: `packed-node-${randomUUID()}@example.test`, password: `Fixture-${randomUUID()}-Aa1!` }));
  const [targetId, controlId, otherId, spoofId] = proof.rowIds;
  const a = make({ persistSession: true, storageKey: key, storage }), b = make(), sibling = make(), failedLocal = make();
  const captured = [], subscriptions = [], callbackErrors = [], events = [], goldenRows = new Map();
  let active = 0, primary;
  const pass = index => { proof.tests[index].status = 'passed'; active = index + 1; };
  const login = async (client, index) => { const value = session(await client.auth.signInWithPassword(credentials[index])); assert.equal(value.expires_in, 3); captured.push(value); return value; };
  try {
    await writeFile(storagePath, JSON.stringify({ unrelated: 'keep' }), { mode: 0o600 });
    assert.deepEqual(Object.keys(await import('trailbase-supabase')).sort(), ['createClient']);
    pass(0);
    for (const [index, client] of [a, b].entries()) {
      assert.deepEqual(ok(await client.auth.signUp(credentials[index])), { user: null, session: null });
      assert.equal(ok(await client.auth.getSession()).session, null);
      const denied = await client.auth.signInWithPassword(credentials[index]); assert(denied.error); assert.deepEqual(denied.data, { user: null, session: null });
      if (!index) { const before = counts.register; const duplicate = await client.auth.signUp(credentials[index]); assert.equal(duplicate.error?.status, 409); assert.deepEqual(duplicate.data, { user: null, session: null }); assert.equal(counts.register - before, 1); }
      await confirm(credentials[index].email);
      const current = await login(client, index); proof.owners.push({ id: current.user.id, email: credentials[index].email });
    }
    const beforeWrong = session(await a.auth.getSession());
    assert((await a.auth.signInWithPassword({ ...credentials[0], password: 'Incorrect-password' })).error);
    assert.deepEqual(session(await a.auth.getSession()), beforeWrong);
    assert.equal(ok(await make().auth.getSession()).session, null);
    pass(1);
    const owner = proof.owners[0].id, other = proof.owners[1].id;
    ok(await a.from('todos').insert({ id: targetId, user_id: owner, title: `literal &+%[]/ ${targetId}`, priority: 2 }));
    ok(await a.from('todos').insert({ id: controlId, user_id: owner, title: `control-${controlId}`, priority: 7 }));
    ok(await b.from('todos').insert({ id: otherId, user_id: other, title: `other-${otherId}`, priority: 9 }));
    await writeFile('reload-owner-private.json', JSON.stringify({ id: owner, row: targetId }), { mode: 0o600 });
    await promisify(execFile)(process.execPath, ['consumer.mjs', '--reload'], { cwd: directory, timeout: 30000, maxBuffer: 1_000_000 });
    assert.deepEqual(JSON.parse(await readFile('reload-result-private.json', 'utf8')), { node: process.version, persistedOwnerAndRow: true, liveUser: true });
    assert.equal(ok(await a.auth.getUser()).user.id, owner); assert.equal(stored().unrelated, 'keep');
    subscriptions.push(a.auth.onAuthStateChange((event, value) => {
      events.push(event);
      try { const disk = stored(); assert.equal(disk.unrelated, 'keep'); if (value) assert.equal(JSON.parse(disk[key]).tokens.auth_token, value.access_token); else if (event === 'SIGNED_OUT') assert.equal(value, null); }
      catch (error) { callbackErrors.push(error); }
    }).data.subscription);
    pass(2);
    const golden = ok(await a.from('todos').select().eq('id', targetId).single());
    assert.equal(golden.completed, false); assert.equal(golden.note, null); assert(Number.isSafeInteger(golden.created_at)); assert.equal(golden.user_id, owner);
    ok(await a.from('todos').update({ priority: 4, completed: true, note: 'updated' }).eq('id', targetId));
    assert.equal(ok(await a.from('todos').select().eq('id', targetId).single()).completed, true);
    for (const [op, value, ids] of [['eq', 4, [targetId]], ['neq', 4, [controlId]], ['gt', 4, [controlId]], ['gte', 4, [targetId, controlId]], ['lt', 7, [targetId]], ['lte', 7, [targetId, controlId]]]) assert.deepEqual(ok(await a.from('todos').select()[op]('priority', value).order('priority').order('id')).map(r => r.id), ids);
    assert.deepEqual(ok(await a.from('todos').select().order('priority').range(1, 1)).map(r => r.id), [controlId]);
    assert.equal((await a.from('todos').select().single()).error?.name, 'CardinalityError'); assert.equal(ok(await a.from('todos').select().eq('id', randomUUID()).maybeSingle()), null);
    const beforeRows = [ok(await a.from('todos').select().order('id')), ok(await b.from('todos').select().order('id'))];
    goldenRows.set(controlId, beforeRows[0].find(r => r.id === controlId)); goldenRows.set(otherId, beforeRows[1].find(r => r.id === otherId));
    assert.deepEqual(ok(await b.from('todos').select().eq('id', targetId)), []);
    assert((await make().from('todos').select()).error);
    assert.equal((await b.from('todos').update({ title: 'forbidden' }).eq('id', targetId)).error?.status, 403);
    assert.equal((await b.from('todos').delete().eq('id', targetId)).error?.status, 403);
    assert.equal((await b.from('todos').insert({ id: spoofId, user_id: owner, title: 'spoof' })).error?.status, 403);
    const before = counts.records;
    assert((await a.from('todos').update({ title: 'unbounded' })).error);
    assert((await a.from('todos').select().range(1, 2).limit(0)).error);
    assert.throws(() => a.from('todos').insert([])); assert.equal(counts.records, before);
    assert.deepEqual([ok(await a.from('todos').select().order('id')), ok(await b.from('todos').select().order('id'))], beforeRows);
    ok(await a.from('todos').delete().eq('id', targetId)); assert.deepEqual(ok(await a.from('todos').select().eq('id', targetId)), []);
    pass(3);
    const original = session(await a.auth.refreshSession());
    const oldDisk = stored()[key], refreshBefore = counts.refresh;
    // Actual server expiry including native JWT leeway; no fake clock, token or row edits.
    await new Promise(yes => setTimeout(yes, Math.max(0, (original.expires_at + 61) * 1000 - Date.now())));
    const expired = await wire(`${config.trailUrl}/api/records/v1/todos`, { headers: { authorization: `Bearer ${original.access_token}` } }); assert.equal(expired.status, 403); await expired.body?.cancel(); assert.equal(counts.refresh, refreshBefore);
    const renewed = await Promise.all([a.auth.getSession(), a.auth.refreshSession(), Promise.resolve(a.from('todos').select().eq('id', controlId).single())]);
    assert.equal(counts.refresh - refreshBefore, 1); assert.equal(session(renewed[0]).refresh_token, original.refresh_token); assert.notEqual(session(renewed[0]).access_token, original.access_token); ok(renewed[1]); assert.equal(ok(renewed[2]).user_id, owner); assert.notEqual(stored()[key], oldDisk);
    assert.equal(await rawRefresh(session(await b.auth.getSession()).refresh_token), 200);
    pass(4);
    let backgroundEvent; const observed = new Promise(yes => { backgroundEvent = yes; }); let storageCalls = 0;
    const background = make({ persistSession: false, autoRefreshToken: true, storage: { getItem() { storageCalls++; throw Error('Disabled storage'); }, setItem() { storageCalls++; throw Error('Disabled storage'); }, removeItem() { storageCalls++; throw Error('Disabled storage'); } } });
    subscriptions.push(background.auth.onAuthStateChange(event => { if (event === 'TOKEN_REFRESHED') backgroundEvent(); }).data.subscription);
    const backgroundSession = await login(background, 1); let timer;
    try { await Promise.race([observed, new Promise((_, no) => { timer = setTimeout(() => no(Error('Genuine background renewal deadline')), 10000); })]); }
    finally { clearTimeout(timer); }
    ok(await background.auth.signOut({ scope: 'local' })); assert.equal(await rawRefresh(backgroundSession.refresh_token), 401); assert.equal(storageCalls, 0);
    pass(5);
    const first = session(await a.auth.getSession()), second = await login(sibling, 0);
    ok(await a.auth.signOut({ scope: 'local' })); assert.equal(ok(await a.auth.getSession()).session, null); assert(!Object.hasOwn(stored(), key)); assert.equal(await rawRefresh(first.refresh_token), 401); assert.equal(await rawRefresh(second.refresh_token), 200);
    const lost = await login(failedLocal, 0); abortLocal = true;
    try { assert((await failedLocal.auth.signOut({ scope: 'local' })).error); }
    finally { abortLocal = false; }
    assert.equal(ok(await failedLocal.auth.getSession()).session, null); assert.equal(await rawRefresh(lost.refresh_token), 200); await rawLocal(lost); assert.equal(await rawRefresh(lost.refresh_token), 401);
    const globalSession = await login(a, 0), globalBefore = counts.global, localBefore = counts.local;
    const global = await a.auth.signOut(); assert.equal(global.error, null); assert.equal(counts.global - globalBefore, 1); assert.equal(counts.local, localBefore); assert.equal(ok(await a.auth.getSession()).session, null); assert(!Object.hasOwn(stored(), key));
    assert.equal(await rawRefresh(globalSession.refresh_token), 401); assert.equal(await rawRefresh(second.refresh_token), 401); assert.equal(await rawRefresh(session(await b.auth.getSession()).refresh_token), 200);
    assert.deepEqual(ok(await b.from('todos').select().order('id')), [goldenRows.get(otherId)]);
    const residual = await wire(`${config.trailUrl}/api/records/v1/todos?skip_cursor=true`, { headers: { authorization: `Bearer ${globalSession.access_token}` } }); assert.equal(residual.status, 200); await residual.body?.cancel();
    assert.equal((await sibling.auth.refreshSession()).error?.status, 401); assert.equal(ok(await sibling.auth.getSession()).session, null);
    assert.equal(stored().unrelated, 'keep'); assert.deepEqual(callbackErrors, []); assert(events.includes('INITIAL_SESSION')); assert(events.includes('TOKEN_REFRESHED')); assert(events.includes('SIGNED_IN')); assert.equal(events.filter(e => e === 'SIGNED_OUT').length, 2);
    pass(6);
  } catch (error) { primary = error; if (active < 8) proof.tests[active].status = 'failed'; }
  finally {
    const errors = [];
    for (const subscription of subscriptions) subscription.unsubscribe();
    // New ordinary credentials, never a revoked/expired cache or SQL identity/session repair.
    for (let index = 0; index < proof.owners.length; index++) {
      const fresh = make();
      try {
        const cleanupSession = await login(fresh, index);
        const ids = index ? [otherId] : [targetId, controlId, spoofId];
        for (const id of ids) { const rows = ok(await fresh.from('todos').select().eq('id', id)); if (!primary && goldenRows.has(id)) assert.deepEqual(rows, [goldenRows.get(id)]); if (rows.length) ok(await fresh.from('todos').delete().eq('id', id)); assert.deepEqual(ok(await fresh.from('todos').select().eq('id', id)), []); }
        for (const tokens of captured.filter(t => t.user.id === cleanupSession.user.id)) { await rawLocal(tokens, cleanupSession.access_token); assert.equal(await rawRefresh(tokens.refresh_token), 401); }
        ok(await fresh.auth.signOut({ scope: 'local' }));
      } catch (error) { errors.push(error); }
    }
    for (const client of clients) { try { ok(await client.auth.signOut({ scope: 'local' })); } catch (error) { errors.push(error); } }
    try { await storage.removeItem(key); assert.deepEqual(stored(), { unrelated: 'keep' }); } catch (error) { errors.push(error); }
    if (errors.length) { if (!primary) proof.tests[7].status = 'failed'; primary = new AggregateError([...(primary ? [primary] : []), ...errors], 'Consumer primary/cleanup failures'); }
    if (!primary) pass(7);
    await writeFile('node-result-private.json', JSON.stringify(proof), { mode: 0o600 });
  }
  if (primary) throw primary;
}
