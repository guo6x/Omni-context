import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../desktop-daemon/src/lib/api-client';
import { useOmniContext } from '../../desktop-daemon/src/hooks/useOmniContext';

vi.mock('../../desktop-daemon/src/lib/api-client', () => ({ apiFetch: vi.fn() }));

// Use the desktop's existing React runtime and real ReactDOM effect lifecycle.
// Only HTTP is mocked; no native app, token, model, socket, or database is used.
const desktopRequire = createRequire(new URL('../../desktop-daemon/package.json', import.meta.url));
const React = desktopRequire('react') as typeof import('../../desktop-daemon/node_modules/@types/react') & {
  act: typeof import('../../desktop-daemon/node_modules/@types/react-dom/test-utils').act;
};
type Root = import('../../desktop-daemon/node_modules/@types/react-dom/client').Root;
const fetchHealth = vi.mocked(apiFetch);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function healthResponse(status = 200, body?: Promise<ArrayBuffer>) {
  const response = new Response(null, { status });
  const drain = vi.spyOn(response, 'arrayBuffer');
  if (body) drain.mockReturnValue(body);
  return response;
}

let dom: JSDOM;
let root: Root | null;
let latest: ReturnType<typeof useOmniContext>;
let renders: number;

function Probe() {
  latest = useOmniContext();
  renders++;
  return null;
}

async function mount(strict = false) {
  await React.act(async () => {
    const probe = React.createElement(Probe);
    root!.render(strict ? React.createElement(React.StrictMode, null, probe) : probe);
  });
}

