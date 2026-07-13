import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVALUATION_FREEZE_AUTHORIZATION,
  loadAndVerifyEvaluationAuthorization,
} from '../src/evaluation-authorization.mjs';
import { configHash, sha256, sha256File } from '../src/integrity.mjs';
import { assertConversationAllowed } from '../src/splits.mjs';

describe('held-out Evaluation Freeze v1 authorization wiring', () => {
  let root;
  let datasetPath;
  let manifestPath;
  const commit = 'a'.repeat(40);
  const config = { retrieval: { top_k: 10 } };
  const answerPrompt = 'answer prompt';
  const judgePrompt = 'judge prompt';

  before(async () => {
    root = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runs', 'auth-'));
    datasetPath = path.join(root, 'synthetic.json');
    manifestPath = path.join(root, 'authorization.json');
    await writeFile(datasetPath, '[{"synthetic":true}]');
    await writeFile(manifestPath, JSON.stringify({
      authorization: EVALUATION_FREEZE_AUTHORIZATION,
      freeze_commit: commit,
      config_hash: configHash(config),
      answer_prompt_hash: sha256(answerPrompt),
      judge_prompt_hash: sha256(judgePrompt),
      dataset_hash: await sha256File(datasetPath),
      issued_at: '2026-07-13T00:00:00.000Z',
    }));
  });

  after(async () => rm(root, { recursive: true, force: true }));

  it('accepts the exact authorization string and all frozen hashes', async () => {
    const authorization = await loadAndVerifyEvaluationAuthorization({
      manifestPath, currentCommit: commit, config, answerPrompt, judgePrompt, datasetPath,
    });
    assert.equal(authorization.authorization, EVALUATION_FREEZE_AUTHORIZATION);
    assert.doesNotThrow(() => assertConversationAllowed({
      split: 'heldout', conversationId: 2, heldoutAuthorization: authorization.authorization,
    }));
  });

  for (const [name, override, pattern] of [
    ['freeze commit', { currentCommit: 'b'.repeat(40) }, /freeze_commit mismatch/],
    ['config', { config: { retrieval: { top_k: 20 } } }, /config_hash mismatch/],
    ['answer prompt', { answerPrompt: 'changed' }, /answer_prompt_hash mismatch/],
    ['judge prompt', { judgePrompt: 'changed' }, /judge_prompt_hash mismatch/],
  ]) {
    it(`rejects changed ${name}`, async () => {
      await assert.rejects(() => loadAndVerifyEvaluationAuthorization({
        manifestPath, currentCommit: commit, config, answerPrompt, judgePrompt, datasetPath, ...override,
      }), pattern);
    });
  }

  it('denies a held-out conversation without the verified authorization string', () => {
    assert.throws(() => assertConversationAllowed({ split: 'heldout', conversationId: 2 }), /access denied/);
  });
});
