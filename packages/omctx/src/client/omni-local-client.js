/**
 * OmniLocalClient - the ONLY HTTP surface of the CLI.
 *
 * Public command-facing methods: health(), mcpPing(), callAllowlistedReadTool().
 * There is deliberately NO request(method, path, body) API exposed to the
 * command layer: commands can never invent an arbitrary method/path.
 *
 * Hard rules:
 * - loopback only (127.0.0.1 / localhost / ::1); remote URLs are rejected
 * - redirects are NOT followed (a loopback-to-remote redirect is an attack)
 * - Authorization: Bearer <token>; X-Omni-Client: omctx/<version>
 * - the token value never appears in logs, errors or response handling
 */

import { errorFor, OmctxError } from './errors.js';
import { isReadToolAllowed } from '../read-tool-allowlist.js';

export const CLI_VERSION = '0.1.0-alpha.0';
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const REQUEST_TIMEOUT_MS = 10_000;

export function assertLoopbackUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw errorFor.usage(`invalid API URL '${redactUrl(rawUrl)}'`);
  }
  if (parsed.protocol !== 'http:') {
    throw errorFor.remoteApi();
  }
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw errorFor.remoteApi();
  }
  return parsed;
}

function redactUrl(raw) {
  try {
    const url = new URL(raw);
    url.password = '';
    url.username = '';
    return url.toString();
  } catch {
    return String(raw).replace(/[A-Za-z0-9._~-]+@/g, '***@');
  }
}

export class OmniLocalClient {
  constructor(options) {
    this.apiUrl = assertLoopbackUrl(options.apiUrl || DEFAULT_API_URL).toString().replace(/\/$/, '');
    this.token = options.token; // never logged
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'X-Omni-Client': `omctx/${CLI_VERSION}`,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  /**
   * Lowest-level transport used ONLY by the fixed public methods below.
   * Redirects are an error by policy: never follow, never surface the
   * Location header (it could carry secrets).
   */
  async _jsonRpc(method, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}/mcp`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw errorFor.brainOffline('request timed out');
      }
      throw errorFor.brainOffline(typeof error?.message === 'string' ? error.message.slice(0, 120) : 'connection failed');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      throw errorFor.authRejected();
    }
    if (response.status >= 500) {
      throw errorFor.brainOffline(`Brain Server error (HTTP ${response.status})`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw errorFor.unexpectedResponse('response body is not valid JSON');
    }
    if (!payload || typeof payload !== 'object') {
      throw errorFor.unexpectedResponse('response shape is not an object');
    }
    return payload;
  }

  /** GET /health (public). */
  async health() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}/health`, {
        method: 'GET',
        headers: { 'X-Omni-Client': `omctx/${CLI_VERSION}` },
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw errorFor.brainOffline('request timed out');
      throw errorFor.brainOffline(typeof error?.message === 'string' ? error.message.slice(0, 120) : 'connection failed');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw errorFor.brainOffline(`Brain Server health returned HTTP ${response.status}`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw errorFor.unexpectedResponse('health response is not valid JSON');
    }
    return payload;
  }

  /** Authenticated MCP ping. */
  async mcpPing() {
    const payload = await this._jsonRpc('ping', {});
    if (payload?.error) {
      if (payload.error?.message === 'Unauthorized') throw errorFor.authRejected();
      throw errorFor.unexpectedResponse(`ping failed: ${String(payload.error.message || payload.error.code)}`);
    }
    return payload?.result ?? {};
  }

  /**
   * Call exactly one allowlisted read-only tool. Any other tool name is
   * rejected locally (CLI_READ_TOOL_NOT_ALLOWED) and NEVER reaches the
   * Brain. Arguments must be a plain JSON-safe object.
   */
  async callAllowlistedReadTool(toolName, args) {
    if (typeof toolName !== 'string' || !isReadToolAllowed(toolName)) {
      throw errorFor.toolNotAllowed(toolName);
    }
    if (args === undefined) args = {};
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw errorFor.usage('tool arguments must be a JSON object');
    }
    const payload = await this._jsonRpc('tools/call', { name: toolName, arguments: args });
    if (payload?.error) {
      if (payload.error?.message === 'Unauthorized') throw errorFor.authRejected();
      throw errorFor.unexpectedResponse(`tool call failed: ${String(payload.error.message || payload.error.code)}`);
    }
    return payload?.result ?? null;
  }

  /**
   * Fixed read-only decision history query (GET /api/decisions). The
   * path is fixed in code; the command layer cannot choose an arbitrary
   * path.
   */
  async decisionHistory(limit) {
    const clamped = Math.max(1, Math.min(100, Math.trunc(limit) || 20));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}/api/decisions?limit=${clamped}`, {
        method: 'GET',
        headers: this._headers(),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw errorFor.brainOffline('request timed out');
      throw errorFor.brainOffline(typeof error?.message === 'string' ? error.message.slice(0, 120) : 'connection failed');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) throw errorFor.authRejected();
    if (response.status >= 500) throw errorFor.brainOffline(`Brain Server error (HTTP ${response.status})`);
    if (!response.ok) throw errorFor.unexpectedResponse(`history endpoint returned HTTP ${response.status}`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw errorFor.unexpectedResponse('history response is not valid JSON');
    }
    if (!payload || !Array.isArray(payload.decisions)) {
      throw errorFor.unexpectedResponse('history response shape is not recognized');
    }
    return payload.decisions;
  }
}

export { OmctxError };
