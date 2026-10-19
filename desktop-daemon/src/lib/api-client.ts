/**
 * 统一 API fetch 封装，自动从 Tauri 获取 local API token 并注入 Authorization header。
 * 非 Tauri 环境（浏览器开发 / 测试）静默降级为普通 fetch。
 */

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || 'http://127.0.0.1:3001';

type TokenSnapshot = { token: string | null; generation: number };

let cachedToken: string | null = null;
let tokenPromise: Promise<TokenSnapshot> | null = null;
let tokenGeneration = 0;

async function getToken(): Promise<TokenSnapshot> {
  if (cachedToken) return { token: cachedToken, generation: tokenGeneration };
  if (tokenPromise) return tokenPromise;

  const generation = tokenGeneration;
  const pendingToken = (async () => {
    let token: string | null = null;
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      token = (await invoke<string>('get_local_api_token')) || null;
    } catch {
      // 非 Tauri 环境（浏览器开发服务器）
    }

    // Token rotation can finish while an older native read is still pending.
    // Join the current generation instead of restoring or sending the old token.
    if (generation !== tokenGeneration) return getToken();
    cachedToken = token;
    return { token, generation };
  })();
  tokenPromise = pendingToken;

  try {
    return await pendingToken;
  } finally {
    // Only an in-flight read is shared. A failed/empty read must be retryable
    // by the next request, and an older read must not clear a newer flight.
    if (tokenPromise === pendingToken) tokenPromise = null;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason !== undefined
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function getRequestToken(signal?: AbortSignal | null): Promise<TokenSnapshot> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  if (!signal) return getToken();

  // Native IPC has no cancellation contract. Stop only this caller's wait;
  // other requests can still use the shared read when it eventually finishes.
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    getToken().then(
      (snapshot) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(abortReason(signal));
        else resolve(snapshot);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** 清除缓存的 token（旋转后调用） */
export function clearTokenCache(): void {
  tokenGeneration += 1;
  cachedToken = null;
  tokenPromise = null;
}

/**
 * 向 brain-server 发起 API 请求，自动注入 Authorization header。
 * 用法: apiFetch('/api/entities/search', { method: 'POST', body: JSON.stringify({...}) })
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const { token, generation } = await getRequestToken(options.signal);
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.signal?.aborted) throw abortReason(options.signal);

  // Never replay requests on authentication failure: a mutation may already
  // have persisted even when the caller did not receive a successful response.
  const response = await fetch(`${BRAIN_URL}${path}`, {
    ...options,
    headers,
  });
  // Refresh only on the next explicit request. A late denial from an older
  // generation must not discard a newer cached token or native read in flight.
  if (response.status === 401 && token && generation === tokenGeneration && cachedToken === token) {
    clearTokenCache();
  }
  return response;
}

export { BRAIN_URL };
