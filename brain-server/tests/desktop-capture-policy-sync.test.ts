import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapturePolicySynchronizer, hasCapturePolicyChanged } from '../../desktop-daemon/src/lib/capture-policy-sync';

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
  ipcHandler = async () => undefined;
  ipcWindow = {};
  ipcWindow.__TAURI_IPC__ = (message: IpcMessage) => {
    messages.push(message);
    void Promise.resolve().then(() => ipcHandler(message)).then(
      (result) => ipcWindow[`_${message.callback}`]?.(result),
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
      'sync_capture_policy',
      'invalidate_capture_policy',
    ]);
    // Tauri v1 rejects invoke promises with the native error payload, which
    // may be a string rather than a JavaScript Error instance.
    expect(results[0]).toEqual(expect.any(String));

    persisted = JSON.stringify({ behavior: { capturePaused: true, captureBlocklist: ['updated'] } });
    expect(await synchronizer.sync()).toBe(true);
    expect(messages.map((message) => message.cmd)).toEqual([
      'sync_capture_policy',
      'invalidate_capture_policy',
      'sync_capture_policy',
    ]);
    expect(messages[2]).toMatchObject({ capturePaused: true, captureBlocklist: ['updated'] });
    expect(results[1]).toBeNull();
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
    expect(messages.map((message) => message.cmd)).toEqual(['invalidate_capture_policy']);
    expect(results[0]).toBeInstanceOf(Error);

    persisted = '{corrupt json';
    expect(await synchronizer.sync()).toBe(false);
    expect(messages.map((message) => message.cmd)).toEqual([
      'invalidate_capture_policy',
      'invalidate_capture_policy',
    ]);
    expect(results[1]).toBeInstanceOf(Error);
  });

  it('keeps legacy defaults while preserving an explicitly empty sensitive-app list', async () => {
    let persisted: string | null = JSON.stringify({ behavior: { autoHUD: true } });
    const synchronizer = createCapturePolicySynchronizer({
      readPersistedSettings: () => persisted,
      invokeNative,
      defaults,
    });

    expect(await synchronizer.sync()).toBe(true);
    expect(messages[0]).toMatchObject({ capturePaused: true, captureBlocklist: ['KeePass', 'Bank'] });
    persisted = JSON.stringify({ behavior: { capturePaused: false, captureBlocklist: [] } });
    await synchronizer.sync();
    expect(messages[1]).toMatchObject({ capturePaused: false, captureBlocklist: [] });
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
