import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapturePolicyReconfirmationRequiredError, createCapturePolicySynchronizer, hasCapturePolicyChanged, NativeCaptureRevocationUnconfirmedError } from '../../desktop-daemon/src/lib/capture-policy-sync';
import { persistSettingsWhileLocked, withNativeCaptureRevocation } from '../../desktop-daemon/src/lib/settings-persistence';

type IpcMessage = {
  cmd: string;
  callback: number;
  error: number;
  [key: string]: unknown;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

let messages: IpcMessage[];
let ipcWindow: Record<string, any>;
let ipcHandler: (message: IpcMessage) => Promise<unknown>;
let nextCallbackId: number;
let ipcRevision: number;

function invokeNative(command: string, args?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callback = nextCallbackId++;
    const error = nextCallbackId++;
    ipcWindow[`_${callback}`] = resolve;
    ipcWindow[`_${error}`] = reject;
    ipcWindow.__TAURI_IPC__({ ...args, cmd: command, callback, error });
  });
}

beforeEach(() => {
  vi.resetModules();
  messages = [];
  nextCallbackId = 1;
  ipcRevision = 0;
  ipcHandler = async () => undefined;
  ipcWindow = {};
  ipcWindow.__TAURI_IPC__ = (message: IpcMessage) => {
    messages.push(message);
    void Promise.resolve().then(() => ipcHandler(message)).then(
      (result) => {
        const response = result === undefined && message.cmd === 'invalidate_capture_policy'
          ? ++ipcRevision
          : result;
        ipcWindow[`_${message.callback}`]?.(response);
      },
      (error) => ipcWindow[`_${message.error}`]?.(String(error)),
    );
  };
  vi.stubGlobal('window', ipcWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const defaults = {
  capturePaused: true,
  captureBlocklist: ['KeePass', 'Bank'],
};

describe('native capture-policy settings synchronization', () => {
  it('serializes concurrent startup syncs and rereads the latest persisted snapshot', async () => {
    const firstStarted = deferred<IpcMessage>();
    const finishFirst = deferred<void>();
    let syncCalls = 0;
    let active = 0;
    let maxActive = 0;
    ipcHandler = async (message) => {
      if (message.cmd !== 'sync_capture_policy') return undefined;
      syncCalls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (syncCalls === 1) {
        firstStarted.resolve(message);
        await finishFirst.promise;
      }
      active -= 1;
      return undefined;
    };

    let persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: ['old'] } });
    const results: unknown[] = [];
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
      onResult: (error) => results.push(error),
    });

    const first = synchronizer.sync();
    const firstMessage = await firstStarted.promise;
    const second = synchronizer.sync();
    persisted = JSON.stringify({ behavior: { capturePaused: true, captureBlocklist: ['new'] } });
    await Promise.resolve();

    expect(firstMessage).toMatchObject({ capturePaused: false, captureBlocklist: ['old'] });
    expect(messages.filter((message) => message.cmd === 'sync_capture_policy')).toHaveLength(1);
    finishFirst.resolve();
    expect(await Promise.all([first, second])).toEqual([true, true]);

    const syncMessages = messages.filter((message) => message.cmd === 'sync_capture_policy');
    expect(syncMessages).toHaveLength(2);
    expect(syncMessages[1]).toMatchObject({ capturePaused: true, captureBlocklist: ['new'] });
    expect(maxActive).toBe(1);
    expect(results).toEqual([null, null]);
  });

  it('coordinates separate WebView synchronizers and publishes the latest value after the lock', async () => {
    const firstStarted = deferred<void>();
    const finishFirst = deferred<void>();
    const runExclusive = createSharedLock();
    let persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: ['first'] } });
    let active = 0;
    let maxActive = 0;
    ipcHandler = async (message) => {
      if (message.cmd !== 'sync_capture_policy') return undefined;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 1 && (message.captureBlocklist as string[])[0] === 'first') {
        firstStarted.resolve();
        await finishFirst.promise;
      }
      active -= 1;
      return undefined;
    };

    const firstWindow = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
      runExclusive,
    });
    const secondWindow = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
      runExclusive,
    });

    const first = firstWindow.sync();
    await firstStarted.promise;
    persisted = JSON.stringify({ behavior: { capturePaused: true, captureBlocklist: ['latest'] } });
    const second = secondWindow.sync();
    await Promise.resolve();
    expect(messages.filter((message) => message.cmd === 'sync_capture_policy')).toHaveLength(1);

    finishFirst.resolve();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    const syncMessages = messages.filter((message) => message.cmd === 'sync_capture_policy');
    expect(syncMessages).toHaveLength(2);
    expect(syncMessages[1]).toMatchObject({ capturePaused: true, captureBlocklist: ['latest'] });
    expect(maxActive).toBe(1);
  });

  it('invalidates after native rejection and permits a later retry to confirm the latest policy', async () => {
    let rejectFirstSync = true;
    ipcHandler = async (message) => {
      if (message.cmd === 'sync_capture_policy' && rejectFirstSync) {
        rejectFirstSync = false;
        throw new Error('fixture native policy rejected');
      }
      return undefined;
    };

    let persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: [] } });
    const results: unknown[] = [];
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
      onResult: (error) => results.push(error),
    });

    expect(await synchronizer.sync()).toBe(false);
    expect(messages.map((message) => message.cmd)).toEqual([
      'invalidate_capture_policy',
      'sync_capture_policy',
      'invalidate_capture_policy',
    ]);
    // Tauri v1 rejects invoke promises with the native error payload, which
    // may be a string rather than a JavaScript Error instance.
    expect(results[0]).toEqual(expect.any(String));

    persisted = JSON.stringify({ behavior: { capturePaused: true, captureBlocklist: ['updated'] } });
    expect(await synchronizer.sync()).toBe(true);
    expect(messages.map((message) => message.cmd)).toEqual([
      'invalidate_capture_policy',
      'sync_capture_policy',
      'invalidate_capture_policy',
      'invalidate_capture_policy',
      'sync_capture_policy',
    ]);
    expect(messages[4]).toMatchObject({ capturePaused: true, captureBlocklist: ['updated'], expectedGeneration: 3 });
    expect(results[1]).toBeNull();
  });

  it('keeps a failed privacy save revoked after restart until the user confirms a safe setting', async () => {
    let generation = 0;
    let durableRevocationLatch = false;
    let nativePolicy: { capturePaused: boolean; captureBlocklist: string[] } | null = null;
    ipcHandler = async (message) => {
      if (message.cmd === 'invalidate_capture_policy') {
        generation += 1;
        if (message.requireReconfirmation === true) durableRevocationLatch = true;
        nativePolicy = null;
        return generation;
      }
      if (message.cmd !== 'sync_capture_policy') return undefined;
      if (durableRevocationLatch && message.explicitConfirmation !== true) {
        throw new Error('capture policy remains revoked; explicit privacy settings confirmation required');
      }
      nativePolicy = {
        capturePaused: Boolean(message.capturePaused),
        captureBlocklist: message.captureBlocklist as string[],
      };
      if (message.explicitConfirmation === true) durableRevocationLatch = false;
      return undefined;
    };

    let persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: [] } });
    const firstProcess = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
    });
    expect(await firstProcess.sync()).toBe(true);
    expect(nativePolicy?.capturePaused).toBe(false);

    // A user requests pause. Native revoke is durable before the WebView save;
    // the simulated localStorage write fails, leaving the old active JSON.
    const failedSave = await withNativeCaptureRevocation(
      true,
      true,
      () => firstProcess.invalidate(),
      () => persistSettingsWhileLocked({
        storage: {
          getItem: () => persisted,
          setItem: () => { throw new Error('fixture storage quota exhausted'); },
          removeItem: () => {},
        },
        storageKey: 'omnicontext-settings',
        defaults,
        currentFromStorage: (raw) => {
          if (!raw) throw new Error('settings fixture missing');
          return JSON.parse(raw) as { behavior: { capturePaused: boolean; captureBlocklist: string[] } };
        },
        update: (current) => ({
          ...current,
          behavior: { ...current.behavior, capturePaused: true },
        }),
        isNativeRuntime: true,
        nativePolicyAlreadyInvalidated: true,
        invalidateCapturePolicy: () => firstProcess.invalidate(),
        syncCapturePolicy: () => firstProcess.withExclusive((syncLatestPolicy) => syncLatestPolicy()),
      }),
    );
    expect(failedSave.ok).toBe(false);
    expect(persisted).toContain('"capturePaused":false');
    expect(durableRevocationLatch).toBe(true);
    expect(nativePolicy).toBeNull();

    // Reconstructing the WebView/native synchronizer models relaunch. Startup
    // synchronization is not user consent and cannot restore the old setting.
    const startupErrors: unknown[] = [];
    const restartedProcess = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
      onResult: (error) => startupErrors.push(error),
    });
    expect(await restartedProcess.sync()).toBe(false);
    expect(startupErrors[0]).toBeInstanceOf(CapturePolicyReconfirmationRequiredError);
    expect(durableRevocationLatch).toBe(true);
    expect(nativePolicy).toBeNull();

    // The UI recovery action first persists capturePaused=true, then sends an
    // explicit confirmation. Only that path can clear the native latch.
    persisted = JSON.stringify({ behavior: { capturePaused: true, captureBlocklist: [] } });
    expect(await restartedProcess.sync(true)).toBe(true);
    expect(durableRevocationLatch).toBe(false);
    expect(nativePolicy).toMatchObject({ capturePaused: true, captureBlocklist: [] });
  });

  it('times out a hung native sync, attempts invalidation, and never reports confirmation', async () => {
    ipcHandler = async (message) => {
      if (message.cmd === 'sync_capture_policy') return new Promise<never>(() => {});
      return undefined;
    };
    const results: unknown[] = [];
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: [] } }),
      invokeNative,
      defaults,
      timeoutMs: 10,
      onResult: (error) => results.push(error),
    });

    expect(await synchronizer.sync()).toBe(false);
    expect(messages.map((message) => message.cmd)).toEqual([
      'invalidate_capture_policy',
      'sync_capture_policy',
      'invalidate_capture_policy',
    ]);
    expect(results[0]).toEqual(expect.any(Error));
    expect(String(results[0])).toContain('timed out');
  });

  it('rejects a timed-out permissive sync that arrives after a newer pause revocation', async () => {
    const staleSyncStarted = deferred<void>();
    const finishStaleSync = deferred<void>();
    const staleSyncRejected = deferred<void>();
    let nativeGeneration = 0;
    let persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: [] } });
    let confirmedPolicy: { capturePaused: boolean; captureBlocklist: string[] } | null = null;

    ipcHandler = async (message) => {
      if (message.cmd === 'invalidate_capture_policy') {
        nativeGeneration += 1;
        return nativeGeneration;
      }
      if (message.cmd !== 'sync_capture_policy') return undefined;

      const expectedGeneration = Number(message.expectedGeneration);
      if (expectedGeneration === 1) {
        staleSyncStarted.resolve();
        await finishStaleSync.promise;
      }
      if (expectedGeneration !== nativeGeneration) {
        staleSyncRejected.resolve();
        throw new Error('stale capture policy confirmation denied');
      }
      confirmedPolicy = {
        capturePaused: Boolean(message.capturePaused),
        captureBlocklist: message.captureBlocklist as string[],
      };
      return undefined;
    };

    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
      timeoutMs: 20,
    });

    const staleSync = synchronizer.sync();
    await staleSyncStarted.promise;
    persisted = JSON.stringify({ behavior: { capturePaused: true, captureBlocklist: ['Bank'] } });
    expect(await staleSync).toBe(false);
    // The timed-out native IPC is still pending. Its older generation must
    // not restore the prior permissive snapshot after the pause was requested.
    finishStaleSync.resolve();
    await staleSyncRejected.promise;
    expect(confirmedPolicy).toBeNull();

    expect(await synchronizer.sync()).toBe(true);
    expect(confirmedPolicy).toEqual({ capturePaused: true, captureBlocklist: ['Bank'] });
    const syncMessages = messages.filter((message) => message.cmd === 'sync_capture_policy');
    expect(syncMessages).toHaveLength(2);
    expect(syncMessages[0].expectedGeneration).toBeLessThan(syncMessages[1].expectedGeneration as number);
  });

  it('invalidates malformed persisted settings without publishing an unsafe fallback', async () => {
    let persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: ['safe', 42] } });
    const results: unknown[] = [];
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
      onResult: (error) => results.push(error),
    });

    expect(await synchronizer.sync()).toBe(false);
    expect(messages.map((message) => message.cmd)).toEqual([
      'invalidate_capture_policy',
      'invalidate_capture_policy',
    ]);
    expect(results[0]).toBeInstanceOf(CapturePolicyReconfirmationRequiredError);

    persisted = '{corrupt json';
    expect(await synchronizer.sync()).toBe(false);
    expect(messages.map((message) => message.cmd)).toEqual([
      'invalidate_capture_policy',
      'invalidate_capture_policy',
      'invalidate_capture_policy',
      'invalidate_capture_policy',
    ]);
    expect(results[1]).toBeInstanceOf(CapturePolicyReconfirmationRequiredError);
  });

  it('does not treat an invalidation response without a generation as confirmed', async () => {
    ipcHandler = async (message) => message.cmd === 'invalidate_capture_policy' ? null : undefined;
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => null,
      invokeNative,
      defaults,
    });

    await expect(synchronizer.invalidate()).rejects.toBeInstanceOf(NativeCaptureRevocationUnconfirmedError);
    expect(messages.map((message) => message.cmd)).toEqual(['invalidate_capture_policy']);
  });

  it('surfaces a timed-out revocation as unconfirmed and never starts a policy sync', async () => {
    ipcHandler = async (message) => {
      if (message.cmd === 'invalidate_capture_policy') return new Promise<never>(() => {});
      return undefined;
    };
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: [] } }),
      invokeNative,
      defaults,
      timeoutMs: 10,
    });

    await expect(synchronizer.invalidate()).rejects.toBeInstanceOf(NativeCaptureRevocationUnconfirmedError);
    expect(messages.map((message) => message.cmd)).toEqual(['invalidate_capture_policy']);
  });

  it('keeps legacy defaults while preserving an explicitly empty sensitive-app list', async () => {
    let persisted: string | null = JSON.stringify({ behavior: { autoHUD: true } });
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
    });

    expect(await synchronizer.sync()).toBe(true);
    expect(messages[0].cmd).toBe('invalidate_capture_policy');
    expect(messages[1]).toMatchObject({ capturePaused: true, captureBlocklist: ['KeePass', 'Bank'], expectedGeneration: 1 });
    persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: [] } });
    await synchronizer.sync();
    expect(messages[3]).toMatchObject({ capturePaused: false, captureBlocklist: [], expectedGeneration: 2 });
  });

  it('distinguishes native capture-policy changes from unrelated settings changes', () => {
    const previous = JSON.stringify({
      appearance: { theme: 'dark' },
      behavior: { capturePaused: false, captureBlocklist: ['Bank'] },
    });
    const unrelated = JSON.stringify({
      appearance: { theme: 'light' },
      behavior: { capturePaused: false, captureBlocklist: ['Bank'] },
    });
    const changed = JSON.stringify({
      appearance: { theme: 'dark' },
      behavior: { capturePaused: true, captureBlocklist: ['Bank'] },
    });

    expect(hasCapturePolicyChanged(previous, unrelated, defaults)).toBe(false);
    expect(hasCapturePolicyChanged(previous, changed, defaults)).toBe(true);
    expect(hasCapturePolicyChanged('{invalid', changed, defaults)).toBe(true);
  });
});
