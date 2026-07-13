import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStatistics, computeComposite } from './judge/schema.mjs';
import { readRun } from './run-store.mjs';

/**
 * Recompute all metrics from JSONL records.
 * Uses computeStatistics for per-metric means, CI, subsets, categories, conversations.
 */
export function recomputeMetrics(records) {
  return computeStatistics(records);
}

export async function recomputeRun(runDir) {
  const { records } = await readRun(runDir);
  const metrics = {
    recomputed_at: new Date().toISOString(),
    ...recomputeMetrics(records),
  };
  await writeFile(path.join(runDir, 'metrics.recomputed.json'), `${JSON.stringify(metrics, null, 2)}\n`, { flag: 'wx' });
  return metrics;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('Usage: node src/recompute-metrics.mjs <run-directory>');
  const result = await recomputeRun(path.resolve(runDir));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