async function advance(ms: number) {
  await React.act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function unmount() {
  const current = root;
  root = null;
  if (current) await React.act(async () => { current.unmount(); });
}

function signalAt(index: number): AbortSignal {
  return fetchHealth.mock.calls[index][1]?.signal as AbortSignal;
}

function connectionLogs(message: string) {
  return latest.logs.filter((entry) => entry.message === message);
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchHealth.mockReset().mockImplementation(async () => healthResponse());
  dom = new JSDOM('<!doctype html><html><body><div id="fixture-root"></div></body></html>', {
    url: 'http://127.0.0.1/',
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = desktopRequire('react-dom/client') as typeof import('../../desktop-daemon/node_modules/@types/react-dom/client');
  root = createRoot(dom.window.document.getElementById('fixture-root')!);
  renders = 0;
});

afterEach(async () => {
  await unmount();
  dom.window.close();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('desktop health effect lifecycle', () => {
  it('drains health responses, records one connection, and refreshes only on offline-to-online transitions', async () => {
    const response = healthResponse();
    fetchHealth.mockResolvedValue(response);

    await mount();
    expect(latest.status.brain_server_running).toBe(true);
    expect(latest.hasConnectedOnce).toBe(true);
    expect(latest.refreshTrigger).toBe(1);
    expect(connectionLogs('Brain Server 已连接并正常运行')).toHaveLength(1);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(fetchHealth.mock.calls[0][0]).toBe('/health');
    expect(fetchHealth.mock.calls[0][1]).toMatchObject({ method: 'GET', signal: expect.any(AbortSignal) });

    await advance(3000);
    expect(fetchHealth).toHaveBeenCalledTimes(2);
    expect(response.arrayBuffer).toHaveBeenCalledTimes(2);
    expect(latest.refreshTrigger).toBe(1);
    expect(connectionLogs('Brain Server 已连接并正常运行')).toHaveLength(1);
  });

  it('does not fabricate a disconnect during cold-start connection failures', async () => {
    fetchHealth.mockRejectedValue(new TypeError('Fixture server not ready'));

    await mount();
    await advance(3000);

    expect(latest.status.brain_server_running).toBe(false);
    expect(latest.hasConnectedOnce).toBe(false);
    expect(latest.refreshTrigger).toBe(0);
    expect(connectionLogs('Brain Server 连接断开')).toHaveLength(0);
  });

  it.each([401, 403, 503])('marks HTTP %i offline and records each reconnect only once', async (status) => {
    let currentStatus = 200;
    fetchHealth.mockImplementation(async () => healthResponse(currentStatus));
    await mount();

    currentStatus = status;
    await advance(3000);
    expect(latest.status.brain_server_running).toBe(false);
    expect(latest.hasConnectedOnce).toBe(true);
    expect(connectionLogs('Brain Server 连接断开')).toHaveLength(1);
    expect(latest.refreshTrigger).toBe(1);
    await advance(3000);
    expect(connectionLogs('Brain Server 连接断开')).toHaveLength(1);

    currentStatus = 200;
    await advance(3000);
    expect(latest.status.brain_server_running).toBe(true);
    expect(latest.refreshTrigger).toBe(2);
    expect(connectionLogs('Brain Server 已连接并正常运行')).toHaveLength(2);
  });

  it('marks a network failure offline while keeping the ever-connected startup flag', async () => {
    await mount();
    fetchHealth.mockRejectedValue(new TypeError('Fixture connection lost'));

    await advance(3000);

    expect(latest.status.brain_server_running).toBe(false);
    expect(latest.hasConnectedOnce).toBe(true);
    expect(connectionLogs('Brain Server 连接断开')).toHaveLength(1);
  });

  it('never overlaps probes while the HTTP response is pending', async () => {
    const response = deferred<Response>();
    fetchHealth.mockImplementationOnce(() => response.promise);
    await mount();

    await advance(9000);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    await React.act(async () => { response.resolve(healthResponse()); });
    expect(latest.status.brain_server_running).toBe(true);
    await advance(2999);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchHealth).toHaveBeenCalledTimes(2);
  });

  it('never overlaps probes while draining the response body', async () => {
    const body = deferred<ArrayBuffer>();
    fetchHealth.mockResolvedValueOnce(healthResponse(200, body.promise));
    await mount();

    await advance(9000);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(latest.hasConnectedOnce).toBe(false);
    await React.act(async () => { body.resolve(new ArrayBuffer(0)); });
    expect(latest.status.brain_server_running).toBe(true);
    await advance(3000);
    expect(fetchHealth).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung credential/HTTP wait at 10 seconds and ignores its failure after a newer connection succeeds', async () => {
    const oldResponse = deferred<Response>();
    fetchHealth.mockImplementationOnce(() => oldResponse.promise);
    await mount();

    await advance(10_000);
    expect(signalAt(0)?.aborted).toBe(true);
    expect(latest.status.brain_server_running).toBe(false);
    await advance(3000);
    expect(fetchHealth).toHaveBeenCalledTimes(2);
    expect(latest.status.brain_server_running).toBe(true);
    await React.act(async () => { oldResponse.reject(new TypeError('Fixture late old failure')); });

    expect(latest.status.brain_server_running).toBe(true);
    expect(latest.refreshTrigger).toBe(1);
    expect(connectionLogs('Brain Server 连接断开')).toHaveLength(0);
  });

  it('bounds a hung response body, reconnects, and ignores that old body rejection', async () => {
    const oldBody = deferred<ArrayBuffer>();
    fetchHealth.mockResolvedValueOnce(healthResponse()).mockResolvedValueOnce(healthResponse(200, oldBody.promise));
    await mount();
    await advance(3000);

    await advance(10_000);
    expect(signalAt(1)?.aborted).toBe(true);
    expect(latest.status.brain_server_running).toBe(false);
    expect(connectionLogs('Brain Server 连接断开')).toHaveLength(1);
    await advance(3000);
    expect(latest.status.brain_server_running).toBe(true);
    await React.act(async () => { oldBody.reject(new Error('Fixture old body rejected after reconnect')); });

    expect(latest.status.brain_server_running).toBe(true);
    expect(connectionLogs('Brain Server 连接断开')).toHaveLength(1);
    expect(latest.refreshTrigger).toBe(2);
  });

  it('invalidates StrictMode cleanup results instead of logging or refreshing a second connection', async () => {
    const oldResponse = deferred<Response>();
    const stale = healthResponse();
    fetchHealth.mockImplementationOnce(() => oldResponse.promise);
    await mount(true);
    expect(latest.status.brain_server_running).toBe(true);
    expect(latest.refreshTrigger).toBe(1);

    await React.act(async () => { oldResponse.resolve(stale); });

    expect(latest.refreshTrigger).toBe(1);
    expect(connectionLogs('Brain Server 已连接并正常运行')).toHaveLength(1);
    expect(signalAt(0)?.aborted).toBe(true);
    expect(stale.arrayBuffer).not.toHaveBeenCalled();
  });

  it('aborts cleanup during HTTP wait and does not read a late body or schedule more work', async () => {
    const response = deferred<Response>();
    const stale = healthResponse();
    fetchHealth.mockImplementationOnce(() => response.promise);
    await mount();
    const renderCount = renders;

    await unmount();
    expect(signalAt(0)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await React.act(async () => { response.resolve(stale); });
    await advance(60_000);

    expect(stale.arrayBuffer).not.toHaveBeenCalled();
    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(renders).toBe(renderCount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts cleanup during body drain and ignores its late rejection without scheduling work', async () => {
    const body = deferred<ArrayBuffer>();
    fetchHealth.mockResolvedValueOnce(healthResponse(200, body.promise));
    await mount();
    const renderCount = renders;

    await unmount();
    expect(signalAt(0)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await React.act(async () => { body.reject(new Error('Fixture late body cleanup')); });
    await advance(60_000);

    expect(fetchHealth).toHaveBeenCalledTimes(1);
    expect(renders).toBe(renderCount);
    expect(vi.getTimerCount()).toBe(0);
  });
});
