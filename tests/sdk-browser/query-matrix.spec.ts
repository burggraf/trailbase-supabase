import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { context, confirmedTrailUser, confirmedSupabaseUser, canonicalUuid, nativeUuid } from '../phase-a/helpers.js';
import { authSnapshot, sessionState } from '../auth-reference/helpers.js';
import { withCleanup, cleanupOwnedRows } from './cleanup.js';
import type { createClient } from '../../src/index.js';

type Kind = 'cap' | 'operators' | 'setters' | 'failures';
type Row = { id: string; user_id: string; title: string; completed: boolean; priority: number; note: string | null; created_at: number };
declare global { interface Window { packedQuery?: { clients: ReturnType<typeof createClient>[]; controls: ReturnType<typeof createClient>[]; anonymous: ReturnType<typeof createClient>[]; calls: { backend: number; url: string; method: string }[]; dispose(): Promise<void> } } }
for (const [label, kind] of [['BQ01 cap and stable inclusive pages', 'cap'], ['BQ02 declared scalar operator matrix', 'operators'], ['BQ03 setter and execution order matrix', 'setters'], ['BQ04 zero-width and rejection semantics', 'failures']] as const) {
  test(`L1-03–05/L1-09–13/E05/E06/E13/S02/S03/S06 ${label}`, async ({ page }) => {
    const env = await context();
    if (env.authVariant !== 'stock' || env.nativeAuthProfile !== 'default' || env.nativeServerProfile !== 'default') throw new Error('BQ requires owned official default fixture');
    const main = new DatabaseSync(resolve(env.directory, 'traildepot/data/main.db'), { readOnly: true }), sessions = new DatabaseSync(resolve(env.directory, 'traildepot/data/session.db'), { readOnly: true });
    const sqlRows = (db: DatabaseSync, table: '_user' | '_session' | 'todos' | 'todo_audit') => { const s = db.prepare(`SELECT * FROM ${table} ORDER BY ${table === '_session' ? 'user,refresh_token' : table === 'todo_audit' ? 'audit_key' : 'id'}`); s.setReadBigInts(true); return s.all(); };
    const original = { users: sqlRows(main, '_user'), sessions: sqlRows(sessions, '_session'), rows: sqlRows(main, 'todos'), audit: sqlRows(main, 'todo_audit') };
    const native: Awaited<ReturnType<typeof confirmedTrailUser>>[] = [], reference: Awaited<ReturnType<typeof confirmedSupabaseUser>>[] = [];
    const prefix = `bq-${randomUUID()}`, count = kind === 'cap' ? 1001 : 8, ids = Array.from({ length: count }, () => randomUUID()), controlId = randomUUID();
    const values = ids.map((id, index) => ({ id, title: `${prefix}-${String(index).padStart(4, '0')}`, completed: index % 2 === 0, priority: Math.floor(index / 2), note: index % 2 ? null : 'kept', created_at: 1780000000 + index }));
    if (kind === 'operators') values[7].title = `${prefix}-é&+%"[],/=?#`;
    const control = { id: controlId, title: `${prefix}-control`, completed: false, priority: 2, note: 'control', created_at: 1780000000 };
    let seedComplete = false;
    const belongs = (id: unknown) => native.some(u => id instanceof Uint8Array && Buffer.from(id).equals(Buffer.from(u.user.id, 'base64url')));
    const errors: string[] = []; page.on('pageerror', () => errors.push('unhandled-browser-error'));
    async function nativePage(table: 'todos' | 'todo_audit', owner: number) {
      const result: Record<string, unknown>[] = [];
      for (const offset of [0, 1000, 2000]) { const r = await native[owner].client.records(table).list({ order: [table === 'todos' ? '+id' : '+audit_key'], pagination: { offset, limit: 1000 } }); result.push(...r.records); if (r.records.length < 1000) return result; }
      throw new Error('BQ fixture page bound exceeded');
    }
    async function referencePage(table: 'todos' | 'todo_audit', owner: number) {
      const result: Record<string, unknown>[] = [];
      for (const offset of [0, 1000, 2000]) { const r = await reference[owner].client.from(table).select('*').order(table === 'todos' ? 'id' : 'audit_key').range(offset, offset + 999); expect(r.error).toBeNull(); result.push(...r.data!); if (r.data!.length < 1000) return result; }
      throw new Error('BQ reference fixture page bound exceeded');
    }
    const snapshot = async () => ({ rows: sqlRows(main, 'todos'), audit: sqlRows(main, 'todo_audit'), users: sqlRows(main, '_user'), sessions: sqlRows(sessions, '_session'), referenceAuth: await authSnapshot(env), referenceRows: await Promise.all([0, 1].map(i => referencePage('todos', i))), referenceAudit: await Promise.all([0, 1].map(i => referencePage('todo_audit', i))) });
    await withCleanup(async () => {
      for (const role of ['a', 'b']) { native.push(await confirmedTrailUser(env, `bq-${role}`)); reference.push(await confirmedSupabaseUser(env, `bq-${role}`)); }
      // Ordinary generated fixture setup only, never SDK bulk writes or a production pagination strategy.
      for (const [owner, rows] of [[0, values], [1, [control]]] as const) for (const row of rows) {
        await native[owner].client.records('todos').create({ ...row, id: nativeUuid(row.id), user_id: native[owner].user.id, completed: row.completed ? 1 : 0 });
        expect((await reference[owner].client.from('todos').insert({ ...row, user_id: reference[owner].user.id })).error).toBeNull();
      }
      seedComplete = true;
      expect(await nativePage('todos', 0)).toHaveLength(count); expect(await referencePage('todos', 0)).toHaveLength(count);
      await page.context().route('**/*', route => env.origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
      await page.goto(`${env.trailUrl}/sdk-data/harness.html`); await page.addScriptTag({ url: `${env.trailUrl}/fixtures/supabase.js` });
      expect(await page.evaluate(async ({ base, referenceUrl, key, accounts }) => {
        const sdk: typeof import('../../src/index.js') = await import(`${base}/sdk-data/sdk.js`);
        const mapping = { tables: { todos: { api: 'todos', primaryKey: 'id', fields: { id: { type: 'uuid' as const }, user_id: { type: 'uuid' as const }, title: { type: 'text' as const }, completed: { type: 'boolean' as const }, priority: { type: 'integer' as const }, note: { type: 'text' as const, nullable: true }, created_at: { type: 'integer' as const } } } } };
        const calls: { backend: number; url: string; method: string }[] = [];
        const clients: ReturnType<typeof sdk.createClient>[] = [], controls: typeof clients = [], anonymous: typeof clients = [];
        for (const backend of [0, 1]) {
          const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false as const }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.pathname === (backend === 0 ? '/api/records/v1/todos' : '/rest/v1/todos')) { if (new Headers(init?.headers).get('prefer')?.includes('count=') || url.searchParams.has('count') || url.searchParams.has('cursor')) throw new Error('BQ unexpected count/cursor request'); calls.push({ backend, url: url.href, method: init?.method ?? 'GET' }); }
            return fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10000)]) });
          } } };
          const make = () => (backend === 0 ? sdk.createClient(base, undefined, { ...options, trailbase: mapping }) : window.supabase.createClient(referenceUrl, key, options)) as ReturnType<typeof sdk.createClient>;
          const a = make(), b = make(); anonymous.push(make());
          for (const [i, client] of [a, b].entries()) { const r = await client.auth.signInWithPassword(accounts[backend][i]); if (r.error || !r.data.user) throw new Error('BQ genuine browser password login failed'); }
          clients.push(a); controls.push(b);
        }
        window.packedQuery = { clients, controls, anonymous, calls, async dispose() { const failures = []; for (const c of [...clients, ...controls]) { const r = await c.auth.signOut({ scope: 'local' }); if (r.error) failures.push('BQ local teardown failed'); } if (failures.length) throw new Error(failures.join(';')); } };
        return true;
      }, { base: env.trailUrl, referenceUrl: env.supabaseUrl, key: env.anonKey, accounts: [native, reference].map(group => group.map(u => ({ email: u.email, password: u.password }))) })).toBe(true);
      const before = await snapshot();
      expect(await page.evaluate(async ({ kind, values, control, owners }) => {
        const state = window.packedQuery!;
        const check = (ok: unknown, label: string) => { if (!ok) throw new Error(`BQ assertion: ${label}`); };
        const stable = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
        for (const backend of [0, 1]) {
          const client = state.clients[backend], table = client.from('todos'), rows = values.map(row => ({ ...row, user_id: owners[backend][0] }));
          const count = () => state.calls.filter(c => c.backend === backend).length;
          const ordered = () => table.select('*').order('priority').order('title');
          const execute = async (query: PromiseLike<{ data: unknown; error: unknown }>, expected: unknown, offset = 0, limit = 1000, order = '+priority,+title') => {
            const previous = count(), result = await query;
            check(!result.error && stable(result.data) === stable(expected), `exact complete ordered page backend=${backend} error=${result.error && typeof result.error === 'object' ? `${Reflect.get(result.error, 'name') ?? ''}/${Reflect.get(result.error, 'status') ?? ''}/${Reflect.get(result.error, 'code') ?? ''}` : 'none'} predicates=${[...new URL(state.calls.filter(c => c.backend === backend).at(-1)!.url).searchParams.keys()].filter(k => k.startsWith('filter[')).join(';')}`);
            check(count() === previous + 1, 'one bounded GET per execution');
            const call = state.calls.filter(c => c.backend === backend).at(-1)!; const url = new URL(call.url);
            check(call.method === 'GET' && Number(url.searchParams.get('limit') ?? (backend === 1 ? 1000 : NaN)) === limit && Number(url.searchParams.get('offset') ?? 0) === offset, 'effective wire method offset and limit');
            if (backend === 0) check(url.searchParams.get('order') === order, 'complete caller ordering on wire');
            if (backend === 0) check(Object.keys(result).sort().join(',') === 'data,error', 'no fabricated count or response fields');
            return result.data;
          };
          const cardinality = async (method: 'single' | 'maybeSingle', offset: number, end: number, expected: unknown, fails: boolean) => {
            const previous = count(), result = await ordered().range(offset, end)[method](); check(count() === previous + 1, 'cardinality one request');
            check(fails ? result.data === null && !!result.error : !result.error && stable(result.data) === stable(expected), 'cardinality after caller bounds');
            if (backend === 0 && fails) check(result.error?.name === 'CardinalityError' && result.error.status === undefined && result.error.code === undefined, 'adapter cardinality has no fabricated backend code');
            const url = new URL(state.calls.filter(c => c.backend === backend).at(-1)!.url); check(Number(url.searchParams.get('limit')) === end - offset + 1, 'cardinality never injects limit one');
          };
          if (kind === 'cap') {
            for (const [offset, end] of [[0, 999], [0, 60], [50, 60], [999, 1000], [1000, 1000], [1001, 1002]]) await execute(ordered().range(offset, end), rows.slice(offset, end + 1), offset, end - offset + 1);
            await execute(ordered(), rows.slice(0, 1000)); await execute(ordered().limit(1000), rows.slice(0, 1000));
            const collected: unknown[] = []; for (const [offset, end] of [[0, 499], [500, 999], [1000, 1000]]) { const expected = rows.slice(offset, end + 1); const actual = await execute(ordered().range(offset, end), expected, offset, end - offset + 1); collected.push(...actual as unknown[]); }
            check(stable(collected) === stable(rows) && new Set(rows.map(r => r.id)).size === 1001, 'stable complete pages without gaps or duplicates');
            for (const method of ['single', 'maybeSingle'] as const) { await cardinality(method, 0, 999, null, true); await cardinality(method, 999, 1000, null, true); await cardinality(method, 1000, 1000, rows[1000], false); await cardinality(method, 1001, 1002, null, method === 'single'); await execute(ordered().limit(1)[method](), rows[0], 0, 1); }
          } else if (kind === 'operators') {
            const methods = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
            const compare = (op: typeof methods[number], a: string | number | boolean, b: typeof a) => op === 'eq' ? a === b : op === 'neq' ? a !== b : op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
            // ASCII-only subset for relational text comparison; Unicode is literal equality only.
            const domain = rows.filter(r => r.priority < 3);
            for (const [field, pivot] of [['priority', 1], ['completed', true], ['id', domain.map(r => r.id).sort()[2]], ['title', rows[2].title]] as const) for (const op of methods) {
              const value = field === 'completed' ? !['gt', 'lte'].includes(op) : pivot;
              const expected = domain.filter(row => compare(op, row[field], value));
              check(expected.length > 0 && expected.length < domain.length, 'operator matching and nonmatching controls');
              await execute(ordered().lt('priority', 3)[op](field, value), expected);
              await execute(ordered().lt('priority', 3)[op](field, value).gt('priority', 99), []);
            }
            await execute(ordered().gt('priority', 0).gte('priority', 1).lt('priority', 3).lte('priority', 2).neq('completed', false), rows.filter(r => r.priority >= 1 && r.priority <= 2 && r.completed));
            await execute(ordered().neq('note', 'absent'), rows.filter(r => r.note !== null));
            await execute(ordered().lt('priority', 3).gt('priority', 1).gt('priority', 99).limit(0), [], 0, 0);
            await execute(ordered().eq('title', rows[7].title).eq('title', rows[7].title), [rows[7]]);
            await execute(ordered().eq('title', rows[7].title).eq('title', rows[0].title), []);
            await execute(ordered().eq('title', rows[7].title), [rows[7]]);
            if (backend === 0) check(new URL(state.calls.filter(c => c.backend === backend).at(-1)!.url).searchParams.get('filter[title][$eq]') === rows[7].title, 'reserved Unicode value remains literal');
          } else if (kind === 'setters') {
            const start = count(), lazy = ordered().range(2, 5).limit(2); check(count() === start, 'construction is lazy');
            await execute(lazy, rows.slice(2, 4), 2, 2); await execute(lazy.limit(3), rows.slice(2, 5), 2, 3); await execute(lazy.range(1, 1), rows.slice(1, 2), 1, 1); await execute(ordered(), rows);
            await execute(ordered().limit(1).limit(3), rows.slice(0, 3), 0, 3); await execute(ordered().range(1, 4).range(3, 4), rows.slice(3, 5), 3, 2); await execute(ordered().limit(1).range(1, 3), rows.slice(1, 4), 1, 3); await execute(ordered().range(1, 3).limit(1), rows.slice(1, 2), 1, 1);
            const descending = [...rows].sort((a, b) => b.priority - a.priority || (a.title < b.title ? -1 : 1));
            await execute(table.select().range(1, 3).order('priority', { ascending: false }).order('title'), descending.slice(1, 4), 1, 3, '-priority,+title'); await execute(table.select().order('priority', { ascending: false }).order('title').range(1, 3), descending.slice(1, 4), 1, 3, '-priority,+title');
            for (const ascending of [true, false]) { await execute(table.select().order('priority', { ascending }).order('priority', { ascending: !ascending }).order('title'), ascending ? rows : descending, 0, 1000, `${ascending ? '+' : '-'}priority,${ascending ? '-' : '+'}priority,+title`); if (backend === 0) check(new URL(state.calls.filter(c => c.backend === backend).at(-1)!.url).searchParams.get('order') === `${ascending ? '+' : '-'}priority,${ascending ? '-' : '+'}priority,+title`, 'caller ordering preserved on wire'); }
          } else {
            await execute(ordered().eq('priority', 0).limit(0), [], 0, 0);
            const previous = count(), denied = await state.anonymous[backend].from('todos').select('*').limit(0); check(denied.data === null && !!denied.error && count() === previous + 1, 'zero-limit permission denial is not empty success');
            const zero = ordered().range(1, 3).limit(0), before = count(), bad = await zero; check(bad.data === null && !!bad.error, 'positive-offset zero limit returns error');
            if (backend === 0) check(count() === before && bad.error?.name === 'RangeError' && bad.error.status === undefined && bad.error.code === undefined, 'adapter zero-width failure has zero wire and no invented backend status');
            else check(count() === before + 1 && Reflect.get(bad, 'status') === 416 && bad.error?.code === 'PGRST103', 'actual reference range failure preserved');
            await execute(zero.limit(2), rows.slice(1, 3), 1, 2); await execute(ordered().limit(0).range(1, 3), rows.slice(1, 4), 1, 3); await execute(ordered().range(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), [], Number.MAX_SAFE_INTEGER, 1);
            if (backend === 0) {
              const q = ordered(), start = count();
              const rejected = (action: () => unknown) => { let error: unknown; try { action(); } catch (e) { error = e; } check(error instanceof Error, 'unsupported invalid builder throws'); };
              for (const n of [-1, 0.5, NaN, Infinity, 1001, Number.MAX_SAFE_INTEGER + 1]) rejected(() => q.limit(n));
              for (const [a, b] of [[-1, 1], [2, 1], [0, 1000], [0, Number.MAX_SAFE_INTEGER], [NaN, 1], [0, Infinity], [0.5, 1]]) rejected(() => q.range(a, b));
              for (const action of [() => Reflect.apply(table.select, table, ['id']), () => Reflect.apply(table.select, table, ['*', { count: 'exact' }]), () => Reflect.apply(table.select, table, ['*', { head: true }]), () => q.order('note'), () => q.order('typo'), () => Reflect.apply(q.order, q, ['title', { nullsFirst: true }]), () => Reflect.apply(q.order, q, ['title', { referencedTable: 'links' }]), () => Reflect.apply(q.limit, q, [1, { foreignTable: 'links' }]), () => Reflect.apply(q.range, q, [0, 1, { referencedTable: 'links' }]), () => q.eq('note', null), () => q.eq('priority', NaN), () => q.eq('id', 'bad'), () => q.eq('typo', 'x')]) rejected(action);
              for (const method of ['like', 'ilike', 'in', 'is', 'or']) check(typeof Reflect.get(q, method) === 'undefined', 'deferred operator absent');
              check(count() === start, 'all invalid builders dispatch zero data');
            }
          }
          await execute(state.controls[backend].from('todos').select('*').order('priority').order('title'), [{ ...control, user_id: owners[backend][1] }]);
          await execute(state.controls[backend].from('todos').select('*').eq('id', rows[0].id).order('priority').order('title'), []);
        }
        return { completeRows: true, boundedRequests: true, noCountEmulation: true, ownerIsolation: true };
      }, { kind: kind as Kind, values, control, owners: [native.map(u => canonicalUuid(u.user.id)), reference.map(u => u.user.id)] })).toEqual({ completeRows: true, boundedRequests: true, noCountEmulation: true, ownerIsolation: true });
      expect(await snapshot()).toEqual(before);
    }, [
      async () => { if (!page.isClosed()) { try { await page.evaluate(async () => { await window.packedQuery?.dispose(); delete window.packedQuery; }); } finally { await page.close(); } } },
      ...[0, 1].map(owner => async () => { if (!native[owner]) return; const u = native[owner]; await u.client.login(u.email, u.password); await cleanupOwnedRows(u.client.records('todos'), u.user.id, (owner ? [controlId] : ids).map(nativeUuid)); const response = await fetch(`${env.trailUrl}/api/auth/v1/logout`, { headers: { authorization: `Bearer ${u.client.tokens()!.auth_token}` }, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(10000) }); await response.body?.cancel(); expect(response.status).toBe(303); }),
      ...[0, 1].map(owner => async () => { if (!reference[owner]) return; const u = reference[owner]; expect((await u.client.auth.signInWithPassword({ email: u.email, password: u.password })).error).toBeNull(); for (const id of owner ? [controlId] : ids) expect((await u.client.from('todos').delete().eq('id', id).eq('user_id', u.user.id)).error).toBeNull(); expect(await referencePage('todos', owner)).toEqual([]); const audit = await referencePage('todo_audit', owner), inserted = audit.filter(r => r.operation === 'INSERT').map(r => r.todo_id).sort(), deleted = audit.filter(r => r.operation === 'DELETE').map(r => r.todo_id).sort(); expect(deleted).toEqual(inserted); expect(audit).toHaveLength(inserted.length * 2); if (seedComplete) expect(inserted).toEqual((owner ? [controlId] : ids).slice().sort()); expect((await u.client.auth.signOut({ scope: 'global' })).error).toBeNull(); const state = await sessionState(env, u.email); expect(state.sessions).toBe(0); expect(state.activeRefreshTokens).toBe(0); }),
      async () => {
        expect(sqlRows(main, 'todos')).toEqual(original.rows);
      },
      async () => { expect(sqlRows(sessions, '_session').filter(r => belongs(r.user))).toEqual([]); expect(sqlRows(sessions, '_session').filter(r => !belongs(r.user))).toEqual(original.sessions); expect(sqlRows(main, '_user').filter(r => !belongs(r.id))).toEqual(original.users); expect(sqlRows(main, 'todo_audit').filter(r => !belongs(r.user_id))).toEqual(original.audit); for (const owner of [0, 1]) if (native[owner]) { const audit = await nativePage('todo_audit', owner), inserted = audit.filter(r => r.operation === 'INSERT').map(r => r.todo_id).sort(), deleted = audit.filter(r => r.operation === 'DELETE').map(r => r.todo_id).sort(); expect(deleted).toEqual(inserted); expect(audit).toHaveLength(inserted.length * 2); if (seedComplete) expect(inserted).toEqual((owner ? [controlId] : ids).map(nativeUuid).sort()); } expect(errors).toEqual([]); },
      async () => { main.close(); sessions.close(); },
      async () => { await page.context().unrouteAll({ behavior: 'wait' }); },
    ]);
  });
}
