// NON-PRODUCTION proposal model. Real in-memory SQLite; NO native/HTTP/auth/ingress implementation.
// Fixed a/b fixtures only; not a general SQL/constraint compiler, hardened metadata parser or deployment controller.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>structuredClone(value);
export function fixture() {
  const db=new DatabaseSync(':memory:');
  for(const [table,key] of [['a','id'],['b','alternate']]) db.exec(`CREATE TABLE ${table}(id INTEGER NOT NULL,alternate INTEGER NOT NULL,title TEXT NOT NULL,_private TEXT NOT NULL DEFAULT 'not-public',PRIMARY KEY(${key})) STRICT; INSERT INTO ${table}(id,alternate,title) VALUES(1,2,'first'),(2,1,'second');`);
  return db;
}
export const semantics=Object.freeze({id:'integer',alternate:'integer',title:'text'});
export const config=table=>({table,excluded:['_private'],insert:['id','alternate','title'],update:['title'],policy:'owner'});
export function codec(name) {
  switch(name) {
    case 'integer': return {storage:'INTEGER',body:'safe-json-integer',path:'safe-decimal',filter:'safe-decimal',output:'safe-integer',ack:'native-decimal-string'};
    case 'text': return {storage:'TEXT',body:'json-string',filter:'literal-string',output:'string'};
    // These two-direction distinctions are protocol facts from BM03–05, NOT executed native codecs here.
    case 'uuid': return {storage:'BLOB',body:'canonical-uuid',path:'canonical-uuid',filter:'padded-base64url',output:'padded-base64url',ack:'padded-base64url'};
    case 'integer-boolean': return {storage:'INTEGER',body:'boolean-json',filter:'integer-0-or-1',output:'integer-0-or-1'};
    case 'json-text-boolean': return {storage:'TEXT',body:'boolean-json',filter:'json-text-true-or-false',output:'boolean-json'};
    default: throw new Error('unresolved codec');
  }
}
export function derive(db,table,declarations,actualConfig) {
  assert(['a','b'].includes(table),'fixed fixture table only');
  assert.equal(actualConfig.table,table,'configuration table binding');
  const columns=db.prepare(`PRAGMA table_info(${table})`).all();
  assert.deepEqual(columns.map(c=>c.name),['id','alternate','title','_private'],'fixed fixture columns');
  assert.deepEqual(actualConfig.excluded,['_private'],'fixed excluded columns');
  const visible=columns.filter(c=>!actualConfig.excluded.includes(c.name));
  assert.deepEqual(Object.keys(declarations).sort(),visible.map(c=>c.name).sort(),'complete declared columns');
  const fields=Object.fromEntries(visible.map(c=>{
    const plan=codec(declarations[c.name]);assert.equal(plan.storage,c.type,'declared storage mismatch');
    // Reject semantics the fixed fixture's constraints do not establish; never infer boolean/UUID intent.
    assert(['integer','text'].includes(declarations[c.name]),'unverified fixture codec');
    return [c.name,{nullable:!c.notnull,codec:plan}];
  }));
  const keys=columns.filter(c=>c.pk);assert.equal(keys.length,1,'single physical PK');assert(keys[0].notnull,'non-null PK');
  for(const list of [actualConfig.insert,actualConfig.update])assert(list.every(c=>Object.hasOwn(fields,c)),'unknown write columns');
  assert(!actualConfig.update.includes(keys[0].name),'PK update forbidden');
  const descriptor={format:1,logicalApi:'todos',primaryKey:keys[0].name,fields,insertColumns:[...actualConfig.insert],updateColumns:[...actualConfig.update]};
  const sql=db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(table).sql;
  // Private binding covers actual DDL/config and declarations. It is intentionally absent from metadata().
  return {table,descriptor,digest:digest(descriptor),binding:digest({sql,columns,actualConfig,declarations})};
}
export function verify(db,artifact,actualConfig=config(artifact.table)) {
  const expected=derive(db,artifact.table,semantics,actualConfig);
  assert.deepEqual(artifact.descriptor,expected.descriptor,'false descriptor');
  assert.equal(artifact.digest,expected.digest,'descriptor digest mismatch');
  assert.equal(artifact.binding,expected.binding,'actual configuration/schema binding mismatch');
  return true;
}
export class Host {
  constructor(db,carrier) {
    assert(['catalog','static'].includes(carrier));this.db=db;this.carrier=carrier;
    this.routes=new Map();this.used=new Set();this.pending=new Map();this.unknown=new Set();
    this.targetReads={read:0,schema:0,delete:0};this.accepted=0;this.serving=false;this.liveHandlers=0;this.current=null;this.staged=null;this.sequence=0;
  }
  install(artifact,route) {
    assert(!this.serving&&this.liveHandlers===0&&this.pending.size===0&&this.unknown.size===0,'all handlers stopped and work confirmed required');
    assert(/^g[1-9][0-9]*$|^bad$/.test(route),'fixed synthetic route identifier');
    assert(!this.used.has(route),'route already used, including retired/never-opened incarnation');
    verify(this.db,artifact);this.used.add(route);this.staged={artifact:copy(artifact),route};
  }
  start(handlers) {
    assert(this.staged&&!this.serving,'staged closed release required');
    // Complete h1/h2 inventory is an ASSUMPTION of this model, not discovered native processes.
    assert.deepEqual(Object.keys(handlers).sort(),['h1','h2'],'handler inventory mismatch');
    assert(Object.values(handlers).every(binding=>binding===this.staged.artifact.binding),'mixed handler binding');
    verify(this.db,this.staged.artifact);this.liveHandlers=2;
  }
  open() {
    assert(this.staged&&this.liveHandlers===2&&this.pending.size===0&&this.unknown.size===0,'verified handlers/work required');
    verify(this.db,this.staged.artifact);
    if(this.current)this.routes.get(this.current).retired=true;
    this.routes.set(this.staged.route,{artifact:copy(this.staged.artifact),retired:false});
    this.current=this.staged.route;this.staged=null;this.serving=true;
  }
  fence() {this.serving=false;}
  stop() {
    assert(!this.serving,'fenced required');assert.equal(this.pending.size,0,'pending work');assert.equal(this.unknown.size,0,'unknown remote outcome');this.liveHandlers=0;
  }
  metadata(actor,operation) {
    assert(this.serving,'fenced');assert(['insert','update'].includes(operation),'modelled operation only');
    assert(actor==='owner'||actor==='createOnly'&&operation==='insert','metadata disclosure denied');
    const artifact=this.routes.get(this.current).artifact;
    const allowed=operation==='insert'?artifact.descriptor.insertColumns:artifact.descriptor.updateColumns;
    const needed=new Set([artifact.descriptor.primaryKey,...allowed]);
    return {format:1,logicalApi:'todos',route:this.current,primaryKey:artifact.descriptor.primaryKey,operation,
      fields:Object.fromEntries(Object.entries(artifact.descriptor.fields).filter(([key])=>needed.has(key)).map(([key,value])=>[key,copy(value)])),writeColumns:[...allowed]};
  }
  accept(route,key,title,actor) {
    assert(this.serving,'fenced');const bound=this.routes.get(route);assert(bound&&!bound.retired,'absent or retired route');
    assert.equal(actor,'owner','native permission model denies update');assert(Number.isSafeInteger(key)&&typeof title==='string');
    const token=++this.sequence;this.pending.set(token,{table:bound.artifact.table,key,title});this.accepted++;return token;
  }
  finish(token,lostReply=false) {
    const operation=this.pending.get(token);assert(operation,'accepted token required');
    // Deliberately NO per-write expected-contract check: stock record-path semantics use the actual PK.
    const key=this.db.prepare(`PRAGMA table_info(${operation.table})`).all().find(c=>c.pk).name;
    this.db.prepare(`UPDATE ${operation.table} SET title=? WHERE ${key}=?`).run(operation.title,operation.key);
    this.pending.delete(token);if(lostReply)this.unknown.add(token);
  }
  insert(route,row,actor) {
    assert(this.serving,'fenced');const bound=this.routes.get(route);assert(bound&&!bound.retired,'absent or retired route');
    assert(['owner','createOnly'].includes(actor),'native permission model denies insert');
    assert.deepEqual(Object.keys(row).sort(),['alternate','id','title'],'fixed insert columns');
    assert(Number.isSafeInteger(row.id)&&Number.isSafeInteger(row.alternate)&&typeof row.title==='string');
    this.db.prepare(`INSERT INTO ${bound.artifact.table}(id,alternate,title) VALUES(?,?,?)`).run(row.id,row.alternate,row.title);this.accepted++;
  }
  write(route,key,title,actor='owner') {this.finish(this.accept(route,key,title,actor));}
  restorePublicationHistory(history) {
    assert([...this.used].every(route=>history.has(route)),'rollbacked non-reuse history refused');this.used=new Set(history);
  }
}
export class MetadataCache {
  put(owner,descriptor) {this.owner=owner;this.descriptor=copy(descriptor);}
  get(owner) {assert(this.descriptor&&owner===this.owner,'metadata owner lifetime mismatch');return copy(this.descriptor);}
  clear() {this.owner=null;this.descriptor=null;}
}
