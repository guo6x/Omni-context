export interface RequestDeadline {
  signal: AbortSignal;
  didTimeout: () => boolean;
  race: <T>(operation: Promise<T>) => Promise<RequestDeadlineResult<T>>;
  clear: () => void;
}

export type RequestDeadlineResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

/** Abort a stalled request after a bounded interval; the caller decides whether its write is uncertain. */
export function createRequestDeadline(timeoutMs: number, parentSignal?: AbortSignal): RequestDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Request timeout must be a positive finite number");
  }

  const controller = new AbortController();
  let timedOut = false;
  let resolveTimeout!: (result: { timedOut: true }) => void;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    resolveTimeout = resolve;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    resolveTimeout({ timedOut: true });
  }, timeoutMs);
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    race: <T>(operation: Promise<T>) => Promise.race([
      operation.then((value): RequestDeadlineResult<T> => ({ timedOut: false, value })),
      timeout,
    ]),
    clear: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}
