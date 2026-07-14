import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVALUATION_FREEZE_AUTHORIZATION,
  EVALUATION_FREEZE_BRANCH,
  EVALUATION_FREEZE_TAG,
  loadAndVerifyEvaluationAuthorization,
} from '../../src/evaluation-authorization.mjs';
import { configHash, sha256, sha256File, stableStringify } from '../../src/integrity.mjs';
import { assertConversationAllowed } from '../../src/splits.mjs';

const TESTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'runs');
const COMMIT = 'a'.repeat(40);
const EMBEDDING_REVISION = 'b'.repeat(40);
const PROFILE_HASH = 'c'.repeat(64);
const ANSWER_PROMPT = 'synthetic answer prompt';
const JUDGE_PROMPT = 'synthetic judge prompt';
const CONFIG = { retrieval: { top_k: 10 }, evaluation: { thinking_mode: 'disabled' } };

export const SYNTHETIC_HELDOUT_GATE_CASES = Object.freeze([
  { id: 'missing_authorization', name: 'rejects missing authorization', expected_status: 'rejected', expected_reason: /authorization mismatch/ },
  { id: 'candidate_v2_authorization', name: 'rejects Candidate v2 as authorization', expected_status: 'rejected', expected_reason: /authorization mismatch/ },
  { id: 'wrong_freeze_authorization', name: 'rejects the wrong freeze authorization', expected_status: 'rejected', expected_reason: /authorization mismatch/ },
  { id: 'missing_freeze_tag', name: 'rejects a missing freeze tag', expected_status: 'rejected', expected_reason: /freeze tag .* does not exist/ },
  { id: 'commit_mismatch', name: 'rejects a commit that does not match the tag', expected_status: 'rejected', expected_reason: /current commit does not match/ },
  { id: 'manifest_hash_mismatch', name: 'rejects a manifest hash mismatch', expected_status: 'rejected', expected_reason: /manifest hash mismatch/ },
  { id: 'config_hash_mismatch', name: 'rejects a config hash mismatch', expected_status: 'rejected', expected_reason: /benchmark config hash mismatch/ },
  { id: 'answer_prompt_mismatch', name: 'rejects an Answer Prompt hash mismatch', expected_status: 'rejected', expected_reason: /Answer Prompt hash mismatch/ },
  { id: 'judge_prompt_mismatch', name: 'rejects a Judge Prompt hash mismatch', expected_status: 'rejected', expected_reason: /Judge Prompt hash mismatch/ },
  { id: 'embedding_profile_mismatch', name: 'rejects an Embedding Profile hash mismatch', expected_status: 'rejected', expected_reason: /Embedding Profile hash mismatch/ },
  { id: 'dirty_worktree', name: 'rejects a dirty working tree', expected_status: 'rejected', expected_reason: /working tree is not clean/ },
  { id: 'model_configuration_mismatch', name: 'rejects changed model configuration', expected_status: 'rejected', expected_reason: /model configuration judge mismatch/ },
  { id: 'all_match', name: 'allows the synthetic gate when every frozen value matches', expected_status: 'allowed' },
]);

function tagMessage({ manifestHash }) {
  return [
    `Freeze Name: ${EVALUATION_FREEZE_AUTHORIZATION}`,
    `Freeze Authorization: ${EVALUATION_FREEZE_AUTHORIZATION}`,
    `Freeze Commit: ${COMMIT}`,
    'Freeze Manifest: docs/freeze-v1/omni-context-evaluation-freeze-v1.json',
    `Freeze Manifest SHA-256: ${manifestHash}`,
  ].join('\n');
}

