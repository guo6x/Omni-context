import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function typeOk(t,v){
  if(t==='null')return v===null;
  if(t==='array')return Array.isArray(v);
  if(t==='object')return v!==null&&typeof v==='object'&&!Array.isArray(v);
  if(t==='integer')return Number.isInteger(v);
  if(t==='number')return typeof v==='number'&&Number.isFinite(v);
  return typeof v===t;
}
export function validateValue(schema,value,p='root',errors=[]){
  if(schema.const!==undefined&&!Object.is(value,schema.const))errors.push(p+': const mismatch');
  if(schema.enum&&!schema.enum.some(x=>Object.is(x,value)))errors.push(p+': not in enum');
  if(schema.type){
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    if(!types.some(t=>typeOk(t,value))){
      errors.push(p+': type mismatch expected '+types.join('|'));
      return errors;
    }
  }
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&value.length<schema.minLength)errors.push(p+': minLength');
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))errors.push(p+': pattern mismatch');
  }
  if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum)errors.push(p+': below minimum');
    if(schema.maximum!==undefined&&value>schema.maximum)errors.push(p+': above maximum');
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems)errors.push(p+': minItems');
    if(schema.maxItems!==undefined&&value.length>schema.maxItems)errors.push(p+': maxItems');
    if(schema.items)value.forEach((v,i)=>validateValue(schema.items,v,p+'['+i+']',errors));
  }
  if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
    const keys=Object.keys(value);
    if(schema.minProperties!==undefined&&keys.length<schema.minProperties)errors.push(p+': minProperties');
    for(const req of schema.required??[])if(!(req in value))errors.push(p+': missing required '+req);
    if(schema.additionalProperties===false){
      const allowed=new Set(Object.keys(schema.properties??{}));
      for(const k of keys)if(!allowed.has(k))errors.push(p+': additional property '+k);
    }
    for(const [k,sub] of Object.entries(schema.properties??{})){
      if(k in value)validateValue(sub,value[k],p+'.'+k,errors);
    }
  }
  return errors;
}

export function validateJsonDocument(schemaFile,dataFile){
  const schema=JSON.parse(fs.readFileSync(schemaFile,'utf8'));
  const value=JSON.parse(fs.readFileSync(dataFile,'utf8'));
  const errors=validateValue(schema,value,'root',[]);
  return {valid:errors.length===0,errors};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||!process.argv[3]){
    console.error('usage: node validate-json-document-schema.mjs <schema.json> <data.json>');
    process.exit(2);
  }
  const r=validateJsonDocument(path.resolve(process.argv[2]),path.resolve(process.argv[3]));
  console.log(JSON.stringify(r,null,2));
  if(!r.valid)process.exit(1);
}
