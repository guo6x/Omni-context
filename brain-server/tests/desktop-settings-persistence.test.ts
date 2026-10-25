import { describe, expect, it } from 'vitest';
import { CapturePolicySaveNotAppliedError, capturePolicySyncErrorFromSave, persistSettingsWhileLocked, withNativeCaptureRevocation } from '../../desktop-daemon/src/lib/settings-persistence';

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
  it('revokes native capture before a failing cross-window lock', async () => {
    const events: string[] = [];
    await expect(withNativeCaptureRevocation(
      true,
      true,
      async () => { events.push('invalidate'); },
      async () => { events.push('lock'); throw new Error('lock unavailable'); },
    )).rejects.toBeInstanceOf(CapturePolicySaveNotAppliedError);
    expect(events).toEqual(['invalidate', 'lock']);
  });

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

  it.each([
    ['localStorage getItem throws', () => { throw new Error('storage unavailable'); }],
    ['persisted settings are malformed', () => '{malformed json'],
  ])('keeps capture revoked when %s during a privacy update', async (_case, readValue) => {
    const events: string[] = [];
    let writes = 0;
    let publishes = 0;
    const storage = {
      getItem: () => {
        events.push('read');
        return readValue();
      },
      setItem: () => { writes += 1; },
      removeItem: () => {},
    };

    const result = await withNativeCaptureRevocation(
      true,
      true,
      async () => { events.push('invalidate'); },
      () => persistSettingsWhileLocked({
        ...options(
          storage,
          (current) => ({ ...current, behavior: { ...current.behavior, capturePaused: true } }),
          async () => { publishes += 1; },
        ),
        nativePolicyAlreadyInvalidated: true,
      }),
    );

    expect(events).toEqual(['invalidate', 'read']);
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(CapturePolicySaveNotAppliedError);
    expect(capturePolicySyncErrorFromSave(true, result)).toBe(result.error);
    expect(writes).toBe(0);
    expect(publishes).toBe(0);
  });

  it('revokes capture and does not republish an older permissive policy when a privacy write fails', async () => {
    const original: FixtureSettings = {
      appearance: { theme: 'dark' },
      behavior: { capturePaused: false, captureBlocklist: ['KeePass'] },
    };
    const storage = createStorage(original);
    const events: string[] = [];
    const failingStorage = {
      ...storage,
      setItem: () => { throw new Error('storage full'); },
    };
    const result = await withNativeCaptureRevocation(
      true,
      true,
      async () => { events.push('invalidate'); },
      () => persistSettingsWhileLocked({
        ...options(
          {
            ...failingStorage,
            setItem: () => {
              events.push('persist');
              throw new Error('storage full');
            },
          },
          (current) => ({ ...current, behavior: { ...current.behavior, capturePaused: true } }),
          async () => { events.push('publish'); },
        ),
        nativePolicyAlreadyInvalidated: true,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(CapturePolicySaveNotAppliedError);
    expect(JSON.parse(storage.getItem(storageKey) as string)).toEqual(original);
    expect(events).toEqual(['invalidate', 'persist']);
    expect(capturePolicySyncErrorFromSave(true, result)).toBe(result.error);
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

  it('revokes native capture again when the final read fails after policy publication', async () => {
    const original: FixtureSettings = {
      appearance: { theme: 'dark' },
      behavior: { capturePaused: false, captureBlocklist: ['KeePass'] },
    };
    const backingStorage = createStorage(original);
    const events: string[] = [];
    let reads = 0;
    let revocations = 0;
    let publications = 0;
    const storage = {
      ...backingStorage,
      getItem: (key: string) => {
        reads += 1;
        events.push(`read-${reads}`);
        if (reads === 3) throw new Error('final settings read failed');
        return backingStorage.getItem(key);
      },
      setItem: (key: string, value: string) => {
        events.push('persist');
        backingStorage.setItem(key, value);
      },
    };
    const invalidateCapturePolicy = async () => {
      revocations += 1;
      events.push(`invalidate-${revocations}`);
    };

    const result = await withNativeCaptureRevocation(
      true,
      true,
      invalidateCapturePolicy,
      () => persistSettingsWhileLocked({
        ...options(
          storage,
          (current) => ({ ...current, behavior: { ...current.behavior, capturePaused: true } }),
          async () => {
            publications += 1;
            events.push('publish');
          },
          invalidateCapturePolicy,
        ),
        nativePolicyAlreadyInvalidated: true,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.settings).toBeNull();
    expect(result.error).toBeInstanceOf(CapturePolicySaveNotAppliedError);
    expect(capturePolicySyncErrorFromSave(true, result)).toBe(result.error);
    expect(JSON.parse(backingStorage.getItem(storageKey) as string).behavior.capturePaused).toBe(true);
    expect(reads).toBe(3);
    expect(publications).toBe(1);
    expect(revocations).toBe(2);
    expect(events).toEqual([
      'invalidate-1',
      'read-1',
      'persist',
      'publish',
      'read-2',
      'read-3',
      'invalidate-2',
    ]);
  });
});
