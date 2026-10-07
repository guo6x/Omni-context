import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const F=path.join(HERE,'confirmatory/frozen');
const record=JSON.parse(fs.readFileSync(path.join(F,'FREEZE_RECORD.json'),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('frozen corpus bytes match recorded SHA',()=>{
  assert.equal(
    sha(path.join(F,'paired-worlds.jsonl')),
    '944ab3ddf3726bc54f10d5336fc3a6fdab2cb95c5d2049db6c861259b25b755d'
  );
  assert.equal(sha(path.join(F,'paired-worlds.jsonl')),record.frozen_corpus_sha256);
});

test('freeze record keeps confirmatory execution unauthorized',()=>{
  assert.equal(record.status,'CORPUS_FROZEN__EXECUTION_NOT_AUTHORIZED');
  assert.equal(record.declarations.confirmatory_execution_authorized,false);
  assert.equal(record.declarations.confirmatory_policy_outcomes_executed_before_freeze,false);
  assert.equal(record.declarations.confirmatory_llm_outputs_executed_before_freeze,false);
});

test('all frozen structural gates are true',()=>{
  for(const [k,v] of Object.entries(record.gates)) assert.equal(v,true,k);
});
