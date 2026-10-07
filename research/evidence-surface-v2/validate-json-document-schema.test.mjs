import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValue } from './validate-json-document-schema.mjs';

test('validator enforces nested required, enum, pattern and additionalProperties',()=>{
  const schema={
    type:'object',additionalProperties:false,required:['id','items'],
    properties:{
      id:{type:'string',pattern:'^[a-f0-9]{4}$'},
      items:{type:'array',minItems:1,items:{
        type:'object',additionalProperties:false,required:['kind','ok'],
        properties:{kind:{enum:['A','B']},ok:{type:'boolean'}}
      }}
    }
  };
  assert.deepEqual(validateValue(schema,{id:'a1b2',items:[{kind:'A',ok:true}]},'root',[]),[]);
  const bad=validateValue(schema,{id:'NO',items:[{kind:'C',ok:true,extra:1}]},'root',[]);
  assert.ok(bad.some(x=>x.includes('pattern mismatch')));
  assert.ok(bad.some(x=>x.includes('not in enum')));
  assert.ok(bad.some(x=>x.includes('additional property')));
});
