// Decision-pending contract proof, NOT SDK/runtime or a metadata-resolver implementation.
// Run: node docs/prototypes/bootstrap-metadata-contract.mjs
// Actual in-memory SQLite PRAGMAs, transactions and writes; no server/network/filesystem DB.
// wireSchema models ONLY the primitive/required projection for these simple fixtures from:
// trailbaseio/trailbase@a106ce6338f9831140c92ac16e051901ed92d576
// crates/schema/src/json_schema/mod.rs. It does NOT execute that Rust code or prove HTTP parity.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const opened = [];
const cases = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
function database(sql) {
  const db = new DatabaseSync(':memory:');
  opened.push(db);
  db.exec(sql);
  return db;
}
const columns = (db) => db.prepare('PRAGMA table_xinfo(todos)').all();
const ddl = (db) => db.prepare("SELECT sql FROM sqlite_schema WHERE name='todos'").get().sql;
function primaryKey(db) {
  const keys = columns(db).filter((column) => column.pk);
  assert.equal(keys.length, 1);
  return keys[0].name;
}
const fingerprint = (db) => hash(JSON.stringify({ ddl: ddl(db), columns: columns(db) }));
function wireSchema(db, mode) {
  const properties = {}, required = [];
  for (const column of columns(db)) {
    const type = { INTEGER: 'integer', TEXT: 'string', BLOB: 'string' }[column.type];
    assert(type);
    properties[column.name] = { type: column.notnull ? type : ['null', type] };
    const defaulted = column.dflt_value !== null || column.pk;
    if (column.notnull && (mode === 'Select' || mode === 'Insert' && !defaulted)) {
      required.push(column.name);
    }
  }
  return { title: 'todos', type: 'object', properties, required };
}
function test(name, run) {
  run();
  cases.push({ name, status: 'passed' });
}

