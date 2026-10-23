import { apiFetch } from './api-client';

export type DiscussionSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface DiscussionSession<T extends { question: string }> {
  id: string | null;
  turns: T[];
  state: DiscussionSaveState;
  revision: number;
  savedRevision: number;
  saveTail: Promise<void>;
}

// Bound both transport and receipt parsing. A history write must never hold
// an explicit personal-decision save indefinitely while Brain is restarting.
export const DISCUSSION_SAVE_TIMEOUT_MS = 8_000;

export interface PendingDecisionWriteGate {
  begin(ownerId: string): () => void;
  isPending(ownerId: string): boolean;
  waitFor(ownerId: string, timeoutMs: number): Promise<boolean>;
}

/**
 * Prevent a discussion from being replaced while a confirmed decision write
 * is still awaiting its receipt. The write itself remains owned by its caller;
 * this gate only coordinates navigation and never retries or cancels it.
 */
export function createPendingDecisionWriteGate(): PendingDecisionWriteGate {
  const pendingByOwner = new Map<string, Map<symbol, { promise: Promise<void>; resolve: () => void }>>();

  return {
    begin(ownerId) {
      const token = Symbol(ownerId);
      let resolve!: () => void;
      const completion = new Promise<void>((done) => { resolve = done; });
      const writes = pendingByOwner.get(ownerId) ?? new Map<symbol, { promise: Promise<void>; resolve: () => void }>();
      writes.set(token, { promise: completion, resolve });
      pendingByOwner.set(ownerId, writes);
      let settled = false;

      return () => {
        if (settled) return;
        settled = true;
        const currentWrites = pendingByOwner.get(ownerId);
        currentWrites?.delete(token);
        if (currentWrites?.size === 0) pendingByOwner.delete(ownerId);
        // The promise is intentionally resolved before navigation re-checks
        // the map, so every waiter observes the completed receipt path.
        resolve();
      };
    },
    isPending(ownerId) {
      return (pendingByOwner.get(ownerId)?.size ?? 0) > 0;
    },
    async waitFor(ownerId, timeoutMs) {
      const startedAt = Date.now();
      while (true) {
        const writes = [...(pendingByOwner.get(ownerId)?.values() ?? [])].map((write) => write.promise);
        if (writes.length === 0) return true;
        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) return false;

        let timer: ReturnType<typeof setTimeout> | undefined;
        const completed = await Promise.race([
          Promise.all(writes).then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), remainingMs);
          }),
        ]);
        clearTimeout(timer);
        if (!completed) return false;
      }
    },
  };
}

export function createDiscussionSession<T extends { question: string }>(id: string | null = null): DiscussionSession<T> {
  return { id, turns: [], state: 'idle', revision: 0, savedRevision: 0, saveTail: Promise.resolve() };
}

/**
 * A discussion has one client-owned ID, including after a lost response.
 * Retrying this history upsert is safe; it never replays an AI request or a
 * decision mutation. Nothing is copied into browser storage or recall memory.
 */
export function saveDiscussion<T extends { question: string }>(
  session: DiscussionSession<T>,
  turns: T[],
  onChange?: (session: DiscussionSession<T>) => void,
): Promise<void> {
  if (!turns.length) return session.saveTail;
  session.id ??= crypto.randomUUID();
  session.turns = turns;
  const revision = ++session.revision;
  const body = JSON.stringify({ id: session.id, title: (turns[0].question || 'Ask').slice(0, 80), turns });
  session.state = 'saving';
  onChange?.(session);
  session.saveTail = session.saveTail.then(async () => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const persist = async () => {
        const response = await apiFetch('/api/discussions', { method: 'POST', signal: controller.signal, body });
        if (!response.ok) throw new Error('DISCUSSION_SAVE_FAILED');
        const receipt = await response.json();
        if (receipt?.id !== session.id) throw new Error('DISCUSSION_RECEIPT_MISMATCH');
      };
      await Promise.race([
        persist(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('DISCUSSION_SAVE_TIMEOUT'));
          }, DISCUSSION_SAVE_TIMEOUT_MS);
        }),
      ]);
      session.savedRevision = revision;
      if (session.revision === revision) session.state = 'saved';
    } catch {
      // Failure is visible and recoverable, but must not poison the queue.
      if (session.revision === revision) session.state = 'error';
    } finally {
      clearTimeout(timeout);
      onChange?.(session);
    }
  });
  return session.saveTail;
}
