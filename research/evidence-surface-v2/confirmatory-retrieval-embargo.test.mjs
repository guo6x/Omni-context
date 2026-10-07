import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const workflow=path.join(ROOT,'.github/workflows/research-evidence-v2-confirmatory-retrieval-construction.yml');

test('confirmatory retrieval construction workflow cannot run outcome-producing code',()=>{
  const text=fs.readFileSync(workflow,'utf8').toLowerCase();
  for(const token of [
    'run-dev-retrievers.py',
    'score-dev-retrieval.mjs',
    'execution-kernel.mjs',
    'run-dev-policy-monitor.mjs',
    'evaluate-paired-world-policies.mjs',
    'policy-currentness-first.mjs',
    'monitor-acquisition-ledger.mjs',
    'sentence-transformers',
    'rank-bm25',
    'openai',
    'anthropic',
    'gemini',
    'ollama',
    'litellm'
  ]){
    assert.equal(text.includes(token),false,'forbidden outcome/runtime token: '+token);
  }
  for(const required of [
    'generate-confirmatory-retrieval-bundle.mjs',
    'audit-confirmatory-retrieval-bundle.mjs',
    'actions/upload-artifact'
  ]){
    assert.equal(text.includes(required),true,'missing construction-only step: '+required);
  }
});
