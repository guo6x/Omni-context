import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeImportRecovery,
  createImportSubmission,
  fingerprintImportContent,
  releaseImportContentReservation,
  reserveImportContent,
  settleImportOutcome,
} from '../../desktop-daemon/src/lib/import-submission';
import {
  getPendingImportJobs,
  persistImportJob,
  persistUncertainImport,
  type ImportJobOwner,
} from '../../desktop-daemon/src/lib/import-job-recovery';

let localRecords: Map<string, string>;

function readStoredRecoveryRecords(): unknown[] {
  const raw = localRecords.get('omni-context.pending-import-jobs.v1');
  return raw ? JSON.parse(raw) as unknown[] : [];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  localRecords = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => localRecords.get(key) ?? null,
      setItem: (key: string, value: string) => { localRecords.set(key, value); },
      removeItem: (key: string) => { localRecords.delete(key); },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('import content verification', () => {
  it.each(['unavailable', 'digest failure'] as const)(
    'blocks submission when Web Crypto is %s instead of bypassing duplicate protection',
    async (failureMode) => {
      if (failureMode === 'unavailable') {
        vi.stubGlobal('crypto', undefined);
      } else {
        vi.stubGlobal('crypto', {
          subtle: { digest: vi.fn().mockRejectedValue(new Error('CONTROLLED_CRYPTO_FAILURE')) },
        } as unknown as Crypto);
      }

      const fingerprint = await fingerprintImportContent(new Uint8Array([1, 2, 3]).buffer);

      expect(fingerprint).toBeNull();
      expect(reserveImportContent(fingerprint, 'file-drop')).toEqual({
        reserved: false,
        reason: 'fingerprint-unavailable',
      });
      expect(getPendingImportJobs()).toEqual([]);
      expect(reserveImportContent(null, 'library')).toMatchObject({
        reserved: false,
        reason: 'fingerprint-unavailable',
      });
    },
  );
});

describe.each<ImportJobOwner>(['onboarding', 'library', 'file-drop'])('%s import recovery', (owner) => {
  it.each(['partial', 'failed', 'cancelled'] as const)(
    'keeps a %s job and duplicate guard until explicit review, without submitting automatically',
    (outcome) => {
      const fingerprint = `fixture-fingerprint-${owner}-${outcome}`;
      const attemptId = `fixture-attempt-${owner}-${outcome}`;
      const jobId = `fixture-job-${owner}-${outcome}`;
      const submit = vi.fn();

      expect(reserveImportContent(fingerprint, owner)).toMatchObject({ reserved: true });
      expect(persistUncertainImport(owner, attemptId)).toBe(true);
      expect(persistImportJob(owner, jobId, attemptId)).toBe(true);

      expect(settleImportOutcome(outcome, owner, fingerprint, jobId, attemptId)).toBe(true);
      expect(getPendingImportJobs()).toEqual([{ kind: 'job', owner, jobId, savedAt: expect.any(Number) }]);
      expect(reserveImportContent(fingerprint, owner)).toMatchObject({
        reserved: false, reason: 'duplicate', existing: { phase: 'uncertain', jobId },
      });
      expect(JSON.stringify(readStoredRecoveryRecords())).not.toContain(fingerprint);
      expect(JSON.stringify(readStoredRecoveryRecords())).not.toContain('private-fixture-name');
      expect(submit).not.toHaveBeenCalled();

      acknowledgeImportRecovery(owner, fingerprint, jobId, attemptId);

      expect(getPendingImportJobs()).toEqual([]);
      expect(reserveImportContent(fingerprint, owner)).toMatchObject({ reserved: true });
      // Acknowledgement only releases the guard. A later user selection owns any new request.
      expect(submit).not.toHaveBeenCalled();
      releaseImportContentReservation(fingerprint, owner);
    },
  );

  it('clears the recovery job and content guard after a complete success', () => {
    const fingerprint = `fixture-success-${owner}`;
    const attemptId = `fixture-success-attempt-${owner}`;
    const jobId = `fixture-success-job-${owner}`;

    expect(reserveImportContent(fingerprint, owner)).toMatchObject({ reserved: true });
    expect(persistUncertainImport(owner, attemptId)).toBe(true);
    expect(persistImportJob(owner, jobId, attemptId)).toBe(true);

    expect(settleImportOutcome('success', owner, fingerprint, jobId, attemptId)).toBe(false);
    expect(getPendingImportJobs()).toEqual([]);
    expect(reserveImportContent(fingerprint, owner)).toMatchObject({ reserved: true });
    releaseImportContentReservation(fingerprint, owner);
  });
});

describe('bounded desktop import submission', () => {
  it('disposes the submission deadline before background polling without aborting its controller', async () => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);

    expect(await submission.wait(async () => 'file content')).toBe('file content');
    expect(submission.prepare(() => JSON.stringify({ text: 'file content' }))).toBe('{"text":"file content"}');
    expect(await submission.wait(async () => ({ jobId: 'fixture-job' }))).toEqual({ jobId: 'fixture-job' });
    submission.dispose();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(controller.signal.aborted).toBe(false);
    expect(submission.timedOut).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['arrayBuffer', 'text'])('unlocks a hung %s read at 30 seconds and never submits its late result', async () => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);
    const read = deferred<string>();
    const post = vi.fn().mockResolvedValue({ jobId: 'fixture-job' });
    let submissionUncertain = false;
    let settled = false;
    const result = (async () => {
      try {
        const text = await submission.wait(() => read.promise);
        const payload = submission.prepare(() => JSON.stringify({ text }));
        return await submission.wait(() => {
          submissionUncertain = true;
          return post(payload);
        });
      } finally {
        settled = true;
        submission.dispose();
      }
    })();
    const timedOut = expect(result).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(submission.timedOut).toBe(true);
    expect(settled).toBe(true);
    expect(submissionUncertain).toBe(false);

    read.resolve('fixture late file contents');
    await vi.advanceTimersByTimeAsync(0);
    expect(post).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['credential/fetch', 'response.json'])('retains the explicit-review guard if %s ignores cancellation after submission starts', async (stage) => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);
    const pending = deferred<{ jobId: string }>();
    const started = deferred<void>();
    const poll = vi.fn();
    let submissionUncertain = false;
    const post = vi.fn(() => {
      if (stage === 'credential/fetch') { started.resolve(); return pending.promise; }
      return Promise.resolve({ jobId: 'fixture-job' });
    });
    const json = vi.fn(() => { started.resolve(); return pending.promise; });
    const result = (async () => {
      try {
        await submission.wait(() => {
          submissionUncertain = true;
          return post();
        });
        const receipt = await submission.wait(json);
        poll(receipt.jobId);
      } finally {
        submission.dispose();
      }
    })();
    const timedOut = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;

    await vi.advanceTimersByTimeAsync(30_000);
    await timedOut;
    expect(submissionUncertain).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(stage === 'credential/fetch' ? 0 : 1);
    expect(poll).not.toHaveBeenCalled();

    pending.resolve({ jobId: 'fixture-late-job' });
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(poll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one overall deadline rather than granting a fresh 30 seconds to each stage', async () => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);
    const read = deferred<string>();
    const body = deferred<unknown>();
    const startedBody = deferred<void>();
    const result = (async () => {
      try {
        await submission.wait(() => read.promise);
        await submission.wait(() => { startedBody.resolve(); return body.promise; });
      } finally {
        submission.dispose();
      }
    })();
    const timedOut = expect(result).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(20_000);
    read.resolve('fixture read completed');
    await startedBody.promise;
    await vi.advanceTimersByTimeAsync(10_000);
    await timedOut;

    expect(submission.timedOut).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks elapsed time before starting another stage even when a timer callback cannot run', async () => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);
    const post = vi.fn().mockResolvedValue({ jobId: 'fixture-job' });
    vi.setSystemTime(Date.now() + 30_001);

    await expect(submission.wait(post)).rejects.toMatchObject({ name: 'AbortError' });

    expect(submission.timedOut).toBe(true);
    expect(post).not.toHaveBeenCalled();
    submission.dispose();
  });

  it('checks the deadline after synchronous serialization and does not proceed to POST', () => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);
    const post = vi.fn();

    expect(() => {
      const payload = submission.prepare(() => {
        vi.setSystemTime(Date.now() + 30_001);
        return JSON.stringify({ text: 'fixture content' });
      });
      post(payload);
    }).toThrowError(expect.objectContaining({ name: 'AbortError' }));

    expect(submission.timedOut).toBe(true);
    expect(post).not.toHaveBeenCalled();
    submission.dispose();
  });

  it('does not start reading an already cancelled submission', async () => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);
    const reason = new DOMException('Fixture task replaced', 'AbortError');
    const read = vi.fn().mockResolvedValue('fixture content');
    controller.abort(reason);

    await expect(submission.wait(read)).rejects.toBe(reason);

    expect(read).not.toHaveBeenCalled();
    expect(submission.timedOut).toBe(false);
    submission.dispose();
  });

  it('stops only local waiting on cancellation and ignores a late rejected native read', async () => {
    const controller = new AbortController();
    const submission = createImportSubmission(controller);
    const read = deferred<string>();
    const reason = new DOMException('Fixture task replaced', 'AbortError');
    const result = submission.wait(() => read.promise);
    const aborted = expect(result).rejects.toBe(reason);

    controller.abort(reason);
    await aborted;
    read.reject(new Error('Fixture late native rejection'));
    await vi.advanceTimersByTimeAsync(0);

    expect(submission.timedOut).toBe(false);
    submission.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates read errors and removes the abort listener for a completed stage', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const submission = createImportSubmission(controller);
    const error = new Error('Fixture file unavailable');

    await expect(submission.wait(async () => { throw error; })).rejects.toBe(error);

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(submission.timedOut).toBe(false);
    submission.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