async function createFixture() {
  await mkdir(TESTS_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TESTS_ROOT, 'synthetic-freeze-gate-'));
  const sealedPath = path.join(root, 'docs', 'delivery-v3.2.1', 'candidate-v2-sealed-manifest.json');
  const frozenConfigPath = path.join(root, 'docs', 'delivery-v3.2.1', 'evidence', 'formal-run-config.json');
  const manifestPath = path.join(root, 'docs', 'freeze-v1', 'omni-context-evaluation-freeze-v1.json');
  await Promise.all([
    mkdir(path.dirname(sealedPath), { recursive: true }),
    mkdir(path.dirname(frozenConfigPath), { recursive: true }),
    mkdir(path.dirname(manifestPath), { recursive: true }),
  ]);

  await writeFile(sealedPath, '{"synthetic":true}\n');
  const frozenConfigWithoutHash = {
    benchmark: { benchmark_config_hash: configHash(CONFIG) },
    embedding: { revision: EMBEDDING_REVISION, dimension: 1024, usage_profile_sha256: PROFILE_HASH },
  };
  const unifiedConfigHash = sha256(stableStringify(frozenConfigWithoutHash));
  await writeFile(frozenConfigPath, `${JSON.stringify({
    ...frozenConfigWithoutHash,
    unified_config_sha256: unifiedConfigHash,
  }, null, 2)}\n`);

  const manifest = {
    schema_version: 1,
    freeze_name: EVALUATION_FREEZE_AUTHORIZATION,
    status: 'frozen',
    freeze_authorization: EVALUATION_FREEZE_AUTHORIZATION,
    freeze_branch: EVALUATION_FREEZE_BRANCH,
    freeze_commit_pending: true,
    freeze_tag: EVALUATION_FREEZE_TAG,
    candidate: {
      tag: 'evaluation-freeze-candidate-v2',
      commit: 'd'.repeat(40),
      sealed_manifest_path: 'docs/delivery-v3.2.1/candidate-v2-sealed-manifest.json',
      sealed_manifest_sha256: await sha256File(sealedPath),
    },
    models: {
      extraction: 'deepseek-v4-flash',
      answer: 'deepseek-v4-flash',
      judge: 'deepseek-v4-flash',
      embedding: 'Xenova/multilingual-e5-large',
      embedding_revision: EMBEDDING_REVISION,
      embedding_dimension: 1024,
      embedding_mode: 'local',
      thinking_mode: 'disabled',
      extraction_max_attempts: 3,
      transformers_offline: true,
    },
    hashes: {
      config: unifiedConfigHash,
      answer_prompt: sha256(ANSWER_PROMPT),
      judge_prompt: sha256(JUDGE_PROMPT),
      embedding_profile: PROFILE_HASH,
    },
    held_out: {
      conversations: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      accessed_before_freeze: false,
      authorization_required: EVALUATION_FREEZE_AUTHORIZATION,
      allowed_after_tag: true,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    root,
    manifest,
    manifestPath,
    frozenConfigPath,
    options: {
      authorization: EVALUATION_FREEZE_AUTHORIZATION,
      manifestPath,
      repoRoot: root,
      config: CONFIG,
      answerPrompt: ANSWER_PROMPT,
      judgePrompt: JUDGE_PROMPT,
      environment: {
        LLM_MODEL: 'deepseek-v4-flash',
        ANSWER_MODEL: 'deepseek-v4-flash',
        JUDGE_MODEL: 'deepseek-v4-flash',
        EMBEDDING_LOCAL_MODEL: 'Xenova/multilingual-e5-large',
        EMBEDDING_MODE: 'local',
        LLM_THINKING_MODE: 'disabled',
        LLM_EXTRACTION_MAX_ATTEMPTS: '3',
        TRANSFORMERS_OFFLINE: '1',
      },
      repositoryState: {
        tagExists: true,
        tagAnnotated: true,
        tagCommit: COMMIT,
        currentCommit: COMMIT,
        workingTreeClean: true,
        tagMessage: tagMessage({ manifestHash: await sha256File(manifestPath) }),
      },
    },
  };
}

async function rewriteManifest(fixture) {
  await writeFile(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
  fixture.options.repositoryState.tagMessage = tagMessage({ manifestHash: await sha256File(fixture.manifestPath) });
}

export async function executeSyntheticHeldOutGateCase(id) {
  const fixture = await createFixture();
  try {
    switch (id) {
      case 'missing_authorization': fixture.options.authorization = undefined; break;
      case 'candidate_v2_authorization': fixture.options.authorization = 'evaluation-freeze-candidate-v2'; break;
      case 'wrong_freeze_authorization': fixture.options.authorization = 'Omni-Context Evaluation Freeze v2'; break;
      case 'missing_freeze_tag': fixture.options.repositoryState.tagExists = false; break;
      case 'commit_mismatch': fixture.options.repositoryState.currentCommit = 'e'.repeat(40); break;
      case 'manifest_hash_mismatch':
        fixture.options.repositoryState.tagMessage = tagMessage({ manifestHash: 'f'.repeat(64) });
        break;
      case 'config_hash_mismatch': fixture.options.config = { ...CONFIG, retrieval: { top_k: 20 } }; break;
      case 'answer_prompt_mismatch': fixture.options.answerPrompt = 'changed answer prompt'; break;
      case 'judge_prompt_mismatch': fixture.options.judgePrompt = 'changed judge prompt'; break;
      case 'embedding_profile_mismatch':
        fixture.manifest.hashes.embedding_profile = '0'.repeat(64);
        await rewriteManifest(fixture);
        break;
      case 'dirty_worktree': fixture.options.repositoryState.workingTreeClean = false; break;
      case 'model_configuration_mismatch': fixture.options.environment.JUDGE_MODEL = 'changed-judge'; break;
      case 'all_match': break;
      default: throw new Error(`Unknown synthetic gate case: ${id}`);
    }

    try {
      const authorization = await loadAndVerifyEvaluationAuthorization(fixture.options);
      assertConversationAllowed({
        split: 'heldout',
        conversationId: 2,
        heldoutAuthorization: authorization.authorization,
      });
      return {
        id,
        status: 'allowed',
        authorization: authorization.authorization,
        heldout_dataset_created: false,
      };
    } catch (error) {
      return {
        id,
        status: 'rejected',
        reason: error instanceof Error ? error.message : String(error),
        heldout_dataset_created: false,
      };
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}
