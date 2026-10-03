import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompareOp } from 'trailbase';
import { context, confirmedTrailUser, confirmedSupabaseUser, nativeUuid, canonicalUuid } from './helpers.js';

let native: Awaited<ReturnType<typeof confirmedTrailUser>>;
let reference: Awaited<ReturnType<typeof confirmedSupabaseUser>>;
const priorities=[0,1,1,3], words=['alpha','bravo','charlie','delta'];
const literal="&+%='[],/雪e\u0301? #";
const ids=priorities.map(()=>randomUUID()), suffix=randomUUID();
const expected=(indices: number[])=>indices.map(i=>ids[i]);
beforeAll(async()=>{
  const env=await context();
  native=await confirmedTrailUser(env,'domains'); reference=await confirmedSupabaseUser(env,'domains');
  for(let i=0;i<ids.length;i++) {
    const fields={title:`${words[i]}-${suffix}`,priority:priorities[i],completed:i%2===1,note:i===0?null:i===2?'other':literal};
    await native.client.records('todos').create({...fields,id:nativeUuid(ids[i]),user_id:native.user.id});
    expect((await reference.client.from('todos').insert({...fields,id:ids[i],user_id:reference.user.id})).error).toBeNull();
  }
});
describe('L1-27 G2/G4/I09 upstream scalar-domain characterization, NOT adapter signoff',()=>{
  it('all six numeric comparisons produce exact golden IDs, including tied priorities',async()=>{
    const query=()=>reference.client.from('todos').select('*');
    const cases: [CompareOp,ReturnType<typeof query>,number[]][]=[
      ['equal',query().eq('priority',1),[1,2]],['notEqual',query().neq('priority',1),[0,3]],['greaterThan',query().gt('priority',1),[3]],
      ['greaterThanEqual',query().gte('priority',1),[1,2,3]],['lessThan',query().lt('priority',1),[0]],['lessThanEqual',query().lte('priority',1),[0,1,2]],
    ];
    for(const[nativeOp,referenceQuery,indices]of cases) {
      const rows=(await native.client.records('todos').list({filters:[{column:'priority',op:nativeOp,value:'1'}],pagination:{limit:1000}})).records;
      const result=await referenceQuery;
      expect(result.error).toBeNull();
      expect(rows.map(row=>canonicalUuid(String(row.id))).sort()).toEqual(expected(indices).sort());
      expect(result.data?.map(row=>row.id).sort()).toEqual(expected(indices).sort());
    }
  });
  it('reserved characters, Unicode and combining marks remain literal rather than altering query predicates',async()=>{
    const rows=(await native.client.records('todos').list({filters:[{column:'note',value:literal}]})).records;
    const result=await reference.client.from('todos').select('*').eq('note',literal);
    expect(result.error).toBeNull();
    expect(rows.map(row=>canonicalUuid(String(row.id))).sort()).toEqual(expected([1,3]).sort());
    expect(result.data?.map(row=>row.id).sort()).toEqual(expected([1,3]).sort());
    expect(rows.every(row=>row.note===literal)).toBe(true);
    expect(result.data?.every(row=>row.note===literal)).toBe(true);
  });
  it('inequality excludes null, and explicitly declared boolean/UUID filters select only intended rows',async()=>{
    const api=native.client.records('todos');
    const notEqual=(await api.list({filters:[{column:'note',op:'notEqual',value:literal}]})).records;
    const rn=await reference.client.from('todos').select('*').neq('note',literal);
    expect(rn.error).toBeNull();
    expect(notEqual.map(row=>canonicalUuid(String(row.id)))).toEqual(expected([2]));
    expect(rn.data?.map(row=>row.id)).toEqual(expected([2]));
    const completed=(await api.list({filters:[{column:'completed',value:'1'}]})).records;
    const rc=await reference.client.from('todos').select('*').eq('completed',true);
    expect(rc.error).toBeNull();
    expect(completed.map(row=>canonicalUuid(String(row.id))).sort()).toEqual(expected([1,3]).sort());
    expect(rc.data?.map(row=>row.id).sort()).toEqual(expected([1,3]).sort());
    const uuid=(await api.list({filters:[{column:'id',value:nativeUuid(ids[0])}]})).records;
    const ru=await reference.client.from('todos').select('*').eq('id',ids[0]);
    expect(ru.error).toBeNull();
    expect(uuid.map(row=>canonicalUuid(String(row.id)))).toEqual(expected([0]));
    expect(ru.data?.map(row=>row.id)).toEqual(expected([0]));
  });
  it('numeric ties use an explicit key tiebreaker; lowercase ASCII words sort identically in both directions',async()=>{
    for(const ascending of [true,false]) {
      const key=ascending?'+':'-';
      const rows=(await native.client.records('todos').list({order:[`${key}priority`,'+id']})).records;
      const result=await reference.client.from('todos').select('*').order('priority',{ascending}).order('id');
      const sorted=[0,1,2,3].sort((a,b)=>(ascending?1:-1)*(priorities[a]-priorities[b])||(ids[a]<ids[b]?-1:1));
      expect(result.error).toBeNull();
      expect(rows.map(row=>canonicalUuid(String(row.id)))).toEqual(expected(sorted));
      expect(result.data?.map(row=>row.id)).toEqual(expected(sorted));
      const text=(await native.client.records('todos').list({order:[`${key}title`]})).records;
      const rt=await reference.client.from('todos').select('*').order('title',{ascending});
      expect(rt.error).toBeNull();
      const order=ascending?[0,1,2,3]:[3,2,1,0];
      expect(text.map(row=>canonicalUuid(String(row.id)))).toEqual(expected(order));
      expect(rt.data?.map(row=>row.id)).toEqual(expected(order));
    }
  });
});
