import { it, expect } from 'vitest';
import * as helpers from '../phase-a/native-owned-user.mjs';
const stats=[{type:'table',name:'sqlite_stat1',tbl_name:'sqlite_stat1',sql:'CREATE TABLE sqlite_stat1(tbl,idx,stat)'},{type:'table',name:'sqlite_stat4',tbl_name:'sqlite_stat4',sql:'CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)'}];
const app={type:'table',name:'owned',tbl_name:'owned',sql:'CREATE TABLE owned(id BLOB)'};
const state=(schema:unknown)=>({schema,config:'private-config',unrelatedIdentities:['private-user'],unrelatedSessions:['private-session']});
it('L1-17 schema metadata guard accepts only newly added exact canonical stats and reports raw change, unchanged preexisting stats',()=>{
  for(const added of [[],[stats[0]],[stats[1]],stats]){const result=helpers.compareNativeSchema([app],[app,...added]);expect(result).toEqual({rawSchemaChanged:added.length>0,prohibitedSchemaChange:false,allowedBookkeepingAdded:added.map(row=>row.name)});}
  expect(helpers.compareNativeSchema([app,...stats],[app,...stats])).toEqual({rawSchemaChanged:false,prohibitedSchemaChange:false,allowedBookkeepingAdded:[]});
  expect(helpers.compareNativeSchema([app,stats[0]],[app,...stats]).allowedBookkeepingAdded).toEqual(['sqlite_stat4']);
});
it('L1-17 schema metadata guard rejects every app/internal object addition/drop/modification even alongside canonical stats',()=>{
  for(const type of ['table','index','trigger','view'])for(const name of ['application','sqlite_other']){const row={type,name,tbl_name:'owned',sql:`CREATE ${type} ${name}`};for(const [before,after] of [[[app],[app,row]],[[app,row],[app]],[[app,row],[app,{...row,sql:row.sql+' changed'}]]]){expect(helpers.compareNativeSchema(before,after).prohibitedSchemaChange).toBe(true);expect(helpers.compareNativeSchema(before,[...after,...stats]).prohibitedSchemaChange).toBe(true);}}
  for(const stat of stats)expect(helpers.compareNativeSchema([app,stat],[app]).prohibitedSchemaChange).toBe(true);
});
it('L1-17 reserved statistics own4 canonical records required in either snapshot, duplicates and malformed records never silently collapse',()=>{
  for(const stat of stats){for(const field of ['type','name','tbl_name','sql'] as const){const wrong={...stat,[field]:field==='type'?'index':stat[field]+' '};for(const [before,after] of [[[app],[app,wrong]],[[app,wrong],[app,wrong]],[[app,stat],[app,wrong]]]){try{expect(helpers.compareNativeSchema(before,after).prohibitedSchemaChange).toBe(true);}catch(error){if(error instanceof TypeError)expect(error.message).not.toContain(stat.sql);else throw error;}}}
    for(const bad of [{...stat,name:stat.name.toUpperCase(),tbl_name:stat.tbl_name.toUpperCase()}, {...stat,extra:'private'}, {...stat,sql:stat.sql.toLowerCase()}, {...stat,sql:null},Object.assign(Object.create({type:stat.type}),{name:stat.name,tbl_name:stat.tbl_name,sql:stat.sql})])for(const side of [false,true])expect(()=>helpers.compareNativeSchema(side?[app,bad]:[app],side?[app,bad]:[app,bad])).toThrow(TypeError);
    expect(()=>helpers.compareNativeSchema([app,stat,stat],[app,stat])).toThrow(TypeError);expect(()=>helpers.compareNativeSchema([app],[app,stat,stat])).toThrow(TypeError);
  }
  for(const value of [null,{},[null],[{type:'table'}]])expect(()=>helpers.compareNativeSchema(value,[])).toThrow(TypeError);
  const autoIndex={type:'index',name:'sqlite_autoindex_owned_1',tbl_name:'owned',sql:null};expect(helpers.compareNativeSchema([app,autoIndex],[app,autoIndex]).prohibitedSchemaChange).toBe(false);expect(helpers.compareNativeSchema([app],[app,autoIndex]).prohibitedSchemaChange).toBe(true);
});
it('L1-17 allowed bookkeeping cannot mask protected config/identity/session changes, public report never contains secret metadata values',()=>{
  const before=state([app]),after=state([app,...stats]);const report=helpers.changedNativeState(before,after);expect(report).toEqual({rawSchemaChanged:true,prohibitedSchemaChange:false,allowedBookkeepingAdded:['sqlite_stat1','sqlite_stat4'],config:false,unrelatedIdentities:false,unrelatedSessions:false});
  for(const key of ['config','unrelatedIdentities','unrelatedSessions'] as const){const result=helpers.changedNativeState(before,{...after,[key]:'private-changed'});expect(result[key]).toBe(true);expect(JSON.stringify(result)).not.toContain('private');}
});
