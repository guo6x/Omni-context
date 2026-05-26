/**
 * 统一 API fetch 封装，自动从 Tauri 获取 local API token 并注入 Authorization header。
 * 非 Tauri 环境（浏览器开发 / 测试）静默降级为普通 fetch。
 */

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || 'http://localhost:3001';

let cachedToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;

async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const token = await invoke<string>('get_local_api_token');
      cachedToken = token || null;
      return cachedToken;
    } catch {
      // 非 Tauri 环境（浏览器开发服务器）
      return null;
    }
  })();

  return tokenPromise;
}

/** 清除缓存的 token（旋转后调用） */
export function clearTokenCache(): void {
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
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(`${BRAIN_URL}${path}`, {
    ...options,
    headers,
  });
}

export { BRAIN_URL };
