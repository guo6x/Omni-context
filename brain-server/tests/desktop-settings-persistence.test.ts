import { describe, expect, it } from 'vitest';
import { capturePolicySyncErrorFromSave, persistSettingsWhileLocked } from '../../desktop-daemon/src/lib/settings-persistence';

type FixtureSettings = {
  appearance: { theme: string };
  behavior: { capturePaused: boolean; captureBlocklist: string[]; onboarded?: boolean };
};

const defaults = { capturePaused: true, captureBlocklist: ['KeePass'] };
const storageKey = 'omnicontext-settings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createStorage(initial: FixtureSettings) {
  const values = new Map([[storageKey, JSON.stringify(initial)]]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function createSharedLock() {
  let tail = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function options(
  storage: ReturnType<typeof createStorage>,
  update: (current: FixtureSettings) => FixtureSettings,
  syncCapturePolicy: () => Promise<void>,
  invalidateCapturePolicy: () => Promise<void> = async () => {},
) {
  return {
    storage,
    storageKey,
    defaults,
    currentFromStorage: (persisted: string | null): FixtureSettings => persisted
      ? JSON.parse(persisted) as FixtureSettings
      : { appearance: { theme: 'dark' }, behavior: { ...defaults } },
    update,
    isNativeRuntime: true,
    invalidateCapturePolicy,
    syncCapturePolicy,
  };
}

describe('cross-window settings persistence', () => {
  it('does not label an ordinary settings persistence error as a hardware privacy-policy failure', () => {
    const unrelatedStorageError = new Error('theme storage unavailable');

    expect(capturePolicySyncErrorFromSave(false, {
      ok: false,
      settings: null,
      error: unrelatedStorageError,
    })).toBeNull();
  });

  it('keeps a failed privacy-policy save in the hardware sync warning and prefers recovery failure detail', () => {
    const policyError = new Error('native privacy policy rejected');
    const recoveryError = new Error('native policy restoration failed');

    expect(capturePolicySyncErrorFromSave(true, {
      ok: false,
      settings: null,
      error: policyError,
      recoveryError,
    })).toBe(recoveryError);
  });

  it('merges a theme update against the latest value after a privacy sync is pending', async () => {
    const storage = createStorage({
      appearance: { theme: 'dark' },
      behavior: { capturePaused: true, captureBlocklist: ['KeePass'] },
    });
    const runExclusive = createSharedLock();
    const syncStarted = deferred<void>();
    const finishSync = deferred<void>();
    let nativeSyncs = 0;

    const privacySave = runExclusive(() => persistSettingsWhileLocked(options(
      storage,
      (current) => ({ ...current, behavior: { ...current.behavior, capturePaused: false } }),
      async () => {
        nativeSyncs += 1;
        syncStarted.resolve();
        await finishSync.promise;
      },
    )));
    await syncStarted.promise;

    const themeSave = runExclusive(() => persistSettingsWhileLocked(options(
      storage,
      (current) => ({ ...current, appearance: { theme: 'soft-light' } }),
      async () => { throw new Error('unrelated update must not sync capture policy'); },
    )));
    expect(JSON.parse(storage.getItem(storageKey) as string).appearance.theme).toBe('dark');

    finishSync.resolve();
    const [privacyResult, themeResult] = await Promise.all([privacySave, themeSave]);
    expect(privacyResult.ok).toBe(true);
    expect(themeResult.ok).toBe(true);
    expect(nativeSyncs).toBe(1);
    expect(JSON.parse(storage.getItem(storageKey) as string)).toEqual({
      appearance: { theme: 'soft-light' },
      behavior: { capturePaused: false, captureBlocklist: ['KeePass'] },
    });
  });

  it('invalidates native capture before persisting and publishing a privacy change', async () => {
    const storage = createStorage({
      appearance: { theme: 'dark' },
      behavior: { capturePaused: true, captureBlocklist: ['KeePass'] },
    });
    const events: string[] = [];
    const tracedStorage = {
      ...storage,
      setItem: (key: string, value: string) => {
        events.push('persist');
        storage.setItem(key, value);
      },
    };

    const result = await persistSettingsWhileLocked({
      ...options(
        tracedStorage,
        (current) => ({ ...current, behavior: { ...current.behavior, capturePaused: false } }),
        async () => {
          events.push('publish');
          expect(JSON.parse(storage.getItem(storageKey) as string).behavior.capturePaused).toBe(false);
        },
        async () => {
          events.push('invalidate');
          expect(JSON.parse(storage.getItem(storageKey) as string).behavior.capturePaused).toBe(true);
        },
      ),
    });

    expect(result.ok).toBe(true);
    expect(events).toEqual(['invalidate', 'persist', 'publish']);
  });

  it('does not persist or publish a privacy change when native invalidation fails', async () => {
    const original: FixtureSettings = {
      appearance: { theme: 'dark' },
      behavior: { capturePaused: true, captureBlocklist: ['KeePass'] },
    };
    const storage = createStorage(original);
    let publishes = 0;
    const result = await persistSettingsWhileLocked(options(
      storage,
      (current) => ({ ...current, behavior: { ...current.behavior, capturePaused: false } }),
      async () => { publishes += 1; },
      async () => { throw new Error('native invalidation unavailable'); },
    ));

    expect(result.ok).toBe(false);
    expect(result.settings).toEqual(original);
    expect(JSON.parse(storage.getItem(storageKey) as string)).toEqual(original);
    expect(publishes).toBe(0);
  });

  it('keeps the requested privacy setting and leaves capture invalidated when publication fails', async () => {
    const storage = createStorage({
      appearance: { theme: 'dark' },
      behavior: { capturePaused: true, captureBlocklist: ['KeePass'] },
    });
    let invalidations = 0;
    let publishes = 0;
    const result = await persistSettingsWhileLocked(options(
      storage,
      (current) => ({ ...current, behavior: { ...current.behavior, capturePaused: false } }),
      async () => {
        publishes += 1;
        throw new Error('native confirmation failed');
      },
      async () => { invalidations += 1; },
    ));

    expect(result.ok).toBe(false);
    expect(result.settings?.behavior.capturePaused).toBe(false);
    expect(JSON.parse(storage.getItem(storageKey) as string).behavior.capturePaused).toBe(false);
    expect(publishes).toBe(1);
    expect(invalidations).toBe(2);
  });
});