try {
  const a = database('CREATE TABLE todos(id INTEGER PRIMARY KEY NOT NULL, alternate INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL) STRICT;');
  const b = database('CREATE TABLE todos(id INTEGER NOT NULL DEFAULT 0, alternate INTEGER PRIMARY KEY NOT NULL, title TEXT NOT NULL) STRICT;');
  test('M01 identical modeled schemas in all three modes, different actual primary keys', () => {
    for (const mode of ['Insert', 'Select', 'Update']) assert.deepEqual(wireSchema(a, mode), wireSchema(b, mode));
    assert.equal(primaryKey(a), 'id');
    assert.equal(primaryKey(b), 'alternate');
    assert.notEqual(fingerprint(a), fingerprint(b));
  });
  test('M02 guessing id can update a different logical row, not just fail harmlessly', () => {
    for (const db of [a, b]) db.exec("INSERT INTO todos VALUES(1,2,'first'),(2,1,'second')");
    a.prepare('UPDATE todos SET title=? WHERE id=?').run('changed', 1);
    b.prepare('UPDATE todos SET title=? WHERE alternate=?').run('changed', 1);
    assert.equal(a.prepare("SELECT id FROM todos WHERE title='changed'").get().id, 1);
    assert.equal(b.prepare("SELECT id FROM todos WHERE title='changed'").get().id, 2);
  });

  const blob = database('CREATE TABLE todos(id INTEGER PRIMARY KEY NOT NULL, payload BLOB NOT NULL) STRICT;');
  const text = database('CREATE TABLE todos(id INTEGER PRIMARY KEY NOT NULL, payload TEXT NOT NULL) STRICT;');
  const bytes = Buffer.from('12345678123442348234123456789abc', 'hex');
  const encoded = bytes.toString('base64url') + '==';
  blob.prepare('INSERT INTO todos VALUES(?,?)').run(1, bytes);
  text.prepare('INSERT INTO todos VALUES(?,?)').run(1, encoded);
  test('M03 BLOB/TEXT modeled schemas and wire values collide; value-shape UUID decoding is unsafe', () => {
    assert.deepEqual(wireSchema(blob, 'Select'), wireSchema(text, 'Select'));
    const binary = blob.prepare('SELECT payload FROM todos').get().payload;
    const string = text.prepare('SELECT payload FROM todos').get().payload;
    assert(binary instanceof Uint8Array);
    assert.equal(typeof string, 'string');
    assert.equal(Buffer.from(binary).toString('base64url') + '==', string);
    assert.notEqual(columns(blob)[1].type, columns(text)[1].type);
  });
  test('M09 native body/path UUID handling must not be generalized to BLOB filters', () => {
    const canonical = '12345678-1234-4234-8234-123456789abc';
    const uuidBytes = Buffer.from(canonical.replaceAll('-', ''), 'hex');
    const filterBytes = Buffer.from(canonical, 'base64url');
    assert.equal(uuidBytes.length, 16);
    assert.equal(filterBytes.length, 27);
    assert.notDeepEqual(filterBytes, uuidBytes);
    // Source-derived parser contrast, not an executed Rust filter/HTTP request. Native filters
    // base64-decode BLOB strings; native JSON body/path parsers first recognize UUID strings.
  });
  test('M04 identical INTEGER0/1 storage cannot reveal target boolean versus bounded-integer intent', () => {
    const db = database('CREATE TABLE todos(id INTEGER PRIMARY KEY NOT NULL, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1))) STRICT;');
    db.exec('INSERT INTO todos(id,completed) VALUES(1,1)');
    assert.equal(db.prepare('SELECT completed FROM todos').get().completed, 1);
    assert.equal(wireSchema(db, 'Select').properties.completed.type, 'integer');
    // Two legitimate reference column contracts, not results from a real Postgres instance.
    assert.notEqual(typeof true, typeof 1);
    assert.equal(Number(true), 1);
  });
  test('M05 deployment introspection supplies PK/native types/fingerprint, not logical codecs', () => {
    const inspect = (db) => ({
      primaryKey: primaryKey(db), nativeColumns: columns(db), fingerprint: fingerprint(db),
      logicalUuidBooleanSemantics: 'UNRESOLVED',
    });
    assert.equal(inspect(b).primaryKey, 'alternate');
    assert.notEqual(inspect(a).fingerprint, inspect(b).fingerprint);
    assert.equal(inspect(blob).nativeColumns[1].type, 'BLOB');
    assert.equal(inspect(text).nativeColumns[1].type, 'TEXT');
    assert.equal(inspect(blob).logicalUuidBooleanSemantics, 'UNRESOLVED');
  });

  const catalog = database('CREATE TABLE todos(id INTEGER PRIMARY KEY NOT NULL, title TEXT NOT NULL) STRICT; CREATE TABLE deployment_metadata(id INTEGER PRIMARY KEY,epoch INTEGER NOT NULL,fingerprint TEXT NOT NULL) STRICT;');
  const before = fingerprint(catalog);
  catalog.prepare('INSERT INTO deployment_metadata VALUES(1,1,?)').run(before);
  test('M06 same-database catalog and DDL can roll back together; separate files do not inherit this', () => {
    catalog.exec('BEGIN; ALTER TABLE todos ADD COLUMN note TEXT;');
    catalog.prepare('UPDATE deployment_metadata SET epoch=2,fingerprint=?').run(fingerprint(catalog));
    assert.notEqual(fingerprint(catalog), before);
    catalog.exec('ROLLBACK');
    assert.equal(fingerprint(catalog), before);
    assert.equal(catalog.prepare('SELECT epoch FROM deployment_metadata').get().epoch, 1);
    assert.equal(catalog.prepare('SELECT fingerprint FROM deployment_metadata').get().fingerprint, before);
  });
  test('M07 a fresh catalog lookup still races migration before a separate native operation', () => {
    const fetchedEpoch = catalog.prepare('SELECT epoch FROM deployment_metadata').get().epoch;
    catalog.exec('BEGIN; ALTER TABLE todos ADD COLUMN note TEXT;');
    catalog.prepare('UPDATE deployment_metadata SET epoch=2,fingerprint=?').run(fingerprint(catalog));
    catalog.exec('COMMIT');
    assert.equal(fetchedEpoch, 1);
    assert.equal(catalog.prepare('SELECT epoch FROM deployment_metadata').get().epoch, 2);
    assert.notEqual(fingerprint(catalog), before);
  });
  test('M08 explicit JSON boolean storage reduces an output conversion, not UUID/PK requirements', () => {
    const db = database("CREATE TABLE todos(id INTEGER PRIMARY KEY NOT NULL, completed TEXT NOT NULL CHECK(json_valid(completed) AND json_type(completed) IN ('true','false'))) STRICT;");
    db.exec("INSERT INTO todos VALUES(1,'true')");
    const stored = db.prepare('SELECT completed FROM todos').get().completed;
    assert.equal(typeof stored, 'string');
    assert.equal(JSON.parse(stored), true);
    assert.equal(primaryKey(db), 'id');
    assert.equal(wireSchema(db, 'Select').properties.completed.type, 'string');
    // This json_type CHECK alone does NOT trigger native JSON-column metadata. The native
    // jsonschema/jsonschema_matches declaration/serializer path is reviewed separately in source.
  });
} finally {
  for (const db of opened) db.close();
}
console.log(JSON.stringify({
  scope: '9-case in-memory SQLite plus limited source-derived wire/parser models; not native/Supabase runtime qualification or architecture adoption',
  node: process.version, cases, databasesClosed: opened.length, filesystemDatabases: 0, servers: 0,
  limits: ['No permission/HTTP model replaces genuine backend tests', 'No complete logical codec generator', 'A hash/epoch does not enforce an atomic native operation precondition'],
}, null, 2));
