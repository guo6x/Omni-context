export interface CapturePolicySnapshot {
  capturePaused: boolean;
  captureBlocklist: string[];
}

export interface CapturePolicySyncOptions {
  readPersistedSettings: () => string | null;
  invokeNative: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  defaults: CapturePolicySnapshot;
  /** Bound a broken Tauri bridge; a timed-out policy is never treated as confirmed. */
  timeoutMs?: number;
  runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>;
  onResult?: (error: unknown | null) => void;
}

const DEFAULT_NATIVE_TIMEOUT_MS = 5_000;

export class NativeCaptureRevocationUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super(`Native capture revocation could not be confirmed: ${String(cause)}`);
    this.name = 'NativeCaptureRevocationUnconfirmedError';
  }
}

export class CapturePolicyReconfirmationRequiredError extends Error {
  constructor(cause: unknown) {
    super(`Native capture remains revoked until privacy settings are explicitly confirmed: ${String(cause)}`);
    this.name = 'CapturePolicyReconfirmationRequiredError';
  }
}

function invokeWithTimeout(
  invokeNative: CapturePolicySyncOptions['invokeNative'],
  command: string,
  args: Record<string, unknown> | undefined,
  timeoutMs: number,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([invokeNative(command, args), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readCapturePolicy(
  persisted: string | null,
  defaults: CapturePolicySnapshot,
): CapturePolicySnapshot {
  if (persisted === null) {
    return {
      capturePaused: defaults.capturePaused,
      captureBlocklist: [...defaults.captureBlocklist],
    };
  }

  const settings: unknown = JSON.parse(persisted);
  if (!isRecord(settings)) throw new Error('Persisted settings must be an object');
  const behavior = settings.behavior === undefined ? {} : settings.behavior;
  if (!isRecord(behavior)) throw new Error('Persisted behavior settings must be an object');

  const capturePaused = behavior.capturePaused === undefined
    ? defaults.capturePaused
    : behavior.capturePaused;
  if (typeof capturePaused !== 'boolean') {
    throw new Error('Persisted capturePaused setting must be a boolean');
  }

  const captureBlocklist = behavior.captureBlocklist === undefined
    ? [...defaults.captureBlocklist]
    : behavior.captureBlocklist;
  if (!Array.isArray(captureBlocklist) || captureBlocklist.some((entry) => typeof entry !== 'string')) {
    throw new Error('Persisted captureBlocklist setting must be a string array');
  }

  return { capturePaused, captureBlocklist: [...captureBlocklist] };
}

export function hasCapturePolicyChanged(
  previous: string | null,
  next: string,
  defaults: CapturePolicySnapshot,
): boolean {
  try {
    const before = readCapturePolicy(previous, defaults);
    const after = readCapturePolicy(next, defaults);
    return before.capturePaused !== after.capturePaused
      || before.captureBlocklist.length !== after.captureBlocklist.length
      || before.captureBlocklist.some((entry, index) => entry !== after.captureBlocklist[index]);
  } catch {
    // A malformed prior value cannot prove that the native policy is current.
    return true;
  }
}

/**
 * Serializes native policy publication and rereads localStorage only when
 * each queued operation reaches the front. This prevents concurrent settings
 * hook instances from publishing stale in-memory snapshots over newer state.
 */
export function createCapturePolicySynchronizer(options: CapturePolicySyncOptions) {
  const runExclusive = options.runExclusive ?? ((operation) => operation());
  const timeoutMs = options.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Capture-policy IPC timeout must be a positive finite number');
  }
  let queue: Promise<void> = Promise.resolve();

  const invokeInvalidation = async (requireReconfirmation: boolean): Promise<number> => {
    const generation = await invokeWithTimeout(
      options.invokeNative,
      'invalidate_capture_policy',
      { requireReconfirmation },
      timeoutMs,
    );
    if (!Number.isSafeInteger(generation) || Number(generation) < 0) {
      throw new Error('Native capture revocation returned an invalid generation');
    }
    return Number(generation);
  };

  const invalidateBestEffort = async () => {
    try {
      return await invokeInvalidation(true);
    } catch (error) {
      // A failed revocation means the prior native policy may still be active.
      // Preserve that distinction so the UI never claims capture is blocked.
      throw new NativeCaptureRevocationUnconfirmedError(error);
    }
  };

  const invalidateNativePolicy = async (requireReconfirmation: boolean) => {
    try {
      return await invokeInvalidation(requireReconfirmation);
    } catch (error) {
      throw new NativeCaptureRevocationUnconfirmedError(error);
    }
  };

  const syncLatestPersistedPolicy = async (explicitConfirmation = false) => {
    // Each native confirmation is bound to the revocation generation that
    // preceded it. Timed-out IPC is not cancellable; the generation prevents a
    // late, stale sync from re-enabling capture after a newer pause/blocklist.
    const expectedGeneration = await invalidateNativePolicy(false);
    let policy: CapturePolicySnapshot;
    try {
      policy = readCapturePolicy(options.readPersistedSettings(), options.defaults);
    } catch (error) {
      // A transient storage failure can disappear after relaunch. Persist the
      // native recovery latch so the previous permissive snapshot is not
      // silently restored by the next startup sync.
      await invalidateBestEffort();
      throw new CapturePolicyReconfirmationRequiredError(error);
    }

    try {
      await invokeWithTimeout(options.invokeNative, 'sync_capture_policy', {
        expectedGeneration,
        capturePaused: policy.capturePaused,
        captureBlocklist: policy.captureBlocklist,
        explicitConfirmation,
      }, timeoutMs);
    } catch (error) {
      await invalidateBestEffort();
      if (String(error).includes('explicit privacy settings confirmation required')) {
        throw new CapturePolicyReconfirmationRequiredError(error);
      }
      throw error;
    }
  };

  const sync = (explicitConfirmation = false): Promise<boolean> => {
    const task = queue.then(
      () => runExclusive(() => syncLatestPersistedPolicy(explicitConfirmation)),
      () => runExclusive(() => syncLatestPersistedPolicy(explicitConfirmation)),
    );
    // Keep the queue usable after a failed invocation, but let the caller
    // distinguish a confirmed native policy from an invalidated/unknown one.
    queue = task.then(() => undefined, () => undefined);
    return task.then(
      () => {
        options.onResult?.(null);
        return true;
      },
      (error) => {
        options.onResult?.(error);
        return false;
      },
    );
  };

  return {
    sync,
    /** Revoke native capture before a settings transaction can fail. */
    invalidate: async (): Promise<void> => {
      await invalidateNativePolicy(true);
    },
    /** Run a settings read/write and any policy publication as one cross-window transaction. */
    withExclusive<T>(operation: (
      syncLatestPolicy: () => Promise<void>,
      invalidatePolicy: () => Promise<void>,
    ) => Promise<T>): Promise<T> {
      return runExclusive(() => operation(
        () => syncLatestPersistedPolicy(true),
        async () => { await invalidateNativePolicy(true); },
      ));
    },
  };
}
