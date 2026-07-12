import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = [
  'binary_accuracy', 'factual_score', 'temporal_score', 'contextual_score',
  'abstention_accuracy', 'evidence_precision', 'stale_memory_leakage', 'latency_ms',
];

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function recomputeMetrics(records) {
  const completed = records.filter((record) => record.status === 'completed');
  const result = Object.fromEntries(METRICS.map((metric) => [metric, mean(completed.map((r) => r.metrics?.[metric]).filter(Number.isFinite))]));
  const subset = (name) => completed.filter((record) => record.subset === name);
  const subsetAccuracy = (name) => mean(subset(name).map((r) => r.metrics?.binary_accuracy).filter(Number.isFinite));
  const factual = result.factual_score ?? 0;
  const temporal = result.temporal_score ?? 0;
  const contextual = result.contextual_score ?? 0;
  const abstention = result.abstention_accuracy ?? 0;
  const evidence = result.evidence_precision ?? 0;
  const stale = result.stale_memory_leakage ?? 0;
  return {
    schema_version: 1,
    ...result,
    omni_composite_score: (factual + temporal + contextual + abstention + evidence + (1 - stale)) / 6,
    answerable_only: subsetAccuracy('answerable'),
    adversarial_only: subsetAccuracy('adversarial'),
    questions_completed: completed.length,
    failures: records.filter((record) => record.status === 'error').length,
    retries: records.filter((record) => record.status === 'retry').length,
  };
}

export async function recomputeRun(runDir) {
  const raw = await readFile(path.join(runDir, 'results.jsonl'), 'utf8');
  const records = raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const metrics = { recomputed_at: new Date().toISOString(), ...recomputeMetrics(records) };
  await writeFile(path.join(runDir, 'metrics.recomputed.json'), `${JSON.stringify(metrics, null, 2)}\n`, { flag: 'wx' });
  return metrics;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('Usage: node src/recompute-metrics.mjs <run-directory>');
  const result = await recomputeRun(path.resolve(runDir));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
