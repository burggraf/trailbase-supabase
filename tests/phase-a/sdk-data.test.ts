import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type TrailBaseMapping } from '../../src/index.js';
import { canonicalUuid, confirmedSupabaseUser, confirmedTrailUser, context, nativeUuid, supabase, type Context } from './helpers.js';

const fields = { id: { type: 'uuid' }, user_id: { type: 'uuid' }, title: { type: 'text' }, completed: { type: 'boolean' }, priority: { type: 'integer' }, note: { type: 'text', nullable: true }, created_at: { type: 'integer' } } as const;
const mapping = { tables: {
  todos: { api: 'todos', primaryKey: 'id', fields },
  todos_read: { api: 'todos_read', primaryKey: 'id', fields, readOnly: true },
  integer_todos: { api: 'integer_todos', primaryKey: 'todo_key', fields: { todo_key: { type: 'integer' }, user_id: { type: 'uuid' }, title: { type: 'text' } } },
} } satisfies TrailBaseMapping;
let env: Context;
let a: Awaited<ReturnType<typeof confirmedTrailUser>>, b: typeof a;
let sa: Awaited<ReturnType<typeof confirmedSupabaseUser>>, sb: typeof sa;
let requests: { method: string; path: string }[];
function adapter(headers: Record<string, string> = {}) {
  return createClient(env.trailUrl, undefined, { trailbase: mapping, global: { fetch: (input, init) => {
    const url = new URL(String(input));
    requests.push({ method: init?.method ?? 'GET', path: url.pathname });
    return fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...headers } });
  } } });
}
beforeAll(async () => {
  env = await context();
  a = await confirmedTrailUser(env, 'sdk-a'); b = await confirmedTrailUser(env, 'sdk-b');
  sa = await confirmedSupabaseUser(env, 'sdk-a'); sb = await confirmedSupabaseUser(env, 'sdk-b');
  requests = [];
});
function commonClients(native: ReturnType<typeof adapter>) {
  return [
    [{ from: (name: string) => native.from(name) }, canonicalUuid(a.user.id)],
    [{ from: (name: string) => sa.client.from(name) }, sa.user.id],
  ] as const;
}
async function snapshot() {
  const result = [];
  for (const [native, reference] of [[a, sa], [b, sb]] as const) {
    for (const table of ['todos', 'todo_audit'] as const) {
      const key = table === 'todos' ? 'id' : 'audit_key';
      const rows = (await native.client.records(table).list({ pagination: { limit: 1000 }, order: [`+${key}`] })).records;
      const expected = await reference.client.from(table).select('*').order(key).limit(1000);
      expect(expected.error).toBeNull(); result.push(rows, expected.data);
    }
  }
  return result;
}
async function cleanup(ids: string[]) {
  for (const id of ids) {
    // Exact generated owned keys only; direct fixture clients keep cleanup independent of adapter success.
    const rows = (await a.client.records('todos').list({ filters: [{ column: 'id', value: nativeUuid(id) }], pagination: { limit: 1 } })).records;
    if (rows.length) await a.client.records('todos').delete(nativeUuid(id));
    expect((await sa.client.from('todos').delete().eq('id', id)).error).toBeNull();
  }
  for (const id of ids) {
    expect((await a.client.records('todos').list({ filters: [{ column: 'id', value: nativeUuid(id) }] })).records).toEqual([]);
    expect((await sa.client.from('todos').select('*').eq('id', id)).data).toEqual([]);
  }
}

