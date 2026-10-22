import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../desktop-daemon/src/lib/api-client';
import { IngestJob, pollIngestJob, summarizeIngestJob } from '../../desktop-daemon/src/lib/ingest-job';

vi.mock('../../desktop-daemon/src/lib/api-client', () => ({ apiFetch: vi.fn() }));
const fetchStatus = vi.mocked(apiFetch);
const job = (status: IngestJob['status'], extra: Partial<IngestJob> = {}): IngestJob => ({ jobId: 'task-1', status, ...extra });
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => { vi.useFakeTimers(); fetchStatus.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('import result truth', () => {
  it('distinguishes file extraction candidates from persisted chat counts', () => {
    const result = { entities: 2, relationships: 3 };
    expect(summarizeIngestJob(job('success', { result }))).toMatchObject({ countsKnown: true, countBasis: 'extracted' });
    expect(summarizeIngestJob(job('success', {
      result, importProgress: { done: 1, total: 1, entities: 2 },
    }))).toMatchObject({ countsKnown: true, countBasis: 'saved' });
  });
  it('does not present negative response counts as confirmed zero', () => {
    expect(summarizeIngestJob(job('success', { result: { entities: -1, relationships: 0 } })))
      .toMatchObject({ countsKnown: false });
  });
  it('reports only completed conversations and retains partial results', () => {
    expect(summarizeIngestJob(job('partial', {
      importProgress: { done: 3, total: 3, entities: 4 },
      result: { entities: 4, failed_conversations: [{ title: 'B', error: 'offline' }] },
    }))).toMatchObject({ outcome: 'partial', completed: 2, total: 3, entities: 4, failures: 1 });
  });
  it('does not call a success envelope complete when document chunks failed', () => {
    expect(summarizeIngestJob(job('success', { result: { entities: 7, chunking: {
      totalChunks: 4, processedChunks: 3, failedChunks: [{ chunkId: 'c', ordinal: 1, error: 'failed' }], coverage: 0.75,
    } } }))).toMatchObject({ outcome: 'partial', completed: 3, total: 4, failures: 1, coverage: 0.75 });
  });
  it('treats missing coverage alone as neutral, but known incomplete processing as partial', () => {
    expect(summarizeIngestJob(job('success', { result: { entities: 0 } })).outcome).toBe('success');
    expect(summarizeIngestJob(job('success', { importProgress: { done: 1, total: 2, entities: 1 } })).outcome).toBe('partial');
  });
  it.each(['failed', 'cancelled'] as const)('preserves %s despite any persisted results', status => {
    expect(summarizeIngestJob(job(status, { result: { entities: 2 } }))).toMatchObject({ outcome: status, entities: 2 });
  });
  it.each(['failed', 'cancelled'] as const)('does not treat missing persisted counts as confirmed zero on %s', status => {
    expect(summarizeIngestJob(job(status))).toMatchObject({ outcome: status, countsKnown: false });
    expect(summarizeIngestJob(job(status, { result: { entities: 0, relationships: 0 } }))).toMatchObject({ countsKnown: true });
  });
});

describe('bounded, read-only import polling', () => {
  it.each(['success', 'partial', 'failed', 'cancelled'] as const)('stops on %s without another request', async status => {
    fetchStatus.mockResolvedValue(respond(job(status)));
    await expect(pollIngestJob('task-1')).resolves.toEqual(job(status));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(fetchStatus.mock.calls[0][1]).not.toHaveProperty('method');
  });
  it('never overlaps requests and reports progress before completion', async () => {
    let finish!: (response: Response) => void;
    fetchStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(respond(job('success')));
    const progress = vi.fn();
    const result = pollIngestJob('task-1', { onProgress: progress });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    finish(respond(job('running')));
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toMatchObject({ status: 'success' });
    expect(progress.mock.calls.map(([snapshot]) => snapshot.status)).toEqual(['running', 'success']);
  });
  it.each([[401, 'unauthorized'], [403, 'unauthorized'], [404, 'expired'], [503, 'disconnected'], [400, 'invalid']] as const)(
    'returns a recoverable error for HTTP %s and never resubmits', async (status, code) => {
      fetchStatus.mockResolvedValue(respond({}, status));
      await expect(pollIngestJob('task-1')).rejects.toMatchObject({ code });
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    },
  );
  it('resumes the exact same job after a disconnected request', async () => {
    fetchStatus.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(respond(job('partial')));
    await expect(pollIngestJob('task-1')).rejects.toMatchObject({ code: 'disconnected' });
    await expect(pollIngestJob('task-1')).resolves.toMatchObject({ status: 'partial' });
    expect(fetchStatus.mock.calls.map(([url]) => url)).toEqual(['/api/ingest/job/task-1', '/api/ingest/job/task-1']);
  });
  it('aborts on unmount and ignores a late response', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    let finish!: (response: Response) => void;
    fetchStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const result = pollIngestJob('task-1', { signal: controller.signal, onProgress: progress });
    const aborted = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    finish(respond(job('success')));
    await aborted;
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans the pending interval on abort without querying again', async () => {
    const controller = new AbortController();
    fetchStatus.mockResolvedValue(respond(job('running')));
    const result = pollIngestJob('task-1', { signal: controller.signal });
    const aborted = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await aborted;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ends polling after the overall deadline', async () => {
    fetchStatus.mockImplementation(async () => respond(job('running')));
    const result = pollIngestJob('task-1', { timeoutMs: 3000, intervalMs: 1000 });
    const timedOut = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(3000);
    await timedOut;
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });
  it('aborts an unresponsive HTTP request at its request deadline', async () => {
    fetchStatus.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
    }));
    const result = pollIngestJob('task-1', { requestTimeoutMs: 1000 });
    const timedOut = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await timedOut;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('also times out while the credential bridge ignores cancellation', async () => {
    fetchStatus.mockImplementation(() => new Promise(() => {}));
    const result = pollIngestJob('task-1', { requestTimeoutMs: 1000 });
    const timedOut = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await timedOut;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{}, { jobId: 'other', status: 'success' }, { jobId: 'task-1', status: 'unexpected' }])(
    'rejects malformed or mismatched status instead of waiting forever', async snapshot => {
      fetchStatus.mockResolvedValue(respond(snapshot));
      await expect(pollIngestJob('task-1')).rejects.toMatchObject({ code: 'invalid' });
    },
  );
});
