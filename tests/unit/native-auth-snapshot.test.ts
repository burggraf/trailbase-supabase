import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as helpers from '../phase-a/helpers.js';

it('L1-19/OGL03 native auth proof snapshots every sorted column/row losslessly without changing either database', () => {
  const snapshot = Reflect.get(helpers, 'nativeAuthSnapshot'); expect(snapshot).toBeTypeOf('function');
  const main = new DatabaseSync(':memory:'), sessions = new DatabaseSync(':memory:');
  try {
    main.exec("CREATE TABLE _user(id BLOB,email TEXT,marker INTEGER); CREATE TABLE todos(id BLOB,user_id BLOB,title TEXT,created_at INTEGER); CREATE TABLE todo_audit(audit_key INTEGER,todo_id BLOB,operation TEXT); INSERT INTO _user VALUES(X'02','control@example.test',9223372036854775807),(X'01','owned@example.test',-9223372036854775807); INSERT INTO todos VALUES(X'02',X'02','control',9223372036854775807),(X'01',X'01','owned',-9223372036854775807); INSERT INTO todo_audit VALUES(2,X'02','INSERT'),(1,X'01','INSERT');");
    sessions.exec("CREATE TABLE _session(user BLOB,refresh_token TEXT,marker INTEGER); INSERT INTO _session VALUES(X'02','fixture-control',9223372036854775807),(X'01','fixture-owned',-9223372036854775807);");
    const changes = [main, sessions].map(db => db.prepare('SELECT total_changes() AS n').get()!.n);
    const result = snapshot(main, sessions);
    expect(Object.keys(result)).toEqual(['users', 'sessions', 'todos', 'audit']);
    expect(result.users[0].id).toBeInstanceOf(Uint8Array);
    // Node SQLite BLOBs need byte normalization when the expected ID is a Buffer.
    expect(Buffer.from(result.users[0].id as Uint8Array)).toEqual(Buffer.from([1]));
    expect(Buffer.from(result.users[0].id as Uint8Array)).not.toEqual(Buffer.from([2]));
    expect(Buffer.from(result.audit[0].todo_id as Uint8Array)).toEqual(Buffer.from([1]));
    expect(result.users.map(row => row.marker)).toEqual([-9223372036854775807n, 9223372036854775807n]);
    expect(result.sessions.map(row => row.marker)).toEqual([-9223372036854775807n, 9223372036854775807n]);
    expect(result.todos.map(row => row.created_at)).toEqual([-9223372036854775807n, 9223372036854775807n]);
    expect(result.audit.map(row => row.audit_key)).toEqual([1n, 2n]);
    for (const rows of Object.values(result)) expect(rows).toHaveLength(2);
    expect(result.users[0]).toMatchObject({ email: 'owned@example.test' }); expect(result.users[1]).toMatchObject({ email: 'control@example.test' });
    expect([main, sessions].map(db => db.prepare('SELECT total_changes() AS n').get()!.n)).toEqual(changes);
  } finally { main.close(); sessions.close(); }
});
