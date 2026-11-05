// Research-only controls. Handler/fence/permission/cache behavior is a model, not native proof.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {fixture,derive,verify,codec,config,semantics,Host,MetadataCache} from './backend-contract-lifecycle.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function setup(t,carrier='catalog') {const db=fixture();t.after(()=>db.close());const a=derive(db,'a',semantics,config('a'));const b=derive(db,'b',semantics,config('b'));const host=new Host(db,carrier);host.install(a,'g1');host.start({h1:a.binding,h2:a.binding});host.open();return{db,a,b,host};}
function migrate(host,artifact,route='g2') {host.fence();host.stop();host.install(artifact,route);host.start({h1:artifact.binding,h2:artifact.binding});host.open();}
const rows=(db,table)=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();

test('BC01 actual PK authority and false self-hashed descriptor refusal',t=>{
 const db=fixture();t.after(()=>db.close());const a=derive(db,'a',semantics,config('a')),b=derive(db,'b',semantics,config('b'));
 assert.equal(a.descriptor.primaryKey,'id');assert.equal(b.descriptor.primaryKey,'alternate');
 const falseClaim=structuredClone(b);falseClaim.descriptor.primaryKey='id';falseClaim.digest=digest(falseClaim.descriptor);
 assert.throws(()=>verify(db,falseClaim),/descriptor/);assert.equal(verify(db,b),true);
});
test('BC02 direction-specific UUID/boolean plans and conflicting actual config/declarations refuse',t=>{
 const {db,a}=setup(t);const plan=codec('uuid');assert.notEqual(plan.filter,plan.body);assert.notEqual(plan.output,plan.path);assert.notDeepEqual(codec('integer-boolean'),codec('json-text-boolean'));
 const canonical='12345678-1234-4234-8234-123456789abc';assert.equal(Buffer.from(canonical,'base64url').length,27);assert.equal(Buffer.from(canonical.replaceAll('-',''),'hex').length,16);
 assert.throws(()=>derive(db,'a',{...semantics,id:'uuid'},config('a')),/storage/);
 assert.throws(()=>derive(db,'a',{...semantics,id:'UNRESOLVED'},config('a')),/codec/);
 assert.throws(()=>derive(db,'a',semantics,{...config('a'),insert:['id','unknown']}),/columns/);
 assert.throws(()=>verify(db,a,{...config('a'),policy:'world'}),/binding/);
});
test('BC03 create-only discovery needs no target read/schema/delete and discloses only approved structure',t=>{
 const {host}=setup(t);const d=host.metadata('createOnly','insert');assert(d.fields.id);assert.equal(Object.hasOwn(d,'table'),false);assert.equal(Object.hasOwn(d.fields,'_private'),false);assert.equal(JSON.stringify(d).includes('not-public'),false);assert.equal(JSON.stringify(d).includes('CREATE TABLE'),false);
 assert.deepEqual(host.targetReads,{read:0,schema:0,delete:0});assert.throws(()=>host.metadata('anonymous','insert'),/disclosure/);assert.throws(()=>host.write('g1',1,'denied','createOnly'),/permission/);assert.equal(host.accepted,0);
 const before=rows(host.db,'a');host.insert(d.route,{id:3,alternate:3,title:'created'},'createOnly');assert.equal(rows(host.db,'a').length,before.length+1);assert.deepEqual(rows(host.db,'a').slice(0,2),before);assert.deepEqual(host.targetReads,{read:0,schema:0,delete:0});
});
test('BC04 fresh authentic bytes cannot prevent wrong-row mutation after unsafe route rebinding',t=>{
 const {db,a,b,host}=setup(t);const cached=host.metadata('owner','update');assert.equal(cached.primaryKey,'id');assert.equal(a.digest,digest(a.descriptor));
 // Deliberately bypass lifecycle policy: models an operator reusing a native API name.
 host.routes.set('g1',{artifact:b,retired:false});host.write('g1',1,'unsafe');assert.equal(rows(db,'b').find(r=>r.title==='unsafe').id,2);assert.equal(rows(db,'a')[0].title,'first');
});
test('BC05 fence joins accepted work; unknown outcome cannot become stopped/migrated success',t=>{
 const {db,b,host}=setup(t);const token=host.accept('g1',1,'old-accepted','owner');host.fence();assert.throws(()=>host.stop(),/pending/);assert.throws(()=>host.accept('g1',1,'late','owner'),/fenced/);host.finish(token);assert.equal(rows(db,'a')[0].title,'old-accepted');host.stop();host.install(b,'g2');host.start({h1:b.binding,h2:b.binding});host.open();
 const lost=host.accept('g2',1,'committed-lost','owner');host.fence();host.finish(lost,true);assert.throws(()=>host.stop(),/unknown/);assert.throws(()=>host.install(b,'g3'),/stopped/);assert.equal(rows(db,'b').find(r=>r.alternate===1).title,'committed-lost');assert.equal(host.serving,false);
});
test('BC06 SQLite DDL/catalog rollback is real, config agreement remains separate',t=>{
 const {db,a,host}=setup(t);host.fence();host.stop();db.exec("CREATE TABLE release_catalog(value TEXT); INSERT INTO release_catalog VALUES('g1'); BEGIN; ALTER TABLE a ADD COLUMN extra TEXT; UPDATE release_catalog SET value='g2'; ROLLBACK;");assert.equal(db.prepare('PRAGMA table_info(a)').all().some(c=>c.name==='extra'),false);assert.equal(db.prepare('SELECT value FROM release_catalog').get().value,'g1');
 host.install(a,'g2');assert.throws(()=>host.start({h1:'wrong-config',h2:a.binding}),/handler/);assert.equal(host.serving,false);
});
test('BC07 safe cutover retires old cached URL before open, preserving exact new target/control state',t=>{
 const {db,b,host}=setup(t);const old=host.metadata('owner','update');const before=rows(db,'b');migrate(host,b);assert.throws(()=>host.write(old.route,1,'stale'),/retired/);assert.deepEqual(rows(db,'b'),before);assert.equal(host.metadata('owner','update').primaryKey,'alternate');host.write('g2',1,'new');assert.equal(rows(db,'b').find(r=>r.id===2).title,'new');assert.equal(rows(db,'b').find(r=>r.id===1).title,'first');
});
test('BC08 immutable contract and permanent route non-reuse, including same-schema ABA',t=>{
 const {a,b,host}=setup(t);assert.throws(()=>host.install(b,'g1'),/stopped/);migrate(host,b);host.fence();host.stop();assert.throws(()=>host.install(a,'g1'),/used/);assert.equal(host.used.has('g1'),true);assert.equal(host.serving,false);
});
test('BC09 missing/unknown/mixed modelled handlers block opening',t=>{
 const {b,host}=setup(t);host.fence();host.stop();host.install(b,'g2');for(const bindings of [{h1:b.binding},{h1:b.binding,h2:'old'},{h1:b.binding,h2:b.binding,unknown:b.binding}]){assert.throws(()=>host.start(bindings),/handler/);assert.equal(host.serving,false);}host.start({h1:b.binding,h2:b.binding});host.open();assert.equal(host.serving,true);
});
test('BC10 forward recovery uses fresh route and preserves latest committed data, not old backup',t=>{
 const {db,a,host}=setup(t);const oldBackup=rows(db,'a');host.write('g1',1,'after-backup');const snapshot=rows(db,'a');migrate(host,a,'g2');assert.deepEqual(rows(db,'a'),snapshot);host.write('g2',1,'after-cutover');const latest=rows(db,'a');migrate(host,a,'g3');assert.deepEqual(rows(db,'a'),latest);assert.throws(()=>host.write('g1',1,'revive'),/retired/);assert.throws(()=>host.write('g2',1,'revive'),/retired/);
 // Independently retained publication history is mandatory: model refuses an old backup epoch.
 assert.throws(()=>host.restorePublicationHistory(new Set(['g1'])),/history/);assert.deepEqual(rows(db,'a'),latest);
 // Bypass the proposed procedure: a real SQL restore can erase acknowledged newer values.
 db.exec('BEGIN');const restore=db.prepare('UPDATE a SET title=? WHERE id=?');for(const row of oldBackup)restore.run(row.title,row.id);db.exec('COMMIT');assert.notDeepEqual(rows(db,'a'),latest);assert.equal(rows(db,'a')[0].title,'first');
});
test('BC11 metadata cache owner lifetime and disclosure never grant mutation permission',t=>{
 const {host}=setup(t);const cache=new MetadataCache();cache.put('A-lease',host.metadata('createOnly','insert'));assert(cache.get('A-lease'));assert.throws(()=>cache.get('new-A-lease'),/owner/);cache.clear();assert.throws(()=>cache.get('B-lease'),/owner/);assert.throws(()=>host.write('g1',1,'bad','createOnly'),/permission/);assert.deepEqual(host.targetReads,{read:0,schema:0,delete:0});
});
test('BC12 catalog/static carriers share authority and safe/unsafe lifecycle, neither repairs false facts',t=>{
 for(const carrier of ['catalog','static']){const {db,a,b,host}=setup(t,carrier);const stale=host.metadata('owner','update');const forged=structuredClone(a);forged.descriptor.primaryKey='not_a_key';forged.digest=digest(forged.descriptor);host.fence();host.stop();assert.throws(()=>host.install(forged,'bad'),/descriptor/);host.install(b,'g2');host.start({h1:b.binding,h2:b.binding});host.open();const before=rows(db,'b');assert.throws(()=>host.write(stale.route,1,'stale'),/retired/);assert.deepEqual(rows(db,'b'),before);
 // Remove non-reuse/retirement policy to exhibit the same unsafe carrier-independent outcome.
 host.routes.set('g1',{artifact:b,retired:false});host.write('g1',1,'unsafe');assert.equal(rows(db,'b').find(r=>r.title==='unsafe').id,2);}
});
