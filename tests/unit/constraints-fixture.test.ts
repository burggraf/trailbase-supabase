import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { it, expect } from 'vitest';

it('L1-27/U27 G3 native fixture SQL enforces FK/trigger row rollback, not native HTTP compatibility',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _user(id BLOB PRIMARY KEY NOT NULL) STRICT;');
    db.function('is_uuid_v4',{deterministic:true},value=>value instanceof Uint8Array&&value.length===16&&(value[6]!>>4)===4&&(value[8]!>>6)===2?1:0);
    db.exec(await readFile('tests/fixtures/trailbase/migrations/main/U1780400000__phase_a.sql','utf8'));
    const id=(tail:string)=>Buffer.from(`111111111111411181111111111111${tail}`,'hex');
    const owner=id('01'),parent=id('02'),child=id('03'),missing=id('04');
    db.prepare('INSERT INTO _user(id) VALUES(?)').run(owner);
    db.prepare('INSERT INTO todos(id,user_id,title) VALUES(?,?,?)').run(parent,owner,'parent');
    db.prepare('INSERT INTO todo_links(id,user_id,restricted_todo_id,note) VALUES(?,?,?,?)').run(child,owner,parent,'before');
    const snapshot=()=>['todos','todo_links','todo_audit'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    const before=snapshot();
    for(const mutation of [
      ()=>db.prepare('INSERT INTO todo_links(id,user_id,restricted_todo_id,note) VALUES(?,?,?,?)').run(id('05'),owner,missing,'invalid'),
      ()=>db.prepare('UPDATE todo_links SET restricted_todo_id=?,note=? WHERE id=?').run(missing,'changed',child),
      ()=>db.prepare('DELETE FROM todos WHERE id=?').run(parent),
      ()=>db.prepare('INSERT INTO todos(id,user_id,title,note) VALUES(?,?,?,?)').run(id('06'),owner,'rejected','phase-a-trigger-reject'),
      ()=>db.prepare('UPDATE todos SET note=?,priority=7 WHERE id=?').run('phase-a-trigger-reject',parent),
    ]){expect(mutation).toThrow();expect(snapshot()).toEqual(before);}
    db.prepare('UPDATE todo_links SET restricted_todo_id=NULL,cascaded_todo_id=? WHERE id=?').run(parent,child);
    db.prepare('DELETE FROM todos WHERE id=?').run(parent);
    expect(db.prepare('SELECT * FROM todo_links').all()).toEqual([]);
    expect(db.prepare('SELECT operation FROM todo_audit ORDER BY audit_key').all().map(row=>row.operation)).toEqual(['INSERT','DELETE']);
  } finally {db.close();}
});

it('L1-27/U27 G3 fixture audit stays read-only and trigger definer SQL has no direct client execution',async()=>{
  const native=await readFile('tests/fixtures/trailbase/config.textproto','utf8');
  expect(native).toMatch(/name: "todo_audit"\s+table_name: "todo_audit"\s+acl_authenticated: \[READ\]/);
  const sql=await readFile('tests/fixtures/supabase/migrations/20260602000000_phase_a.sql','utf8');
  expect(sql).toContain('REVOKE ALL ON public.todo_audit FROM anon, authenticated;');
  expect(sql).toContain('GRANT SELECT ON public.todo_audit TO authenticated;');
  expect(sql).not.toMatch(/GRANT[^;]*(?:INSERT|UPDATE|DELETE)[^;]*ON public.todo_audit/);
  expect(sql).toContain('SECURITY DEFINER SET search_path = pg_catalog');
  expect(sql).toContain('REVOKE ALL ON FUNCTION public.audit_todo_changes() FROM PUBLIC, anon, authenticated;');
});
