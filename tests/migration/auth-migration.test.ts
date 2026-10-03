import { randomUUID } from 'node:crypto';
import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { context, confirmedTrailUser, nativeUuid, trailbase } from '../phase-a/helpers.js';
import { exec } from '../../scripts/tools.mjs';

it('L1-27 G1/I27 existing owned-depot preflight refuses genuine duplicate pending identities and preserves rows/schema/history',async()=>{
  const env=await context();
  if(env.authVariant!=='stock'||env.nativeAuthProfile!=='default')throw new Error('Migration rehearsal requires an isolated stock/default owned depot');
  const depot=resolve(env.directory,'traildepot'),candidate=resolve(depot,'migrations/main/U1790991000__reserve_auth_email.sql');
  await expect(stat(candidate)).rejects.toMatchObject({code:'ENOENT'});
  const email=`migration-pending-${randomUUID()}@example.test`,password=`Fixture-${randomUUID()}-Aa1!`;
  const pending=trailbase(env);
  await pending.register({email,password});await pending.register({email,password});
  expect(pending.tokens()).toBeUndefined();
  await expect(pending.login(email,password)).rejects.toMatchObject({status:401});
  const control=await confirmedTrailUser(env,'migration-control'),id=nativeUuid(randomUUID());
  await control.client.records('todos').create({id,user_id:control.user.id,title:`migration-control-${randomUUID()}`});
  const binary=resolve('.runtime/tools',`${process.platform}-${process.arch}`,'trail');
  const inspect=()=>exec(binary,['--depot',depot,'schema','todos','--mode','select'],{timeout:30000});
  expect(JSON.parse((await inspect()).stdout)).toHaveProperty('properties');
  const db=new DatabaseSync(resolve(depot,'data/main.db'),{readOnly:true});
  const snapshot=()=>({
    users:db.prepare('SELECT * FROM _user ORDER BY id').all(),
    schema:db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),
    history:db.prepare('SELECT * FROM _schema_history ORDER BY version').all()
  });
  try {
    expect(db.prepare('SELECT COUNT(*) AS n FROM _user WHERE unverified_email = ? COLLATE NOCASE').get(email)?.n).toBe(2);
    const before=snapshot();
    await cp('tests/fixtures/auth-mitigation/U1790991000__reserve_auth_email.sql',candidate);
    let failure:{code?:unknown;stdout?:string;stderr?:string}|undefined;
    try {await inspect();} catch(error) {failure=error as typeof failure;}
    await writeFile(resolve(env.directory,'migration-preflight-private.log'),`${failure?.stdout??''}${failure?.stderr??''}`,{mode:0o600});
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain('CHECK constraint failed: valid = 1');
    expect(snapshot()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'trailbase_supabase_%'").all()).toEqual([]);
    // Only the never-applied candidate is removed; no identity or applied migration is repaired/deleted.
    await rm(candidate);
    expect(JSON.parse((await inspect()).stdout)).toHaveProperty('properties');
    expect(snapshot()).toEqual(before);
    expect((await control.client.records('todos').list()).records.map(row=>row.id)).toEqual([id]);
    await expect(pending.login(email,password)).rejects.toMatchObject({status:401});
    expect(pending.tokens()).toBeUndefined();
  } finally {db.close();await rm(candidate,{force:true});}
},90000);
