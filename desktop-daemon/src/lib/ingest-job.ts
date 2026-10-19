import { apiFetch } from './api-client';

export interface IngestJob {
  jobId: string;
  status: 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
  stage?: string;
  error?: string;
  importProgress?: { done: number; total: number; entities: number };
  retryProgress?: { done: number; total: number; recovered: number; failed: number; coverage: number };
  result?: {
    entities?: number;
    relationships?: number;
    principles?: number;
    failure_count?: number;
    archivalId?: string;
    summary?: string;
    failed_conversations?: Array<{ title: string; error: string }>;
    conflict_failures?: Array<{ title: string; error: string }>;
    chunking?: {
      totalChunks: number;
      processedChunks: number;
      failedChunks: Array<{ chunkId: string; ordinal: number; error: string }>;
      failedCount?: number;
      coverage: number;
    };
  };
}

export type IngestJobErrorCode = 'unauthorized' | 'expired' | 'disconnected' | 'timeout' | 'invalid';

export class IngestJobError extends Error {
  constructor(public readonly code: IngestJobErrorCode, message: string) {
    super(message);
    this.name = 'IngestJobError';
  }
}

export interface IngestSummary {
  outcome: 'success' | 'partial' | 'failed' | 'cancelled';
  countsKnown: boolean;
  countBasis: 'saved' | 'extracted';
  entities: number;
  relationships: number;
  completed: number;
  total: number;
  failures: number;
  coverage?: number;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** 任务结束不等于全部成功；文档任务的 success 也可能带有未处理的片段。 */
export function summarizeIngestJob(job: IngestJob): IngestSummary {
  const result = job.result;
  const chunks = result?.chunking;
  const failures = typeof result?.failure_count === 'number'
    ? count(result.failure_count)
    : (result?.failed_conversations?.length ?? 0)
      + (result?.conflict_failures?.length ?? 0)
      + (chunks?.failedCount ?? chunks?.failedChunks?.length ?? 0);
  const total = count(job.importProgress?.total ?? chunks?.totalChunks);
  const coverage = typeof chunks?.coverage === 'number' && Number.isFinite(chunks.coverage)
    ? Math.max(0, Math.min(1, chunks.coverage)) : undefined;
  const completed = job.importProgress
    ? Math.max(0, Math.min(total, count(job.importProgress.done) - failures))
    : Math.min(total, count(chunks?.processedChunks));
  const incomplete = failures > 0 || (coverage !== undefined && coverage < 1)
    || (total > 0 && completed < total);
  const outcome = job.status === 'failed' || job.status === 'cancelled'
    ? job.status
    : job.status === 'partial' || incomplete ? 'partial' : 'success';
  return {
    outcome,
    countsKnown: typeof result?.entities === 'number' && Number.isFinite(result.entities) && result.entities >= 0
      && typeof result?.relationships === 'number' && Number.isFinite(result.relationships) && result.relationships >= 0,
    // Initial chat imports report persisted counts; file jobs report extraction
    // candidates before entity resolution, not a net increase in library size.
    countBasis: job.importProgress ? 'saved' : 'extracted',
    entities: count(result?.entities ?? job.importProgress?.entities),
    relationships: count(result?.relationships),
    completed, total, failures, coverage,
  };
}

interface PollOptions {
  signal?: AbortSignal;
  onProgress?: (job: IngestJob) => void;
  intervalMs?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Stopped checking import status', 'AbortError');
}

// 包括获取原生凭证的等待：即便底层暂时不响应 signal，也及时交还界面。
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Stopped checking import status', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
    if (signal.aborted) onAbort();
  });
}

function waitForNextPoll(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped checking import status', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const JOB_STATUSES = new Set(['queued', 'running', 'success', 'partial', 'failed', 'cancelled']);

/**
 * 仅查询已有任务，不重传、不重试写入，也不因关闭界面取消后台任务。
 * 串行轮询，网络中断或超时交还 UI；继续查询时仍使用原 jobId。
 */
export async function pollIngestJob(jobId: string, options: PollOptions = {}): Promise<IngestJob> {
  if (!jobId || typeof jobId !== 'string') {
    throw new IngestJobError('invalid', 'Missing import task id');
  }
  const { signal, onProgress } = options;
  const deadline = Date.now() + Math.max(1, options.timeoutMs ?? 5 * 60 * 1000);
  const interval = Math.max(1, options.intervalMs ?? 1500);
  const requestTimeout = Math.max(1, options.requestTimeoutMs ?? 10_000);

  while (true) {
    throwIfAborted(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new IngestJobError('timeout', 'Import is still running; check this task again');
    const request = new AbortController();
    const onAbort = () => request.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => request.abort(), Math.min(requestTimeout, remaining));
    let job: IngestJob;
    try {
      const response = await abortable(apiFetch(`/api/ingest/job/${encodeURIComponent(jobId)}`, { signal: request.signal }), request.signal);
      throwIfAborted(signal);
      if (response.status === 401 || response.status === 403) {
        throw new IngestJobError('unauthorized', 'Reconnect the desktop app before checking this task');
      }
      if (response.status === 404) {
        throw new IngestJobError('expired', 'Task status has expired; inspect your library before importing again');
      }
      if (!response.ok) {
        throw new IngestJobError(response.status >= 500 ? 'disconnected' : 'invalid', 'Could not read import task status');
      }
      const snapshot = await abortable(response.json(), request.signal);
      if (!snapshot || snapshot.jobId !== jobId || !JOB_STATUSES.has(snapshot.status)) {
        throw new IngestJobError('invalid', 'Invalid import task status');
      }
      job = snapshot;
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof IngestJobError) throw error;
      if (request.signal.aborted) throw new IngestJobError('timeout', 'Status request timed out; check this task again');
      throw new IngestJobError('disconnected', 'Connection interrupted; your import may still be running');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    throwIfAborted(signal);
    onProgress?.(job);
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await waitForNextPoll(Math.min(interval, Math.max(0, deadline - Date.now())), signal);
  }
}
