import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { configHash, sha256, sha256File, stableStringify } from './integrity.mjs';

const execFileAsync = promisify(execFile);

export const EVALUATION_FREEZE_AUTHORIZATION = 'Omni-Context Evaluation Freeze v1';
export const EVALUATION_FREEZE_TAG = 'omni-context-evaluation-freeze-v1';
export const EVALUATION_FREEZE_BRANCH = 'codex/omni-context-evaluation-freeze-v1';

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CommitSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const FinalFreezeManifestSchema = z.object({
  schema_version: z.literal(1),
  freeze_name: z.literal(EVALUATION_FREEZE_AUTHORIZATION),
  status: z.literal('frozen'),
  freeze_authorization: z.literal(EVALUATION_FREEZE_AUTHORIZATION),
  freeze_branch: z.literal(EVALUATION_FREEZE_BRANCH),
  freeze_commit_pending: z.literal(true),
  freeze_tag: z.literal(EVALUATION_FREEZE_TAG),
  candidate: z.object({
    tag: z.literal('evaluation-freeze-candidate-v2'),
    commit: CommitSchema,
    sealed_manifest_path: z.string().min(1),
    sealed_manifest_sha256: HashSchema,
  }),
  models: z.object({
    extraction: z.string().min(1),
    answer: z.string().min(1),
    judge: z.string().min(1),
    embedding: z.string().min(1),
    embedding_revision: CommitSchema,
    embedding_dimension: z.number().int().positive(),
    embedding_mode: z.literal('local'),
    thinking_mode: z.literal('disabled'),
    extraction_max_attempts: z.literal(3),
    transformers_offline: z.literal(true),
  }),
  hashes: z.object({
    config: HashSchema,
    answer_prompt: HashSchema,
    judge_prompt: HashSchema,
    embedding_profile: HashSchema,
  }).passthrough(),
  held_out: z.object({
    conversations: z.tuple([
      z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6),
      z.literal(7), z.literal(8), z.literal(9), z.literal(10),
    ]),
    accessed_before_freeze: z.literal(false),
    authorization_required: z.literal(EVALUATION_FREEZE_AUTHORIZATION),
    allowed_after_tag: z.literal(true),
  }),
}).passthrough();

function fail(message) {
  throw new Error(`Held-out access denied: ${message}`);
}

function parseTagMessage(message) {
  const fields = new Map();
  for (const line of String(message).split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return fields;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function inspectFreezeRepositoryState({ repoRoot, freezeTag = EVALUATION_FREEZE_TAG }) {
  let tagType;
  try {
    ({ stdout: tagType } = await execFileAsync('git', ['-C', repoRoot, 'cat-file', '-t', `refs/tags/${freezeTag}`]));
  } catch {
    return {
      tagExists: false,
      tagAnnotated: false,
      tagCommit: null,
      tagMessage: '',
      workingTreeClean: false,
    };
  }

  if (tagType.trim() !== 'tag') {
    const [{ stdout: tagCommit }, { stdout: currentCommit }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['-C', repoRoot, 'rev-parse', `refs/tags/${freezeTag}^{}`]),
      execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD']),
      execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=normal']),
    ]);
    return {
      tagExists: true,
      tagAnnotated: false,
      tagCommit: tagCommit.trim(),
      currentCommit: currentCommit.trim(),
      tagMessage: '',
      workingTreeClean: status.trim().length === 0,
    };
  }

  const [{ stdout: tagCommit }, { stdout: currentCommit }, { stdout: tagObject }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['-C', repoRoot, 'rev-parse', `refs/tags/${freezeTag}^{}`]),
    execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD']),
    execFileAsync('git', ['-C', repoRoot, 'cat-file', 'tag', `refs/tags/${freezeTag}`]),
    execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=normal']),
  ]);
  const blankLine = tagObject.search(/\r?\n\r?\n/);
  return {
    tagExists: true,
    tagAnnotated: true,
    tagCommit: tagCommit.trim(),
    currentCommit: currentCommit.trim(),
    tagMessage: blankLine >= 0 ? tagObject.slice(blankLine).trim() : '',
    workingTreeClean: status.trim().length === 0,
  };
}

