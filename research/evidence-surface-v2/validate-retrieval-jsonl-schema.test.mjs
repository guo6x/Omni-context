import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateJsonlFile } from './validate-retrieval-jsonl-schema.mjs';
import { generateDevRetrievalBundle } from './generate-dev-retrieval-store.mjs';

const HERE=path.dirname(new URL(import.meta.url).pathname);

test('generated dev retrieval input and truth satisfy their schemas',()=>{
  const {inputs,truth}=generateDevRetrievalBundle();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'es-v2-retrieval-schema-'));
  const inputFile=path.join(dir,'input.jsonl'),truthFile=path.join(dir,'truth.jsonl');
  fs.writeFileSync(inputFile,inputs.map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(truthFile,truth.map(JSON.stringify).join('\n')+'\n');
  try{
    const a=validateJsonlFile(path.join(HERE,'retrieval-input.schema.json'),inputFile);
    const b=validateJsonlFile(path.join(HERE,'retrieval-truth.schema.json'),truthFile);
    assert.equal(a.valid,true,JSON.stringify(a.failures.slice(0,3)));
    assert.equal(b.valid,true,JSON.stringify(b.failures.slice(0,3)));
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
