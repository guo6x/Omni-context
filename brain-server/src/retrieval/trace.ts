import { createHash, randomUUID } from 'crypto';
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

export interface RetrievalTraceStageItem {
  id: string;
  rank: number;
  distance?: number | null;
  score?: number;
  drop_reason?: string;
}

export interface RetrievalTraceInput {
  traceDirectory?: string;
  query: string;
  temporalMode: string;
  stages: Record<string, RetrievalTraceStageItem[]>;
  candidatePool: Array<Record<string, unknown>>;
  finalContext: Array<Record<string, unknown>>;
}

export type RetrievalTraceResult =
  | { status: 'disabled' }
  | { status: 'written'; trace_id: string; path: string }
  | { status: 'failed'; trace_id: string; error: string };

function finiteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeStageItem(item: RetrievalTraceStageItem): Record<string, unknown> {
  return {
    id: String(item.id).slice(0, 500),
    rank: Math.max(1, Math.floor(item.rank)),
    ...(finiteNumber(item.distance) !== undefined ? { distance: finiteNumber(item.distance) } : {}),
    ...(finiteNumber(item.score) !== undefined ? { score: finiteNumber(item.score) } : {}),
    ...(item.drop_reason ? { drop_reason: String(item.drop_reason).slice(0, 200) } : {}),
  };
}

function sanitizeCandidate(item: Record<string, unknown>): Record<string, unknown> {
  const allowed = ['id', 'type', 'fused_score', 'fused_rank', 'final_rank', 'evidence_id', 'sources'];
  return Object.fromEntries(allowed.filter((key) => key in item).map((key) => [key, item[key]]));
}

/** Evaluation-only, fail-open local trace. Query text and evidence text are never persisted. */
export async function writeRetrievalTrace(input: RetrievalTraceInput): Promise<RetrievalTraceResult> {
  const traceDirectory = input.traceDirectory || process.env.OMNI_EVALUATION_TRACE_DIR;
  if (!traceDirectory) return { status: 'disabled' };
  const traceId = randomUUID();
  try {
    await mkdir(traceDirectory, { recursive: true });
    const outputPath = path.join(traceDirectory, 'retrieval-trace.jsonl');
    const stages = Object.fromEntries(Object.entries(input.stages).map(([name, items]) => [
      name.slice(0, 100),
      items.slice(0, 500).map(sanitizeStageItem),
    ]));
    const payload = {
      trace_version: 'retrieval-trace-v1',
      trace_id: traceId,
      created_at: new Date().toISOString(),
      query_sha256: createHash('sha256').update(input.query).digest('hex'),
      temporal_mode: String(input.temporalMode).slice(0, 40),
      stages,
      candidate_pool: input.candidatePool.slice(0, 500).map(sanitizeCandidate),
      final_context: input.finalContext.slice(0, 100).map(sanitizeCandidate),
    };
    await appendFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', flag: 'a' });
    return { status: 'written', trace_id: traceId, path: outputPath };
  } catch (error) {
    return {
      status: 'failed',
      trace_id: traceId,
      error: error instanceof Error ? error.message.slice(0, 500) : 'unknown trace error',
    };
  }
}
