import { CapturePolicySnapshot, hasCapturePolicyChanged } from './capture-policy-sync';

export class CapturePolicySaveNotAppliedError extends Error {
  constructor(cause: unknown) {
    super(`Capture-policy change was not applied: ${String(cause)}`);
    this.name = 'CapturePolicySaveNotAppliedError';
  }
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistSettingsOptions<T> {
  storage: SettingsStorage;
  storageKey: string;
  defaults: CapturePolicySnapshot;
  currentFromStorage: (persisted: string | null) => T;
  update: (current: T) => T;
  isNativeRuntime: boolean;
  /** The caller has already revoked native capture before entering its lock. */
  nativePolicyAlreadyInvalidated?: boolean;
  invalidateCapturePolicy: () => Promise<void>;
  syncCapturePolicy: () => Promise<void>;
}

/** Revoke first so a failed cross-window lock cannot leave stale capture access active. */
export async function withNativeCaptureRevocation<T>(
  isCapturePolicyUpdate: boolean,
  isNativeRuntime: boolean,
  invalidateCapturePolicy: () => Promise<void>,
  operation: () => Promise<T>,
): Promise<T> {
  if (isCapturePolicyUpdate && isNativeRuntime) await invalidateCapturePolicy();
  try {
    return await operation();
  } catch (error) {
    if (isCapturePolicyUpdate && isNativeRuntime) {
      throw new CapturePolicySaveNotAppliedError(error);
    }
    throw error;
  }
}

export type PersistSettingsResult<T> =
  | { ok: true; settings: T }
  | { ok: false; settings: T | null; error: unknown; recoveryError?: unknown };

/** Only a failed privacy-policy update belongs in the hardware-sync warning. */
export function capturePolicySyncErrorFromSave<T>(
  capturePolicyUpdate: boolean,
  result: PersistSettingsResult<T>,
): unknown | null {
  if (!capturePolicyUpdate || result.ok) return null;
  return result.recoveryError ?? result.error;
}

/**
 * Persist one functional settings update while the caller holds the shared
 * settings lock. Privacy changes first revoke the native snapshot, then write
 * settings and publish the new policy. A failed publication keeps the user's
 * requested settings but leaves capture fail-closed for an explicit retry.
 */
export async function persistSettingsWhileLocked<T extends { behavior: { capturePaused: boolean; captureBlocklist: string[] } }>(
  options: PersistSettingsOptions<T>,
): Promise<PersistSettingsResult<T>> {
  const { storage, storageKey, currentFromStorage, update, invalidateCapturePolicy, syncCapturePolicy, isNativeRuntime } = options;
  let previousRaw: string | null;
  let nextRaw: string;
  let current: T;
  let next: T;

  try {
    previousRaw = storage.getItem(storageKey);
    current = currentFromStorage(previousRaw);
    next = update(current);
    nextRaw = JSON.stringify(next);
  } catch (error) {
    return {
      ok: false,
      settings: null,
      error: options.nativePolicyAlreadyInvalidated
        ? new CapturePolicySaveNotAppliedError(error)
        : error,
    };
  }

  const policyChanged = isNativeRuntime && (
    options.nativePolicyAlreadyInvalidated === true
    || hasCapturePolicyChanged(previousRaw, nextRaw, options.defaults)
  );

  if (policyChanged && !options.nativePolicyAlreadyInvalidated) {
    try {
      // The native command marks capture denied immediately, then waits for
      // any already-authorized local capture action to finish before returning.
      await invalidateCapturePolicy();
    } catch (error) {
      return { ok: false, settings: current, error };
    }
  }

  try {
    storage.setItem(storageKey, nextRaw);
  } catch (error) {
    // Do not republish the previous (possibly permissive) snapshot after a
    // failed privacy write. The explicit retry path can reconcile later.
    return {
      ok: false,
      settings: current,
      error: policyChanged ? new CapturePolicySaveNotAppliedError(error) : error,
    };
  }

  if (!policyChanged) {
    try {
      return { ok: true, settings: currentFromStorage(storage.getItem(storageKey)) };
    } catch (error) {
      return { ok: false, settings: null, error };
    }
  }

  try {
    await syncCapturePolicy();
  } catch (error) {
    let recoveryError: unknown;
    try {
      // Do not restore an older permissive policy after the user asked to
      // pause or tighten a blocklist. The new preference remains visible and
      // native capture stays denied until a later explicit retry succeeds.
      await invalidateCapturePolicy();
    } catch (invalidateError) {
      recoveryError = invalidateError;
    }

    let settings: T | null = null;
    try {
      settings = currentFromStorage(storage.getItem(storageKey));
    } catch {
      // Keep the failure explicit; callers must not publish an unparsed value.
    }
    return { ok: false, settings, error, recoveryError };
  }

  try {
    const persisted = storage.getItem(storageKey);
    // If a non-cooperating writer changed the record during native IPC, make
    // one last publication of the current value before exposing it in the UI.
    if (persisted !== nextRaw && hasCapturePolicyChanged(nextRaw, persisted ?? '', options.defaults)) {
      await syncCapturePolicy();
    }
    return { ok: true, settings: currentFromStorage(storage.getItem(storageKey)) };
  } catch (error) {
    if (policyChanged) {
      try {
        // A post-publication read/reconciliation failure means the renderer
        // cannot safely expose the effective preference. Revoke again rather
        // than leaving a newly permissive native snapshot active behind stale
        // UI state.
        await invalidateCapturePolicy();
        return {
          ok: false,
          settings: null,
          error: new CapturePolicySaveNotAppliedError(error),
        };
      } catch (recoveryError) {
        return { ok: false, settings: null, error, recoveryError };
      }
    }
    return { ok: false, settings: null, error };
  }
}