export async function loadAndVerifyEvaluationAuthorization({
  authorization,
  manifestPath,
  repoRoot,
  config,
  answerPrompt,
  judgePrompt,
  environment = process.env,
  repositoryState,
}) {
  if (authorization !== EVALUATION_FREEZE_AUTHORIZATION) fail('authorization mismatch.');
  if (!manifestPath) fail('--authorization-manifest <path> is required.');

  let raw;
  try {
    raw = await readJson(manifestPath);
  } catch (error) {
    fail(`freeze manifest could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = FinalFreezeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    fail(`freeze manifest validation failed: ${details}`);
  }
  const manifest = parsed.data;
  const state = repositoryState || await inspectFreezeRepositoryState({ repoRoot, freezeTag: manifest.freeze_tag });

  if (!state.tagExists) fail(`freeze tag ${manifest.freeze_tag} does not exist.`);
  if (!state.tagAnnotated) fail(`freeze tag ${manifest.freeze_tag} is not annotated.`);
  if (!state.workingTreeClean) fail('working tree is not clean.');

  const tagFields = parseTagMessage(state.tagMessage);
  if (tagFields.get('Freeze Name') !== EVALUATION_FREEZE_AUTHORIZATION) fail('tag Freeze Name mismatch.');
  if (tagFields.get('Freeze Authorization') !== EVALUATION_FREEZE_AUTHORIZATION) fail('tag authorization mismatch.');
  if (tagFields.get('Freeze Commit') !== state.tagCommit) fail('tag Freeze Commit mismatch.');
  if (tagFields.get('Freeze Manifest') !== 'docs/freeze-v1/omni-context-evaluation-freeze-v1.json') {
    fail('tag Freeze Manifest path mismatch.');
  }
  const taggedManifestHash = tagFields.get('Freeze Manifest SHA-256');
  if (!HashSchema.safeParse(taggedManifestHash).success) fail('tagged manifest hash is missing or invalid.');
  const actualManifestHash = await sha256File(manifestPath);
  if (actualManifestHash !== taggedManifestHash) fail('manifest hash mismatch.');

  const currentCommit = state.currentCommit;
  if (currentCommit !== state.tagCommit) fail('current commit does not match tagged freeze commit.');

  const sealedManifestPath = path.resolve(repoRoot, manifest.candidate.sealed_manifest_path);
  if (await sha256File(sealedManifestPath) !== manifest.candidate.sealed_manifest_sha256) {
    fail('Candidate v2 sealed manifest hash mismatch.');
  }

  const frozenConfigPath = path.resolve(repoRoot, 'docs/delivery-v3.2.1/evidence/formal-run-config.json');
  const frozenConfig = await readJson(frozenConfigPath);
  const declaredUnifiedHash = frozenConfig.unified_config_sha256;
  const configForHash = { ...frozenConfig };
  delete configForHash.unified_config_sha256;
  const actualUnifiedHash = sha256(stableStringify(configForHash));
  if (declaredUnifiedHash !== actualUnifiedHash || manifest.hashes.config !== actualUnifiedHash) {
    fail('config hash mismatch.');
  }
  if (configHash(config) !== frozenConfig.benchmark?.benchmark_config_hash) fail('benchmark config hash mismatch.');
  if (sha256(answerPrompt) !== manifest.hashes.answer_prompt) fail('Answer Prompt hash mismatch.');
  if (sha256(judgePrompt) !== manifest.hashes.judge_prompt) fail('Judge Prompt hash mismatch.');
  if (frozenConfig.embedding?.usage_profile_sha256 !== manifest.hashes.embedding_profile) {
    fail('Embedding Profile hash mismatch.');
  }

  const effectiveModels = {
    extraction: environment.LLM_MODEL,
    answer: environment.ANSWER_MODEL || environment.LLM_MODEL,
    judge: environment.JUDGE_MODEL || environment.LLM_MODEL,
    embedding: environment.EMBEDDING_LOCAL_MODEL,
    embedding_mode: environment.EMBEDDING_MODE,
    thinking_mode: environment.LLM_THINKING_MODE || config.evaluation?.thinking_mode,
    extraction_max_attempts: Number(environment.LLM_EXTRACTION_MAX_ATTEMPTS),
    transformers_offline: environment.TRANSFORMERS_OFFLINE === '1',
  };
  for (const [field, expected] of Object.entries({
    extraction: manifest.models.extraction,
    answer: manifest.models.answer,
    judge: manifest.models.judge,
    embedding: manifest.models.embedding,
    embedding_mode: manifest.models.embedding_mode,
    thinking_mode: manifest.models.thinking_mode,
    extraction_max_attempts: manifest.models.extraction_max_attempts,
    transformers_offline: manifest.models.transformers_offline,
  })) {
    if (effectiveModels[field] !== expected) fail(`model configuration ${field} mismatch.`);
  }
  if (frozenConfig.embedding?.revision !== manifest.models.embedding_revision
    || frozenConfig.embedding?.dimension !== manifest.models.embedding_dimension) {
    fail('frozen embedding revision or dimension mismatch.');
  }
  if (environment.OMNI_RETRIEVAL_OVERRIDES) fail('runtime retrieval overrides are forbidden.');
  if (environment.MCP_RERANK_TIMEOUT_MS && environment.MCP_RERANK_TIMEOUT_MS !== '2500') {
    fail('reranker timeout does not match the frozen default.');
  }
  if (environment.MCP_EMBEDDING_TIMEOUT_MS && environment.MCP_EMBEDDING_TIMEOUT_MS !== '2500') {
    fail('embedding timeout does not match the frozen default.');
  }

  return {
    authorization: EVALUATION_FREEZE_AUTHORIZATION,
    freeze_tag: manifest.freeze_tag,
    freeze_commit: state.tagCommit,
    manifest_path: manifestPath,
    manifest_sha256: actualManifestHash,
    config_hash: actualUnifiedHash,
    answer_prompt_hash: manifest.hashes.answer_prompt,
    judge_prompt_hash: manifest.hashes.judge_prompt,
    embedding_profile_hash: manifest.hashes.embedding_profile,
  };
}
