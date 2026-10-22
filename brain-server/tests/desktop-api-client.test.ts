import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcMessage = { cmd: string; callback: number; error: number };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let invokeToken: ReturnType<typeof vi.fn>;
let fetchRequest: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_BRAIN_URL', '');
  invokeToken = vi.fn().mockResolvedValue('fixture-desktop-token');
  fetchRequest = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchRequest);

  // Exercise the real Tauri invoke adapter, but never start a native app,
  // read its token file, or contact an existing Brain instance.
  const ipcWindow: Record<string, any> = { crypto: webcrypto };
  ipcWindow.__TAURI_IPC__ = (message: IpcMessage) => {
    void Promise.resolve().then(() => invokeToken(message.cmd)).then(
      (token) => ipcWindow[`_${message.callback}`](token),
      (error) => ipcWindow[`_${message.error}`](error),
    );
  };
  vi.stubGlobal('window', ipcWindow);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function sentHeaders(index = 0): Headers {
  return new Headers(fetchRequest.mock.calls[index][1].headers);
}

describe('Desktop authenticated API client', () => {
  it('uses the native server IPv4 loopback default and the local-token command', async () => {
    const { apiFetch, BRAIN_URL } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/entities?limit=5');

    expect(BRAIN_URL).toBe('http://127.0.0.1:3001');
    expect(fetchRequest).toHaveBeenCalledWith('http://127.0.0.1:3001/api/entities?limit=5', expect.any(Object));
    expect(invokeToken).toHaveBeenCalledTimes(1);
    expect(invokeToken).toHaveBeenCalledWith('get_local_api_token');
    expect(sentHeaders().get('authorization')).toBe('Bearer fixture-desktop-token');
    expect(sentHeaders().get('content-type')).toBe('application/json');
  });

  it('preserves the explicitly configured build-time Brain URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAIN_URL', 'http://127.0.0.1:36123');
    const { apiFetch, BRAIN_URL } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/stats');

    expect(BRAIN_URL).toBe('http://127.0.0.1:36123');
    expect(fetchRequest.mock.calls[0][0]).toBe('http://127.0.0.1:36123/api/stats');
  });

  it('retries token acquisition on the next request after a transient invoke failure', async () => {
    invokeToken.mockRejectedValueOnce(new Error('fixture bridge not ready'));
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/entities');
    await apiFetch('/api/entities');
    await apiFetch('/api/stats');

    expect(sentHeaders(0).has('authorization')).toBe(false);
    expect(sentHeaders(1).get('authorization')).toBe('Bearer fixture-desktop-token');
    expect(sentHeaders(2).get('authorization')).toBe('Bearer fixture-desktop-token');
    expect(invokeToken).toHaveBeenCalledTimes(2);
    expect(fetchRequest).toHaveBeenCalledTimes(3);
  });

  it('does not memoize an empty token as a permanent unavailable bridge', async () => {
    invokeToken.mockResolvedValueOnce('');
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/entities');
    await apiFetch('/api/entities');

    expect(sentHeaders(0).has('authorization')).toBe(false);
    expect(sentHeaders(1).get('authorization')).toBe('Bearer fixture-desktop-token');
    expect(invokeToken).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent token reads without deduplicating HTTP requests', async () => {
    const token = deferred<string>();
    const started = deferred<void>();
    invokeToken.mockImplementation(() => {
      started.resolve();
      return token.promise;
    });
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    const first = apiFetch('/api/entities');
    const second = apiFetch('/api/stats');
    await started.promise;
    expect(invokeToken).toHaveBeenCalledTimes(1);
    expect(fetchRequest).not.toHaveBeenCalled();
    token.resolve('fixture-shared-token');
    await Promise.all([first, second]);

    expect(invokeToken).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(sentHeaders(0).get('authorization')).toBe('Bearer fixture-shared-token');
    expect(sentHeaders(1).get('authorization')).toBe('Bearer fixture-shared-token');
  });

  it('rejects an already aborted request without reading a token or sending HTTP', async () => {
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');
    const controller = new AbortController();
    controller.abort();

    await expect(apiFetch('/api/ingest/file', {
      method: 'POST', body: '{}', signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(invokeToken).not.toHaveBeenCalled();
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it('settles cancellation while native token acquisition hangs and never sends the cancelled write later', async () => {
    const token = deferred<string>();
    const started = deferred<void>();
    invokeToken.mockImplementation(() => { started.resolve(); return token.promise; });
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');
    vi.useFakeTimers();
    const controller = new AbortController();
    const abortReason = new DOMException('Fixture caller stopped waiting', 'AbortError');
    const request = apiFetch('/api/ingest/file', {
      method: 'POST', body: '{}', signal: controller.signal,
    }).catch((error: unknown) => error);
    await started.promise;

    controller.abort(abortReason);
    const outcome = Promise.race([
      request,
      new Promise<string>((resolve) => setTimeout(() => resolve('fixture still pending'), 1)),
    ]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe(abortReason);
    expect(fetchRequest).not.toHaveBeenCalled();

    token.resolve('fixture-eventual-token');
    await apiFetch('/api/stats');
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest.mock.calls[0][0]).toContain('/api/stats');
    expect(sentHeaders().get('authorization')).toBe('Bearer fixture-eventual-token');
  });

  it('cancels only its caller while a shared unsignalled token read remains pending without a global timeout', async () => {
    const token = deferred<string>();
    const started = deferred<void>();
    invokeToken.mockImplementation(() => { started.resolve(); return token.promise; });
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');
    vi.useFakeTimers();
    const controller = new AbortController();
    const cancelled = apiFetch('/api/cancelled', { signal: controller.signal }).catch((error: unknown) => error);
    const continuing = apiFetch('/api/continuing');
    let continuingSettled = false;
    void continuing.finally(() => { continuingSettled = true; });
    await started.promise;

    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(continuingSettled).toBe(false);
    expect(fetchRequest).not.toHaveBeenCalled();

    token.resolve('fixture-shared-token');
    await continuing;
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(invokeToken).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest.mock.calls[0][0]).toContain('/api/continuing');
  });

  it('invalidates a successful cached token when the caller clears it', async () => {
    invokeToken.mockResolvedValueOnce('fixture-old-token').mockResolvedValueOnce('fixture-new-token');
    const { apiFetch, clearTokenCache } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/entities');
    clearTokenCache();
    await apiFetch('/api/entities');

    expect(invokeToken).toHaveBeenCalledTimes(2);
    expect(sentHeaders(0).get('authorization')).toBe('Bearer fixture-old-token');
    expect(sentHeaders(1).get('authorization')).toBe('Bearer fixture-new-token');
  });

  it.each(['resolve', 'reject'] as const)(
    'does not reinstate a stale token or lose the current flight after a cleared read %ss',
    async (completion) => {
      const oldToken = deferred<string>();
      const newToken = deferred<string>();
      const oldStarted = deferred<void>();
      const newStarted = deferred<void>();
      invokeToken
        .mockImplementationOnce(() => { oldStarted.resolve(); return oldToken.promise; })
        .mockImplementationOnce(() => { newStarted.resolve(); return newToken.promise; });
      const { apiFetch, clearTokenCache } = await import('../../desktop-daemon/src/lib/api-client');

      const first = apiFetch('/api/entities');
      await oldStarted.promise;
      clearTokenCache();
      const second = apiFetch('/api/stats');
      await newStarted.promise;
      if (completion === 'resolve') oldToken.resolve('fixture-stale-token');
      else oldToken.reject(new Error('fixture old bridge failed'));
      newToken.resolve('fixture-current-token');
      await Promise.all([first, second]);
      await apiFetch('/api/entities');

      expect(invokeToken).toHaveBeenCalledTimes(2);
      expect(fetchRequest).toHaveBeenCalledTimes(3);
      for (let index = 0; index < 3; index++) {
        expect(sentHeaders(index).get('authorization')).toBe('Bearer fixture-current-token');
      }
    },
  );

  it('keeps the current cached token when an older read completes last', async () => {
    const oldToken = deferred<string>();
    const oldStarted = deferred<void>();
    invokeToken
      .mockImplementationOnce(() => { oldStarted.resolve(); return oldToken.promise; })
      .mockResolvedValueOnce('fixture-current-token');
    const { apiFetch, clearTokenCache } = await import('../../desktop-daemon/src/lib/api-client');

    const first = apiFetch('/api/entities');
    await oldStarted.promise;
    clearTokenCache();
    await apiFetch('/api/stats');
    oldToken.resolve('fixture-stale-token');
    await first;
    await apiFetch('/api/entities');

    expect(invokeToken).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 3; index++) {
      expect(sentHeaders(index).get('authorization')).toBe('Bearer fixture-current-token');
    }
  });

  it.each([
    ['record', () => ({ 'Content-Type': 'text/plain', 'X-Trace': 'fixture-trace' })],
    ['Headers', () => new Headers({ 'Content-Type': 'text/plain', 'X-Trace': 'fixture-trace' })],
    ['tuple list', () => [['content-type', 'text/plain'], ['x-trace', 'fixture-trace']] as [string, string][]],
  ] as const)('preserves %s headers and does not mutate the caller input', async (_kind, makeHeaders) => {
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');
    const headers = makeHeaders();

    await apiFetch('/api/entities', { headers });

    expect(sentHeaders().get('content-type')).toBe('text/plain');
    expect(sentHeaders().get('x-trace')).toBe('fixture-trace');
    expect(sentHeaders().get('authorization')).toBe('Bearer fixture-desktop-token');
    expect(new Headers(headers).has('authorization')).toBe(false);
  });

  it('sets one local authorization header regardless of caller casing', async () => {
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/entities', { headers: [['authorization', 'Bearer fixture-other-token']] });

    expect(sentHeaders().get('authorization')).toBe('Bearer fixture-desktop-token');
  });

  it('preserves explicit caller authorization when the native bridge is unavailable', async () => {
    invokeToken.mockRejectedValue(new Error('fixture browser-only environment'));
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/entities', { headers: new Headers({ Authorization: 'Bearer fixture-caller-token' }) });

    expect(sentHeaders().get('authorization')).toBe('Bearer fixture-caller-token');
  });

  it.each([401, 403, 500])('returns HTTP %i without replaying a mutation or acquiring another token', async (status) => {
    const response = new Response(JSON.stringify({ error: 'fixture failure' }), { status });
    fetchRequest.mockResolvedValue(response);
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');
    const body = JSON.stringify({ arguments: { situation: 'fixture choice', conclusion: 'fixture choice A' } });
    const controller = new AbortController();

    const actual = await apiFetch('/api/mcp/tool/save_decision', {
      method: 'POST', body, signal: controller.signal,
    });

    expect(actual).toBe(response);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(invokeToken).toHaveBeenCalledTimes(1);
    expect(fetchRequest.mock.calls[0][1]).toMatchObject({ method: 'POST', body, signal: controller.signal });
  });

  it('refreshes a denied token only for the next explicit request without replaying the first write', async () => {
    invokeToken.mockResolvedValueOnce('fixture-old-token').mockResolvedValueOnce('fixture-rotated-token');
    const denied = new Response(null, { status: 401 });
    fetchRequest.mockResolvedValueOnce(denied).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    expect(await apiFetch('/api/ingest/file', { method: 'POST', body: '{}' })).toBe(denied);
    expect(invokeToken).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    await apiFetch('/api/ingest/jobs/fixture-job');

    expect(invokeToken).toHaveBeenCalledTimes(2);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(sentHeaders(0).get('authorization')).toBe('Bearer fixture-old-token');
    expect(sentHeaders(1).get('authorization')).toBe('Bearer fixture-rotated-token');
    expect(fetchRequest.mock.calls[1][0]).toContain('/api/ingest/jobs/fixture-job');
  });

  it.each(['pending', 'cached'] as const)(
    'does not invalidate a newer %s token when another old HTTP 401 arrives late',
    async (currentState) => {
      const lateResponse = deferred<Response>();
      const oldRequestSent = deferred<void>();
      const newToken = deferred<string>();
      const newStarted = deferred<void>();
      invokeToken
        .mockResolvedValueOnce('fixture-old-token')
        .mockImplementationOnce(() => { newStarted.resolve(); return newToken.promise; });
      fetchRequest
        .mockImplementationOnce(() => { oldRequestSent.resolve(); return lateResponse.promise; })
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockImplementation(async () => new Response(null, { status: 204 }));
      const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

      const late = apiFetch('/api/old-request');
      await oldRequestSent.promise;
      await apiFetch('/api/first-denied');
      const refreshing = apiFetch('/api/resume');
      await newStarted.promise;
      if (currentState === 'cached') {
        newToken.resolve('fixture-new-token');
        await refreshing;
      }
      lateResponse.resolve(new Response(null, { status: 401 }));
      await late;
      const joined = apiFetch('/api/follow-up');
      if (currentState === 'pending') newToken.resolve('fixture-new-token');
      await Promise.all([refreshing, joined]);

      expect(invokeToken).toHaveBeenCalledTimes(2);
      expect(fetchRequest).toHaveBeenCalledTimes(4);
      expect(sentHeaders(2).get('authorization')).toBe('Bearer fixture-new-token');
      expect(sentHeaders(3).get('authorization')).toBe('Bearer fixture-new-token');
    },
  );

  it('does not discard a newly acquired token because an older unauthenticated request receives HTTP 401', async () => {
    const lateResponse = deferred<Response>();
    const oldRequestSent = deferred<void>();
    invokeToken.mockResolvedValueOnce('').mockResolvedValueOnce('fixture-current-token');
    fetchRequest
      .mockImplementationOnce(() => { oldRequestSent.resolve(); return lateResponse.promise; })
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    const old = apiFetch('/api/without-token');
    await oldRequestSent.promise;
    await apiFetch('/api/with-token');
    lateResponse.resolve(new Response(null, { status: 401 }));
    await old;
    await apiFetch('/api/follow-up');

    expect(invokeToken).toHaveBeenCalledTimes(2);
    expect(sentHeaders(0).has('authorization')).toBe(false);
    expect(sentHeaders(2).get('authorization')).toBe('Bearer fixture-current-token');
  });

  it.each([403, 500])('keeps a successful token cached after HTTP %i', async (status) => {
    fetchRequest.mockResolvedValueOnce(new Response(null, { status })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    await apiFetch('/api/ingest/file', { method: 'POST', body: '{}' });
    await apiFetch('/api/stats');

    expect(invokeToken).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it('propagates a network failure without replaying the request', async () => {
    const error = new Error('fixture network unavailable');
    fetchRequest.mockRejectedValue(error);
    const { apiFetch } = await import('../../desktop-daemon/src/lib/api-client');

    await expect(apiFetch('/api/entities', { method: 'POST', body: '{}' })).rejects.toBe(error);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(invokeToken).toHaveBeenCalledTimes(1);
  });
});
