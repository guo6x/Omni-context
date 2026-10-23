import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../desktop-daemon/src/lib/api-client';
import {
  createPendingDecisionWriteGate,
  createDiscussionSession,
  DISCUSSION_SAVE_TIMEOUT_MS,
  saveDiscussion,
  type DiscussionSession,
} from '../../desktop-daemon/src/lib/discussion-session';

vi.mock('../../desktop-daemon/src/lib/api-client', () => ({ apiFetch: vi.fn() }));
const fetchDiscussion = vi.mocked(apiFetch);

type Turn = {
  question: string;
  conclusion: string;
  questions: string[];
  sources: Array<{ id: string; name: string }>;
  savedAsDecision?: boolean;
};

const turn = (question: string, extra: Partial<Turn> = {}): Turn => ({
  question,
  conclusion: `Answer for: ${question}`,
  questions: [],
  sources: [],
  ...extra,
});

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sentBody(callIndex = 0): { id: string; title: string; turns: Turn[] } {
  const init = fetchDiscussion.mock.calls[callIndex][1];
  return JSON.parse(String(init?.body));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchDiscussion.mockReset();
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'discussion-fixed-id') });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('desktop discussion session persistence', () => {
  it('waits for a decision receipt before allowing the owning discussion to be replaced', async () => {
    const gate = createPendingDecisionWriteGate();
    const finishWrite = gate.begin('discussion-1');
    const canLeave = gate.waitFor('discussion-1', DISCUSSION_SAVE_TIMEOUT_MS);

    expect(gate.isPending('discussion-1')).toBe(true);
    finishWrite();

    await expect(canLeave).resolves.toBe(true);
    expect(gate.isPending('discussion-1')).toBe(false);
    expect(await gate.waitFor('discussion-2', DISCUSSION_SAVE_TIMEOUT_MS)).toBe(true);
  });

  it('fails closed when a decision write never returns a receipt', async () => {
    const gate = createPendingDecisionWriteGate();
    gate.begin('discussion-1');
    const canLeave = gate.waitFor('discussion-1', DISCUSSION_SAVE_TIMEOUT_MS);
    const settled = expect(canLeave).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(DISCUSSION_SAVE_TIMEOUT_MS);
    await settled;
    expect(gate.isPending('discussion-1')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('creates an idle session and does not write an empty discussion', async () => {
    const session = createDiscussionSession<Turn>();

    await expect(saveDiscussion(session, [])).resolves.toBeUndefined();

    expect(session).toMatchObject({
      id: null,
      turns: [],
      state: 'idle',
      revision: 0,
      savedRevision: 0,
    });
    expect(fetchDiscussion).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('assigns a stable UUID before the first write and persists complete turns', async () => {
    const session = createDiscussionSession<Turn>();
    const turns = [turn('What did I decide?', {
      questions: ['Which constraint mattered most?'],
      sources: [{ id: 'entity-1', name: 'Decision note' }],
      savedAsDecision: true,
    })];
    fetchDiscussion.mockResolvedValue(response({ id: 'discussion-fixed-id' }));

    await saveDiscussion(session, turns);

    expect(session.id).toBe('discussion-fixed-id');
    expect(vi.mocked(globalThis.crypto.randomUUID)).toHaveBeenCalledTimes(1);
    expect(fetchDiscussion).toHaveBeenCalledTimes(1);
    expect(fetchDiscussion).toHaveBeenCalledWith('/api/discussions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        id: 'discussion-fixed-id',
        title: 'What did I decide?',
        turns,
      }),
    }));
    expect(session).toMatchObject({ state: 'saved', revision: 1, savedRevision: 1, turns });
  });

  it('serializes a quick follow-up and only marks the latest snapshot saved', async () => {
    const session = createDiscussionSession<Turn>();
    const firstTurn = turn('First question');
    const secondTurn = turn('Follow-up question', {
      questions: ['What changed?'],
      sources: [{ id: 'entity-2', name: 'Follow-up source' }],
    });
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    fetchDiscussion.mockReturnValueOnce(firstResponse.promise).mockReturnValueOnce(secondResponse.promise);

    const firstSave = saveDiscussion(session, [firstTurn]);
    const latestTurns = [firstTurn, secondTurn];
    const secondSave = saveDiscussion(session, latestTurns);
    await Promise.resolve();

    expect(fetchDiscussion).toHaveBeenCalledTimes(1);
    expect(session).toMatchObject({ state: 'saving', revision: 2, savedRevision: 0, turns: latestTurns });

    firstResponse.resolve(response({ id: 'discussion-fixed-id' }));
    await vi.waitFor(() => expect(fetchDiscussion).toHaveBeenCalledTimes(2));
    expect(sentBody(0).id).toBe('discussion-fixed-id');
    expect(sentBody(1)).toEqual({
      id: 'discussion-fixed-id',
      title: 'First question',
      turns: latestTurns,
    });
    expect(session.state).toBe('saving');

    secondResponse.resolve(response({ id: 'discussion-fixed-id' }));
    await Promise.all([firstSave, secondSave]);

    expect(session).toMatchObject({ state: 'saved', revision: 2, savedRevision: 2, turns: latestTurns });
    expect(vi.mocked(globalThis.crypto.randomUUID)).toHaveBeenCalledTimes(1);
  });

  it('retries a lost response explicitly with the same discussion ID and no automatic replay', async () => {
    const session = createDiscussionSession<Turn>();
    const turns = [turn('Keep my answer after restart')];
    fetchDiscussion.mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(response({ id: 'discussion-fixed-id' }));

    await expect(saveDiscussion(session, turns)).resolves.toBeUndefined();
    expect(session).toMatchObject({ id: 'discussion-fixed-id', state: 'error', revision: 1, savedRevision: 0 });
    expect(fetchDiscussion).toHaveBeenCalledTimes(1);

    await expect(saveDiscussion(session, session.turns)).resolves.toBeUndefined();

    expect(fetchDiscussion).toHaveBeenCalledTimes(2);
    expect(sentBody(0).id).toBe('discussion-fixed-id');
    expect(sentBody(1).id).toBe('discussion-fixed-id');
    expect(session).toMatchObject({ id: 'discussion-fixed-id', state: 'saved', revision: 2, savedRevision: 2 });
    expect(vi.mocked(globalThis.crypto.randomUUID)).toHaveBeenCalledTimes(1);
  });

  it('does not replay a 401 and leaves the discussion retryable', async () => {
    const session = createDiscussionSession<Turn>();
    fetchDiscussion.mockResolvedValue(response({ error: 'unauthorized' }, 401));

    await expect(saveDiscussion(session, [turn('Question')])).resolves.toBeUndefined();

    expect(fetchDiscussion).toHaveBeenCalledTimes(1);
    expect(session).toMatchObject({ state: 'error', revision: 1, savedRevision: 0 });
  });

  it('does not report saved when the server responds with a different identity', async () => {
    const session = createDiscussionSession<Turn>();
    fetchDiscussion.mockResolvedValue(response({ id: 'another-discussion' }));

    await expect(saveDiscussion(session, [turn('Question')])).resolves.toBeUndefined();

    expect(session).toMatchObject({
      id: 'discussion-fixed-id',
      state: 'error',
      revision: 1,
      savedRevision: 0,
    });
    expect(fetchDiscussion).toHaveBeenCalledTimes(1);
  });

  it('bounds a request that never settles and allows an explicit retry on the same ID', async () => {
    const session = createDiscussionSession<Turn>();
    fetchDiscussion.mockImplementation(() => new Promise<Response>(() => {}));

    const pending = saveDiscussion(session, [turn('Question')]);
    const settled = expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(DISCUSSION_SAVE_TIMEOUT_MS);
    await settled;

    expect(session).toMatchObject({ id: 'discussion-fixed-id', state: 'error', revision: 1, savedRevision: 0 });
    expect(fetchDiscussion).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    fetchDiscussion.mockResolvedValueOnce(response({ id: 'discussion-fixed-id' }));
    await saveDiscussion(session, session.turns);

    expect(fetchDiscussion).toHaveBeenCalledTimes(2);
    expect(sentBody(0).id).toBe('discussion-fixed-id');
    expect(sentBody(1).id).toBe('discussion-fixed-id');
    expect(session).toMatchObject({ state: 'saved', revision: 2, savedRevision: 2 });
  });

  it('does not let a failed older snapshot poison a successful newer queued snapshot', async () => {
    const session: DiscussionSession<Turn> = createDiscussionSession<Turn>();
    const firstResponse = deferred<Response>();
    fetchDiscussion.mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(response({ id: 'discussion-fixed-id' }));

    const olderSave = saveDiscussion(session, [turn('Older')]);
    const latestTurns = [turn('Older'), turn('Latest follow-up')];
    const latestSave = saveDiscussion(session, latestTurns);
    await Promise.resolve();
    firstResponse.reject(new TypeError('offline'));
    await Promise.all([olderSave, latestSave]);

    expect(fetchDiscussion).toHaveBeenCalledTimes(2);
    expect(session).toMatchObject({ state: 'saved', revision: 2, savedRevision: 2, turns: latestTurns });
  });
});
