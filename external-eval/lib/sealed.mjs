import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { userInfo } from 'node:os';

export const PRODUCT_COMMIT = '17dc1d0107b0474de84058205a91b302ba290a74';
const SHA256_RE = /^[a-f0-9]{64}$/;
const SHA1_RE = /^[a-f0-9]{40}$/;
const GOLD_KEYS = /^(?:answer|answers|gold|gold_answer|evidence|reference|references|score|label)$/i;

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(file) {
  return sha256Bytes(await readFile(file));
}

export function assertGoldFree(value, at = '$') {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertGoldFree(entry, `${at}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (GOLD_KEYS.test(key)) throw new Error(`GOLD_ISOLATION_VIOLATION:${at}.${key}`);
    assertGoldFree(child, `${at}.${key}`);
  }
}

// --- Authorization Schema v1 (legacy, preserved for backward compatibility) ---

export function validateAuthorization(auth, expected) {
  const required = ['schema_version', 'authorized_by', 'authorized_at', 'expires_at', 'benchmark', 'dataset_variant', 'allowed_subset', 'dataset_sha256', 'product_commit', 'adapter_commit', 'preregistration_sha256', 'allow_formal_run'];
  for (const key of required) if (auth?.[key] === undefined || auth[key] === '') throw new Error(`AUTHORIZATION_INVALID:missing_${key}`);
  if (auth.schema_version !== 1 || auth.allow_formal_run !== true) throw new Error('AUTHORIZATION_INVALID:not_formal');
  if (!SHA256_RE.test(auth.dataset_sha256) || !SHA256_RE.test(auth.preregistration_sha256) || !SHA1_RE.test(auth.product_commit) || !SHA1_RE.test(auth.adapter_commit)) throw new Error('AUTHORIZATION_INVALID:hash_format');
  const authorized = Date.parse(auth.authorized_at);
  const expires = Date.parse(auth.expires_at);
  if (!Number.isFinite(authorized) || !Number.isFinite(expires) || authorized > Date.now() + 300000 || expires <= Date.now()) throw new Error('AUTHORIZATION_EXPIRED');
  for (const [key, value] of Object.entries(expected)) if (value !== undefined && auth[key] !== value) throw new Error(`AUTHORIZATION_MISMATCH:${key}`);
  return auth;
}

export async function loadAuthorization(file, expected) {
  if (!file) throw new Error('HELDOUT_AUTHORIZATION_REQUIRED:OMNI_HELDOUT_AUTHORIZATION_FILE');
  return validateAuthorization(JSON.parse(await readFile(file, 'utf8')), expected);
}

// --- Authorization Schema v2 (phase-separated) ---

const AUTH_V2_REQUIRED = [
  'schema_version', 'authorized_by', 'authorized_at', 'expires_at',
  'benchmark', 'dataset_variant', 'allowed_subset',
  'generation_projection_sha256', 'gold_projection_sha256',
  'product_commit', 'product_build_sha256',
  'adapter_commit', 'engine_adapter_commit', 'formal_runner_commit',
  'preregistration_sha256', 'scoring_preregistration_sha256',
  'scorer_module_sha256', 'judge_prompt_sha256',
  'allow_formal_generation', 'allow_formal_scoring',
];

const AUTH_V2_HASH_FIELDS = [
  'generation_projection_sha256', 'gold_projection_sha256',
  'product_build_sha256', 'preregistration_sha256',
  'scoring_preregistration_sha256', 'scorer_module_sha256', 'judge_prompt_sha256',
];

const AUTH_V2_COMMIT_FIELDS = [
  'adapter_commit', 'engine_adapter_commit', 'formal_runner_commit',
];

/**
 * Validate an Authorization Schema v2 object for a specific phase.
 *
 * Phase 'generation':
 *   - allow_formal_generation must be true
 *   - Verifies generation_projection_sha256, product_commit, adapter_commit,
 *     engine_adapter_commit, formal_runner_commit, preregistration_sha256
 *   - Gold path is NOT read; gold_projection_sha256 is NOT verified
 *
 * Phase 'scoring':
 *   - allow_formal_scoring must be true
 *   - Verifies gold_projection_sha256, result_sha256 (in expected),
 *     scoring_preregistration_sha256, scorer_module_sha256, judge_prompt_sha256
 *   - Product service is NOT started
 *
 * An authorization with allow_formal_generation=true and allow_formal_scoring=false
 * cannot be used for scoring, and vice versa.
 */
export function validateAuthorizationV2(auth, expected, phase) {
  if (phase !== 'generation' && phase !== 'scoring') {
    throw new Error(`AUTHORIZATION_V2_PHASE_INVALID:${String(phase)}`);
  }
  for (const key of AUTH_V2_REQUIRED) {
    if (auth?.[key] === undefined || auth[key] === '') {
      throw new Error(`AUTHORIZATION_V2_INVALID:missing_${key}`);
    }
  }
  if (auth.schema_version !== 2) throw new Error('AUTHORIZATION_V2_INVALID:not_v2');

  for (const key of AUTH_V2_HASH_FIELDS) {
    if (!SHA256_RE.test(auth[key])) throw new Error(`AUTHORIZATION_V2_INVALID:hash_format_${key}`);
  }
  for (const key of AUTH_V2_COMMIT_FIELDS) {
    if (!SHA1_RE.test(auth[key])) throw new Error(`AUTHORIZATION_V2_INVALID:commit_format_${key}`);
  }
  if (auth.product_commit !== PRODUCT_COMMIT) throw new Error('AUTHORIZATION_V2_INVALID:product_commit');

  const authorized = Date.parse(auth.authorized_at);
  const expires = Date.parse(auth.expires_at);
  if (!Number.isFinite(authorized) || !Number.isFinite(expires) || authorized > Date.now() + 300000 || expires <= Date.now()) {
    throw new Error('AUTHORIZATION_V2_EXPIRED');
  }

  if (phase === 'generation') {
    if (auth.allow_formal_generation !== true) throw new Error('AUTHORIZATION_V2_GENERATION_NOT_ALLOWED');
  } else {
    if (auth.allow_formal_scoring !== true) throw new Error('AUTHORIZATION_V2_SCORING_NOT_ALLOWED');
  }

  for (const [key, value] of Object.entries(expected || {})) {
    if (value === undefined) continue;
    if (auth[key] !== value) throw new Error(`AUTHORIZATION_V2_MISMATCH:${key}`);
  }
  return auth;
}

export async function loadAuthorizationV2(file, expected, phase) {
  if (!file) throw new Error('HELDOUT_AUTHORIZATION_REQUIRED:OMNI_HELDOUT_AUTHORIZATION_FILE');
  return validateAuthorizationV2(JSON.parse(await readFile(file, 'utf8')), expected, phase);
}

/**
 * Read Gold bytes, compute SHA-256, compare to expected, then parse.
 * Stops immediately on hash mismatch — before parsing.
 */
export async function readGoldProjection(file, expectedSha256) {
  const bytes = await readFile(file);
  const hash = sha256Bytes(bytes);
  if (hash !== expectedSha256) {
    throw new Error(`GOLD_PROJECTION_SHA256_MISMATCH:expected_${expectedSha256}_actual_${hash}`);
  }
  return { parsed: JSON.parse(bytes.toString('utf8')), sha256: hash, bytes };
}

export async function appendAccessLog(file, event) {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({
    schema_version: 1,
    opened_at: new Date().toISOString(),
    dataset_path_placeholder: `<EXTERNAL_DATA_ROOT>/${basename(event.dataset_path)}`,
    dataset_sha256: event.dataset_sha256,
    file_size: event.file_size,
    dataset_id_count: event.dataset_id_count,
    allowed_subset: event.allowed_subset,
    reader_commit: event.reader_commit,
    pid: process.pid,
    run_user: userInfo().username,
    phase: event.phase,
    accessed_question: event.accessed_question,
    accessed_gold: event.accessed_gold,
  })}\n`, { encoding: 'utf8', flag: 'a' });
}

export async function readGenerationProjection(file, access) {
  const bytes = await readFile(file);
  const hash = sha256Bytes(bytes);
  if (access.expected_sha256 && hash !== access.expected_sha256) throw new Error('DATASET_SHA256_MISMATCH');
  const parsed = JSON.parse(bytes.toString('utf8'));
  assertGoldFree(parsed);
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) throw new Error('GENERATION_DATA_SCHEMA_INVALID');
  const info = await stat(file);
  await appendAccessLog(access.log_path, { ...access, dataset_path: file, dataset_sha256: hash, file_size: info.size, dataset_id_count: records.length, phase: 'generation', accessed_question: true, accessed_gold: false });
  return { records, sha256: hash };
}

export async function lockResults(resultFile, lockFile) {
  const digest = await sha256File(resultFile);
  const lock = { schema_version: 1, result_file: basename(resultFile), result_sha256: digest, locked_at: new Date().toISOString() };
  await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return lock;
}

export async function assertResultsLocked(resultFile, lockFile) {
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  if (lock.result_sha256 !== await sha256File(resultFile)) throw new Error('RESULT_HASH_MISMATCH');
  return lock;
}
