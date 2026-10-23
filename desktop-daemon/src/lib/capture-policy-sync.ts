export interface CapturePolicySnapshot {
  capturePaused: boolean;
  captureBlocklist: string[];
}

export interface CapturePolicySyncOptions {
  readPersistedSettings: () => string | null;
  invokeNative: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  defaults: CapturePolicySnapshot;
  runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>;
  onResult?: (error: unknown | null) => void;
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
  let queue: Promise<void> = Promise.resolve();

  const invalidateBestEffort = async () => {
    try {
      await options.invokeNative('invalidate_capture_policy');
    } catch {
      // Keep the original error; the caller displays that native confirmation
      // could not be established.
    }
  };

  const invalidateNativePolicy = async () => {
    await options.invokeNative('invalidate_capture_policy');
  };

  const syncLatestPersistedPolicy = async () => {
    let policy: CapturePolicySnapshot;
    try {
      policy = readCapturePolicy(options.readPersistedSettings(), options.defaults);
    } catch (error) {
      await invalidateBestEffort();
      throw error;
    }

    try {
      await options.invokeNative('sync_capture_policy', {
        capturePaused: policy.capturePaused,
        captureBlocklist: policy.captureBlocklist,
      });
    } catch (error) {
      await invalidateBestEffort();
      throw error;
    }
  };

  const sync = (): Promise<boolean> => {
    const task = queue.then(
      () => runExclusive(syncLatestPersistedPolicy),
      () => runExclusive(syncLatestPersistedPolicy),
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
    /** Run a settings read/write and any policy publication as one cross-window transaction. */
    withExclusive<T>(operation: (
      syncLatestPolicy: () => Promise<void>,
      invalidatePolicy: () => Promise<void>,
    ) => Promise<T>): Promise<T> {
      return runExclusive(() => operation(syncLatestPersistedPolicy, invalidateNativePolicy));
    },
  };
}
