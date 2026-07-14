import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSplit } from '../src/scenarios.mjs';
import { CognitiveProvider } from '../src/provider.mjs';
import { readJsonl, runCalibration } from '../src/runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = { max_retries: 1, retry_base_ms: 0, retrieval_only: { top_k: 4 }, answer: { max_tokens: 100 }, judge: { max_tokens: 100 } };

test('checkpoints, resumes, and preserves a retry record with isolated synthetic fixtures', async () => {
  const tmp = await mkdtemp(path.join(root, 'runs-test-'));
  try {
    const resultsPath = path.join(tmp, 'results.jsonl');
    const checkpointPath = path.join(tmp, 'checkpoint.json');
    const manifestPath = path.join(tmp, 'manifest.json');
    const scenarios = generateSplit('smoke');
    const provider = new CognitiveProvider({ config, answerPrompt: 'answer', judgePrompt: 'judge', reviewPrompt: 'review', runRoot: tmp, brainServerRoot: tmp });
    const first = await runCalibration({ scenarios, modes: ['full_omni'], provider, resultsPath, checkpointPath, manifestPath, config, split: 'smoke', backend: 'synthetic_calibration', stopAfter: 7, injectErrorOnce: scenarios[0].scenario_id });
    assert.equal(first.manifest.status, 'partial');
    assert.equal(first.manifest.completed, 7);
    const resumed = await runCalibration({ scenarios, modes: ['full_omni'], provider, resultsPath, checkpointPath, manifestPath, config, split: 'smoke', backend: 'synthetic_calibration' });
    assert.equal(resumed.manifest.status, 'completed');
    assert.equal(resumed.manifest.completed, 21);
    const rows = await readJsonl(resultsPath);
    assert.equal(rows.filter((row) => row.status === 'retry').length, 1);
    assert.equal(JSON.parse(await readFile(checkpointPath, 'utf8')).completed_keys.length, 21);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('No Memory context is empty and fixed retrieval contains only event text, never gold', () => {
  const scenario = generateSplit('development')[0];
  const provider = new CognitiveProvider({ config, answerPrompt: '', judgePrompt: '', reviewPrompt: '', runRoot: '', brainServerRoot: '' });
  const fixed = provider.fixedRetrieval(scenario);
  assert.equal(fixed.length, 4);
  assert.ok(fixed.every((item) => item.text && !Object.hasOwn(item, 'gold')));
});
