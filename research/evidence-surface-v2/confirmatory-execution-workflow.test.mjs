import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const workflow=path.join(ROOT,'.github/workflows/research-evidence-v2-confirmatory-execution.yml');

test('confirmatory execution workflow is request-gated and read-only',()=>{
  const text=fs.readFileSync(workflow,'utf8');
  assert.match(text,/EXECUTION_REQUEST\.json/);
  assert.doesNotMatch(text,/workflow_dispatch/);
  assert.match(text,/contents:\s*read/);
  assert.doesNotMatch(text,/contents:\s*write/);
});

test('authorization validation occurs before any outcome-producing command',()=>{
  const text=fs.readFileSync(workflow,'utf8');
  const auth=text.indexOf('Validate execution authorization before outcomes');
  const paired=text.indexOf('run-paired-surface-matrix.mjs');
  const retrieval=text.indexOf('run-dev-retrievers.py');
  assert.ok(auth>=0&&paired>auth&&retrieval>auth);
  assert.ok(text.indexOf('validate-execution-authorization.mjs')>auth);
  assert.ok(text.indexOf('validate-execution-authorization.mjs')<paired);
});

test('workflow freezes LLM replication off and uses the frozen corpus/matrix',()=>{
  const text=fs.readFileSync(workflow,'utf8').toLowerCase();
  assert.match(text,/validate-execution-authorization\.mjs/);
  assert.match(text,/confirmatory\/frozen\/paired-worlds\.jsonl/);
  assert.match(text,/execution_matrix\.json/i);
  for(const token of ['openai','anthropic','gemini','ollama','litellm']){
    assert.equal(text.includes(token),false,'unexpected LLM provider token '+token);
  }
});

test('partial artifacts remain available after execution failure',()=>{
  const text=fs.readFileSync(workflow,'utf8');
  assert.match(text,/name: Upload confirmatory results or partial failure evidence\s+if: always\(\)/);
  assert.match(text,/if-no-files-found: warn/);
});

test('result hash manifest does not hash itself',()=>{
  const text=fs.readFileSync(workflow,'utf8');
  assert.match(text,/! -name RESULT_HASHES\.txt/);
  assert.match(text,/sort -z \| xargs -0 -r sha256sum/);
});
