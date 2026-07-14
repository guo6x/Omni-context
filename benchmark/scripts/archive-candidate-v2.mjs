import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recomputeMetrics } from '../src/recompute-metrics.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const bytes = await readFile(filePath);
  hash.update(bytes);
  return hash.digest('hex');
}

async function writeNew(filePath, value) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, text, { flag: 'wx' });
}

function latestState(records) {
  const latest = new Map();
  const completedCounts = new Map();
  for (const record of records) {
    latest.set(record.question_id, record);
    if (record.status === 'completed') {
      completedCounts.set(record.question_id, (completedCounts.get(record.question_id) || 0) + 1);
    }
  }
  return {
    latest: [...latest.values()],
    duplicateCompleted: [...completedCounts.values()].filter((count) => count > 1).length,
  };
}

function assertNoSecretMaterial(label, text) {
  const forbidden = [
    /Authorization\s*:\s*Bearer\s+\S+/i,
    /(?:api[_-]?key|LLM_API_KEY)\s*[=:]\s*[^\s,}"']+/i,
    /sk-[A-Za-z0-9_-]{16,}/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`${label} contains secret-like material matching ${pattern}`);
  }
}

export async function archiveCandidateV2(runDir) {
  const conversationDir = path.join(runDir, 'conversation-1');
  const [manifestText, resultsText, serverLog] = await Promise.all([
    readFile(path.join(runDir, 'manifest.json'), 'utf8'),
    readFile(path.join(conversationDir, 'results.jsonl'), 'utf8'),
    readFile(path.join(conversationDir, 'server.log'), 'utf8'),
  ]);
  assertNoSecretMaterial('manifest.json', manifestText);
  assertNoSecretMaterial('results.jsonl', resultsText);
  assertNoSecretMaterial('server.log', serverLog);

  const manifest = JSON.parse(manifestText);
  const records = resultsText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const state = latestState(records);
  const completed = state.latest.filter((record) => record.status === 'completed');
  const errors = state.latest.filter((record) => record.status === 'error');
  if (manifest.status !== 'completed') throw new Error(`Run status must be completed, got ${manifest.status}`);
  if (completed.length !== 199 || errors.length !== 0 || state.duplicateCompleted !== 0) {
    throw new Error(`Run is not 199/199 clean: completed=${completed.length} errors=${errors.length} duplicate_completed=${state.duplicateCompleted}`);
  }

  const embedding = manifest.embedding_status;
  const entityManifest = embedding?.index_manifests?.find((item) => item.index_name === 'vec_entities');
  const assertionManifest = embedding?.index_manifests?.find((item) => item.index_name === 'vec_assertions');
  if (!entityManifest || !assertionManifest || embedding?.integrity?.entity?.coverage !== 1
      || embedding?.integrity?.assertion?.coverage !== 1) {
    throw new Error('Final embedding manifests or 100% coverage are missing');
  }

  const dbPath = path.join(conversationDir, 'brain.db');
  const dbHash = await sha256File(dbPath);
  const candidateLines = completed.map((record) => JSON.stringify({
    question_id: record.question_id,
    temporal_query: record.temporal_query,
    fusion_config: record.fusion_config,
    search_methods: record.search_methods,
    candidate_pool: record.candidate_pool,
  })).join('\n') + '\n';
  const contextLines = completed.map((record) => JSON.stringify({
    question_id: record.question_id,
    evidence_ids: record.evidence_ids,
    final_context: record.final_context,
  })).join('\n') + '\n';
  assertNoSecretMaterial('candidate-snapshots.jsonl', candidateLines);
  assertNoSecretMaterial('final-context-snapshots.jsonl', contextLines);

  const metrics = recomputeMetrics(records);
  const recomputed = recomputeMetrics(records);
  const metricsConsistent = stableJson(metrics) === stableJson(recomputed);
  if (!metricsConsistent) throw new Error('Independent metric recomputation differs');

  await Promise.all([
    writeNew(path.join(conversationDir, 'brain.db.sha256'), `${dbHash}  brain.db\n`),
    writeNew(path.join(conversationDir, 'entity-index-manifest.json'), entityManifest),
    writeNew(path.join(conversationDir, 'assertion-index-manifest.json'), assertionManifest),
    writeNew(path.join(conversationDir, 'vector-coverage.json'), embedding.integrity),
    writeNew(path.join(conversationDir, 'candidate-snapshots.jsonl'), candidateLines),
    writeNew(path.join(conversationDir, 'final-context-snapshots.jsonl'), contextLines),
    writeNew(path.join(runDir, 'metrics.json'), { generated_at: new Date().toISOString(), ...metrics }),
    writeNew(path.join(runDir, 'recomputed-metrics.json'), { recomputed_at: new Date().toISOString(), ...recomputed }),
  ]);

  const validation = {
    schema_version: 1,
    run_id: manifest.run_id,
    completed: completed.length,
    errors: errors.length,
    retry_records: records.filter((record) => record.status === 'retry').length,
    duplicate_completed: state.duplicateCompleted,
    brain_db_sha256: dbHash,
    candidate_snapshots: completed.length,
    final_context_snapshots: completed.length,
    entity_coverage: embedding.integrity.entity,
    assertion_coverage: embedding.integrity.assertion,
    metrics_recompute_consistent: metricsConsistent,
    secret_scan: 'passed',
  };
  await writeNew(path.join(runDir, 'archive-validation.json'), validation);
  return validation;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('Usage: node scripts/archive-candidate-v2.mjs <run-directory>');
  const result = await archiveCandidateV2(path.resolve(runDir));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
