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
