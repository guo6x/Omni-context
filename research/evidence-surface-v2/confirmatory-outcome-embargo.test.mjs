import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const workflow=path.join(ROOT,'.github/workflows/research-evidence-v2-confirmatory-structure.yml');

test('confirmatory structure workflow has no outcome runners',()=>{
  const text=fs.readFileSync(workflow,'utf8');
  const forbidden=[
    'run-dev-policy-monitor.mjs',
    'evaluate-paired-world-policies.mjs',
    'evaluate-independent-policy-v1.mjs',
    'policy-currentness-first.mjs',
    'evaluate-monitor-stress.mjs',
    'openai',
    'anthropic',
    'gemini',
    'ollama',
    'litellm'
  ];
  for(const token of forbidden){
    assert.equal(text.toLowerCase().includes(token.toLowerCase()),false,'forbidden confirmatory outcome/runtime token: '+token);
  }
  for(const required of [
    'generate-confirmatory-candidate.mjs',
    'audit-confirmatory-structure.mjs',
    'make-confirmatory-structure-manifest.mjs',
    'actions/upload-artifact'
  ]){
    assert.equal(text.includes(required),true,'missing structural-only step: '+required);
  }
});

test('confirmatory structure workflow labels artifact as candidate, not result',()=>{
  const text=fs.readFileSync(workflow,'utf8');
  assert.match(text,/confirmatory-structure-candidate/);
  assert.doesNotMatch(text,/confirmatory-results/i);
});