describe('SDK data slice against owned TrailBase and official Supabase reference (not signoff)', () => {
  it('L1-06/I06/C06 L1-07/I07/C07 L1-08/I08/C08 null results, defaults, target/control rows and exact audit operations', async () => {
    const ids = [randomUUID(), randomUUID()];
    const native = adapter(a.client.headers());
    try {
      for (const [client, owner] of commonClients(native)) {
        for (const [index, id] of ids.entries()) expect(await client.from('todos').insert({ id, user_id: owner, title: `sdk-${id}`, ...(index ? { note: 'control' } : {}) })).toMatchObject({ data: null, error: null });
        const before = await client.from('todos').select('*').order('title');
        expect(before.error).toBeNull(); expect(before.data).toHaveLength(2);
        const target = before.data!.find(row => row.id === ids[0])!;
        expect(target).toMatchObject({ id: ids[0], user_id: owner, completed: false, priority: 0, note: null });
        expect(Number.isSafeInteger(target.created_at)).toBe(true);
        expect(await client.from('todos').update({ completed: true, note: 'changed' }).eq('id', ids[0])).toMatchObject({ data: null, error: null });
        const after = await client.from('todos').select('*').order('title');
        expect(after.error).toBeNull();
        expect(after.data).toEqual(before.data!.map(row => row.id === ids[0] ? { ...row, completed: true, note: 'changed' } : row));
        expect(await client.from('todos').delete().eq('id', ids[0])).toMatchObject({ data: null, error: null });
        expect((await client.from('todos').select('*')).data).toEqual(before.data!.filter(row => row.id !== ids[0]));
      }
      expect(requests.filter(r => r.method !== 'GET').map(r => r.method)).toEqual(['POST', 'POST', 'PATCH', 'DELETE']);
      for (const [nativeUser, reference] of [[a, sa]] as const) {
        const audit = (await nativeUser.client.records('todo_audit').list({ pagination: { limit: 1000 }, order: ['+audit_key'] })).records;
        const ref = await reference.client.from('todo_audit').select('*').order('audit_key');
        expect(ref.error).toBeNull();
        expect(audit.filter(row => row.todo_id === nativeUuid(ids[0])).map(row => row.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
        expect(ref.data!.filter(row => row.todo_id === ids[0]).map(row => row.operation)).toEqual(['INSERT', 'UPDATE', 'DELETE']);
      }
    } finally { await cleanup(ids); }
  });

  it('L1-12/I12/C12 L1-13/I13/C13 exact 0/1/2/61 cardinality after caller bounds, six filters/order/ranges and views', async () => {
    const ids = Array.from({ length: 61 }, () => randomUUID());
    const native = adapter(a.client.headers());
    try {
      for (const [client, owner] of commonClients(native)) {
        for (const [priority, id] of ids.entries()) expect((await client.from('todos').insert({ id, user_id: owner, title: `card-${id}`, priority, completed: priority % 2 === 0 })).error).toBeNull();
        expect((await client.from('todos').select('*')).data).toHaveLength(61);
        for (const method of ['single', 'maybeSingle'] as const) {
          const empty = await client.from('todos').select('*').eq('id', randomUUID())[method]();
          expect(empty.data).toBeNull(); expect(empty.error === null).toBe(method === 'maybeSingle');
          const one = await client.from('todos').select('*').eq('id', ids[0])[method]();
          expect(one.error).toBeNull(); expect(one.data?.id).toBe(ids[0]);
          const two = await client.from('todos').select('*').lte('priority', 1)[method]();
          expect(two.data).toBeNull(); expect(two.error).not.toBeNull();
          const many = await client.from('todos').select('*')[method]();
          expect(many.data).toBeNull(); expect(many.error).not.toBeNull();
          const bounded = await client.from('todos').select('*').order('priority').range(60, 60)[method]();
          expect(bounded.error).toBeNull(); expect(bounded.data?.id).toBe(ids[60]);
          const limited = await client.from('todos').select('*').order('priority').limit(1)[method]();
          expect(limited.error).toBeNull(); expect(limited.data?.id).toBe(ids[0]);
        }
        const query = await client.from('todos').select('*').neq('priority', 0).gt('priority', 2).gte('priority', 3).lt('priority', 8).lte('priority', 7).eq('completed', false).order('priority').range(1, 2);
        expect(query.error).toBeNull(); expect(query.data!.map(row => row.priority)).toEqual([5, 7]);
        expect((await client.from('todos_read').select('*').eq('id', ids[0]).single()).data?.id).toBe(ids[0]);
        expect((await client.from('todos').select('*').limit(0).maybeSingle()).error).toBeNull();
        expect((await client.from('todos').select('*').range(100, 101).maybeSingle()).data).toBeNull();
      }
    } finally { await cleanup(ids); }
  });

  it('L1-07/I07/C07 L1-08/I08/C08 S03/S05 foreign/missing/spoof/reassignment and constraint failures preserve complete rows/audits', async () => {
    const ids = [randomUUID(), randomUUID()];
    const native = adapter(a.client.headers()), foreign = adapter(b.client.headers());
    try {
      for (const [client, owner] of commonClients(native)) {
        for (const id of ids) expect((await client.from('todos').insert({ id, user_id: owner, title: `secure-${id}` })).error).toBeNull();
      }
      const before = await snapshot();
      expect((await foreign.from('todos').select().eq('id', ids[0])).data).toEqual([]);
      expect((await sb.client.from('todos').select('*').eq('id', ids[0])).data).toEqual([]);
      expect((await adapter().from('todos').select()).error).not.toBeNull();
      expect((await supabase(env).from('todos').select('*')).error).not.toBeNull();
      for (const id of [ids[0], randomUUID()]) {
        for (const method of ['update', 'delete'] as const) {
          const n = method === 'update' ? foreign.from('todos').update({ title: 'stolen' }) : foreign.from('todos').delete();
          const r = method === 'update' ? sb.client.from('todos').update({ title: 'stolen' }) : sb.client.from('todos').delete();
          expect((await n.eq('id', id)).error?.status).toBe(403);
          expect(await r.eq('id', id)).toMatchObject({ data: null, error: null, status: 204 });
        }
      }
      const spoofClients = [[{ from: (name: string) => foreign.from(name) }, canonicalUuid(a.user.id)], [{ from: (name: string) => sb.client.from(name) }, sa.user.id]] as const;
      for (const [client, owner] of spoofClients) {
        expect((await client.from('todos').insert({ id: randomUUID(), user_id: owner, title: `spoof-${randomUUID()}` })).error).not.toBeNull();
      }
      expect((await native.from('todos').update({ user_id: canonicalUuid(b.user.id) }).eq('id', ids[0])).error).not.toBeNull();
      expect((await sa.client.from('todos').update({ user_id: sb.user.id }).eq('id', ids[0])).error).not.toBeNull();
      const badUpdate = await native.from('todos').update({ priority: -1 }).eq('id', ids[0]);
      expect(badUpdate.data).toBeNull(); expect(badUpdate.error?.status).toBe(500); expect(badUpdate.error?.code).toBeUndefined();
      expect(await sa.client.from('todos').update({ priority: -1 }).eq('id', ids[0])).toMatchObject({ data: null, status: 400, error: { code: '23514' } });
      expect((await native.from('todos').insert({ id: ids[0], user_id: canonicalUuid(a.user.id), title: 'duplicate' })).error?.status).toBe(400);
      expect((await sa.client.from('todos').insert({ id: ids[0], user_id: sa.user.id, title: 'duplicate' })).error?.code).toBe('23505');
      expect(await snapshot()).toEqual(before);
      const count = requests.length;
      const table = native.from('todos');
      for (const invoke of [() => table.update({ title: 'x', typo: true }), () => table.update({ id: ids[0] }), () => table.delete().eq('id', ids[0]).eq('title', 'x'), () => table.update({ title: 'x' }).eq('title', 'x'), () => native.from('todos_read').delete(), () => Reflect.apply(table.insert, table, [[{ title: 'x' }]]), () => Reflect.apply(table.select, table, ['*', { head: true }])]) expect(invoke).toThrow();
      expect((await table.delete()).error).not.toBeNull(); expect(requests).toHaveLength(count);
      expect(await snapshot()).toEqual(before);
    } finally { await cleanup(ids); }
  });

  it('L1-04/I04/C04 L1-06/I06/C06 repeated await executes again; lost committed reply has one wire write and no replay', async () => {
    const ids = [randomUUID(), randomUUID()];
    const native = adapter(a.client.headers());
    try {
      const query = native.from('todos').insert({ id: ids[0], user_id: canonicalUuid(a.user.id), title: `repeat-${ids[0]}` });
      expect((await query).error).toBeNull(); expect((await query).error?.status).toBe(400);
      const reference = sa.client.from('todos').insert({ id: ids[0], user_id: sa.user.id, title: `repeat-${ids[0]}` });
      expect((await reference).error).toBeNull(); expect((await reference).error?.code).toBe('23505');
      let writes = 0;
      const lost = createClient(env.trailUrl, undefined, { trailbase: mapping, global: { fetch: async (input, init) => {
        writes++;
        const response = await fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...a.client.headers() } });
        expect(response.ok).toBe(true); await response.arrayBuffer();
        throw new TypeError('Owned reply discarded after backend completion');
      } } });
      const result = await lost.from('todos').insert({ id: ids[1], user_id: canonicalUuid(a.user.id), title: `lost-${ids[1]}` });
      expect(result.data).toBeNull(); expect(result.error?.name).toBe('TypeError'); expect(writes).toBe(1);
      expect((await a.client.records('todos').read(nativeUuid(ids[1]))).title).toBe(`lost-${ids[1]}`);
      expect((await a.client.records('todo_audit').list({ pagination: { limit: 1000 } })).records.filter(row => row.todo_id === nativeUuid(ids[1])).map(row => row.operation)).toEqual(['INSERT']);
    } finally { await cleanup(ids); }
  });

  it('L1-03/I03/C03 L1-07/I07/C07 L1-08/I08/C08 nonstandard integer key zero uses exactly one native record endpoint', async () => {
    const native = adapter(a.client.headers());
    const before = requests.length;
    try {
      for (const [client, owner] of commonClients(native)) {
        expect((await client.from('integer_todos').insert({ todo_key: 0, user_id: owner, title: 'zero' })).error).toBeNull();
        expect((await client.from('integer_todos').update({ title: 'updated' }).eq('todo_key', 0)).error).toBeNull();
        expect((await client.from('integer_todos').select('*').eq('todo_key', 0).single()).data?.title).toBe('updated');
        expect((await client.from('integer_todos').delete().eq('todo_key', 0)).error).toBeNull();
        expect((await client.from('integer_todos').select('*').eq('todo_key', 0).maybeSingle()).data).toBeNull();
      }
      expect(requests.slice(before).filter(r => r.method !== 'GET')).toEqual([{ method: 'POST', path: '/api/records/v1/integer_todos' }, { method: 'PATCH', path: '/api/records/v1/integer_todos/0' }, { method: 'DELETE', path: '/api/records/v1/integer_todos/0' }]);
    } finally {
      const rows = (await a.client.records('integer_todos').list()).records;
      if (rows.some(row => row.todo_key === 0)) await a.client.records('integer_todos').delete(0);
      expect((await sa.client.from('integer_todos').delete().eq('todo_key', 0)).error).toBeNull();
    }
  });

  it('L1-11/I11/C11 L1-12/I12/C12 L1-13/I13/C13 1000/1001 cap, tied pages beyond 50 and bounded cardinality preserve complete owned rows/audits', async () => {
    // Dedicated generated fixture users keep >1000 audit entries separate from smaller cases.
    const owner = await confirmedTrailUser(env, 'sdk-cap');
    const reference = await confirmedSupabaseUser(env, 'sdk-cap');
    const native = adapter(owner.client.headers());
    const ids = Array.from({ length: 1001 }, () => randomUUID());
    const ownedIds = new Set<string>(ids);
    let seedComplete = false;
    async function readRows(table: 'todos' | 'todo_audit') {
      const nativeRows: Record<string, unknown>[] = [], referenceRows: Record<string, unknown>[] = [];
      for (const offset of [0, 1000, 2000]) {
        const order = table === 'todos' ? ['+priority', '+title'] : ['+audit_key'];
        const page = (await owner.client.records(table).list({ order, pagination: { limit: 1000, offset } })).records;
        const query = reference.client.from(table).select('*');
        const expected = await (table === 'todos' ? query.order('priority').order('title') : query.order('audit_key')).range(offset, offset + 999);
        expect(expected.error).toBeNull(); expect(page.length).toBeLessThanOrEqual(1000); expect(expected.data!.length).toBeLessThanOrEqual(1000);
        nativeRows.push(...page); referenceRows.push(...expected.data!);
        // Three pages cover the bounded fixture's 1001 rows / 2002 INSERT+DELETE audits.
        if (offset === 2000) { expect(page.length).toBeLessThan(1000); expect(expected.data!.length).toBeLessThan(1000); }
      }
      return { native: nativeRows, reference: referenceRows };
    }
    async function state() { return { todos: await readRows('todos'), audit: await readRows('todo_audit') }; }
    try {
      expect(await state()).toEqual({ todos: { native: [], reference: [] }, audit: { native: [], reference: [] } });
      // These loops are owned fixture setup only, not SDK bulk support.
      for (const [index, id] of ids.entries()) {
        const values = { title: `cap-${String(index).padStart(4, '0')}-${id}`, priority: Math.floor(index / 2), note: index % 2 ? null : 'owned' };
        await owner.client.records('todos').create({ ...values, id: nativeUuid(id), user_id: owner.user.id });
        expect((await reference.client.from('todos').insert({ ...values, id, user_id: reference.user.id })).error).toBeNull();
      }
      seedComplete = true;
      const before = await state();
      expect(before.todos.native.map(row => canonicalUuid(String(row.id)))).toEqual(ids);
      expect(before.todos.reference.map(row => row.id)).toEqual(ids);
      expect(before.audit.native).toHaveLength(1001); expect(before.audit.reference).toHaveLength(1001);
      const nativeExpected = before.todos.native.map(row => ({ ...row, id: canonicalUuid(String(row.id)), user_id: canonicalUuid(String(row.user_id)), completed: row.completed === 1 }));
      const clients = [
        [{ from: (name: string) => native.from(name) }, nativeExpected],
        [{ from: (name: string) => reference.client.from(name) }, before.todos.reference],
      ] as const;
      const queryStart = requests.length;
      for (const [client, rows] of clients) {
        // title is an explicit ASCII tie-breaker for tied priorities.
        const ordered = () => client.from('todos').select('*').order('priority').order('title');
        for (const [query, expected] of [
          [ordered(), rows.slice(0, 1000)],
          [ordered().limit(61), rows.slice(0, 61)],
          [ordered().limit(1000), rows.slice(0, 1000)],
          [ordered().range(50, 60), rows.slice(50, 61)],
          [ordered().range(999, 1000), rows.slice(999, 1001)],
          [ordered().range(1000, 1000), rows.slice(1000)],
          [ordered().range(1001, 1002), []],
        ] as const) {
          const result = await query;
          expect(result.error).toBeNull(); expect(result.data).toEqual(expected);
        }
        for (const method of ['single', 'maybeSingle'] as const) {
          const unbounded = await ordered()[method]();
          expect(unbounded.data).toBeNull(); expect(unbounded.error).not.toBeNull();
          const two = await ordered().range(999, 1000)[method]();
          expect(two.data).toBeNull(); expect(two.error).not.toBeNull();
          expect(await ordered().range(1000, 1000)[method]()).toMatchObject({ data: rows[1000], error: null });
          expect(await ordered().limit(1)[method]()).toMatchObject({ data: rows[0], error: null });
          expect(await ordered().gte('priority', 500)[method]()).toMatchObject({ data: rows[1000], error: null });
        }
        expect(await ordered().range(1001, 1002).maybeSingle()).toMatchObject({ data: null, error: null });
        const missing = await ordered().range(1001, 1002).single();
        expect(missing.data).toBeNull(); expect(missing.error).not.toBeNull();
      }
      expect(requests.slice(queryStart).every(request => request.method === 'GET')).toBe(true);
      const requestCount = requests.length;
      expect(() => native.from('todos').select().limit(1001)).toThrow(TypeError);
      expect(() => native.from('todos').select().range(0, 1000)).toThrow(TypeError);
      expect(requests).toHaveLength(requestCount);
      expect(await state()).toEqual(before);
    } finally {
      // Reconcile even partial setup from complete owned fixture pages, then remove exact keys.
      const current = await readRows('todos');
      for (const row of current.native) {
        expect(ownedIds.has(canonicalUuid(String(row.id)))).toBe(true);
        await owner.client.records('todos').delete(String(row.id));
      }
      for (const row of current.reference) {
        expect(ownedIds.has(String(row.id))).toBe(true);
        expect((await reference.client.from('todos').delete().eq('id', row.id)).error).toBeNull();
      }
      const after = await state();
      expect(after.todos).toEqual({ native: [], reference: [] });
      for (const [rows, decode] of [[after.audit.native, canonicalUuid], [after.audit.reference, (value: string) => value]] as const) {
        const inserted = rows.filter(row => row.operation === 'INSERT').map(row => decode(String(row.todo_id))).sort();
        const deleted = rows.filter(row => row.operation === 'DELETE').map(row => decode(String(row.todo_id))).sort();
        expect(deleted).toEqual(inserted); expect(rows).toHaveLength(inserted.length * 2);
        expect(inserted.every(id => ownedIds.has(id))).toBe(true);
        if (seedComplete) expect(inserted).toEqual([...ids].sort());
      }
    }
  }, 180000);

});
