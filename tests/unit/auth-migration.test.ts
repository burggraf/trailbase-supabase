import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const sql=readFileSync(new URL('../fixtures/auth-mitigation/U1790991000__reserve_auth_email.sql',import.meta.url),'utf8');
function database() {
  const db=new DatabaseSync(':memory:');
  // Policy-only fixture. Installed native migrations/HTTP flows are tested separately.
  db.exec('CREATE TABLE _user(id INTEGER PRIMARY KEY,email TEXT COLLATE NOCASE,unverified_email TEXT COLLATE NOCASE); CREATE UNIQUE INDEX native_email ON _user(email);');
  return db;
}
function apply(db: DatabaseSync) {
  db.exec('BEGIN');
  try { db.exec(sql); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; }
}
describe('L1-27/G1/U27 investigational auth reservation SQL, not stock server behavior',()=>{
  it('blocks pending/verified/cross-column case-insensitive insert collisions without changing rows',()=>{
    const db=database();
    try {
      db.exec("INSERT INTO _user VALUES(1,NULL,'pending@example.test'),(2,'verified@example.test',NULL)"); apply(db);
      for(const values of ["(3,NULL,'PENDING@example.test')","(3,'pending@example.test',NULL)","(3,NULL,'VERIFIED@example.test')","(3,'verified@example.test',NULL)"]) {
        expect(()=>db.exec(`INSERT INTO _user VALUES${values}`)).toThrow();
        expect(db.prepare('SELECT COUNT(*) AS n FROM _user').get()?.n).toBe(2);
      }
    } finally { db.close(); }
  });
  it('permits same-user confirmation and anonymous null addresses but rejects conflicting updates atomically',()=>{
    const db=database();
    try {
      apply(db); db.exec("INSERT INTO _user VALUES(1,NULL,'pending@example.test'),(2,'verified@example.test',NULL),(3,NULL,NULL),(4,NULL,NULL)");
      for(const assignment of ["email='verified@example.test'","unverified_email='verified@example.test'"]) expect(()=>db.exec(`UPDATE _user SET ${assignment} WHERE id=1`)).toThrow();
      expect(db.prepare('SELECT email,unverified_email FROM _user WHERE id=1').get()).toEqual({email:null,unverified_email:'pending@example.test'});
      db.exec('UPDATE _user SET email=unverified_email,unverified_email=NULL WHERE id=1');
      expect(db.prepare('SELECT email,unverified_email FROM _user WHERE id=1').get()).toEqual({email:'pending@example.test',unverified_email:null});
    } finally { db.close(); }
  });
  it('refuses ambiguous existing accounts and rolls back without dropping or merging identities',()=>{
    for(const rows of ["(1,NULL,'x@example.test'),(2,NULL,'X@example.test')","(1,'x@example.test',NULL),(2,NULL,'X@example.test')"]) {
      const db=database();
      try {
        db.exec(`INSERT INTO _user VALUES${rows}`);
        const before=db.prepare('SELECT * FROM _user ORDER BY id').all();
        expect(()=>apply(db)).toThrow();
        expect(db.prepare('SELECT * FROM _user ORDER BY id').all()).toEqual(before);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'trailbase_supabase_%'").all()).toEqual([]);
      } finally { db.close(); }
    }
  });
  it('does not reject a row reserving the same address in both fields',()=>{
    const db=database();
    try { db.exec("INSERT INTO _user VALUES(1,'same@example.test','SAME@example.test')"); expect(()=>apply(db)).not.toThrow(); }
    finally { db.close(); }
  });
});
