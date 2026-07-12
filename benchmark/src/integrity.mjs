import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export function configHash(config) {
  return sha256(stableStringify(config));
}

export function assertEvaluationEmbeddingMode(status) {
  const mode = String(status?.mode ?? '').toLowerCase();
  const model = String(status?.model ?? '').trim();
  if (!status?.available || mode === 'hash' || mode === 'hash-fallback' || !model) {
    throw new Error('Formal evaluation requires an available semantic embedding model; hash fallback is forbidden.');
  }
}
