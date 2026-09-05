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
export const EXPECTED_CONTROL_PROTOCOL_VERSION = '1.0';
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
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw errorFor.usage('API URL must not contain credentials, query parameters or fragments');
  }
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw errorFor.remoteApi();
  }
  return parsed;
}

/** Validate the small public health identity/compatibility contract. */
export function assertCompatibleHealth(payload) {
  if (!payload || typeof payload !== 'object' || payload.ok !== true || payload.service !== 'omni-context-brain-server') {
    throw errorFor.wrongService();
  }
  if (typeof payload.product_version !== 'string' || payload.product_version.trim() === '' || payload.control_protocol_version !== EXPECTED_CONTROL_PROTOCOL_VERSION) {
    throw errorFor.unsupportedControlProtocol(
      `unsupported control protocol '${String(payload.control_protocol_version ?? 'missing')}' (expected ${EXPECTED_CONTROL_PROTOCOL_VERSION})`,
    );
  }
  return payload;
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
    this._healthPayload = null;
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
    if (!payload || typeof payload !== 'object') {
      throw errorFor.unexpectedResponse('health response shape is not an object');
    }
    this._healthPayload = payload;
    return payload;
  }

  /** Fail-closed compatibility handshake used by public CLI commands. */
  async ensureCompatibility() {
    const health = this._healthPayload || await this.health();
    return assertCompatibleHealth(health);
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

  /** Fixed approve-only mutation gateway. The caller supplies only the
   * ephemeral Desktop control token; no read token fallback is possible. */
  async approvePlan(planId, controlToken) {
    if (typeof planId !== 'string' || !/^plan-[0-9a-f-]{8,}$/i.test(planId)) {
      throw errorFor.usage('approve requires a valid plan id');
    }
    if (typeof controlToken !== 'string' || !controlToken) throw errorFor.controlAuthMissing();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}/api/control/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Omni-Client': `omctx/${CLI_VERSION}`,
          Authorization: `Bearer ${controlToken}`,
        },
        body: JSON.stringify({ plan_id: planId }),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw errorFor.brainOffline('request timed out');
      throw errorFor.brainOffline(typeof error?.message === 'string' ? error.message.slice(0, 120) : 'connection failed');
    } finally { clearTimeout(timer); }
    let payload = null;
    try { payload = await response.json(); } catch { throw errorFor.unexpectedResponse('approve response is not valid JSON'); }
    if (response.status === 401) throw errorFor.controlAuthRejected();
    if (response.status === 403) throw errorFor.controlScopeDenied();
    if (response.status === 404) throw errorFor.planNotFound();
    if (response.status === 409) throw errorFor.approvalRejected(payload?.error);
    if (response.status === 429) throw errorFor.controlRateLimited();
    if (!response.ok) throw errorFor.unexpectedResponse(`approve endpoint returned HTTP ${response.status}`);
    return payload?.data ?? payload;
  }

  /** Fixed verify-only gateway. The server resolves receipt/read-back state. */
  async verifyPlan(planId, verificationToken) {
    if (typeof planId !== 'string' || !/^plan-[A-Za-z0-9_-]{8,}$/i.test(planId)) {
      throw errorFor.usage('verify requires a valid plan id');
    }
    if (typeof verificationToken !== 'string' || !verificationToken) throw errorFor.verificationAuthMissing();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}/api/control/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Omni-Client': `omctx/${CLI_VERSION}`,
          Authorization: `Bearer ${verificationToken}`,
        },
        body: JSON.stringify({ plan_id: planId }),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw errorFor.brainOffline('request timed out');
      throw errorFor.brainOffline(typeof error?.message === 'string' ? error.message.slice(0, 120) : 'connection failed');
    } finally { clearTimeout(timer); }
    let payload = null;
    try { payload = await response.json(); } catch { throw errorFor.unexpectedResponse('verify response is not valid JSON'); }
    if (response.status === 401) throw errorFor.verificationAuthRejected();
    if (response.status === 403) throw errorFor.verificationScopeDenied();
    if (response.status === 404) throw errorFor.planNotFound();
    if (response.status === 409) throw errorFor.verificationRejected(payload?.error);
    if (response.status === 429) throw errorFor.controlRateLimited();
    if (!response.ok) throw errorFor.unexpectedResponse(`verify endpoint returned HTTP ${response.status}`);
    return payload?.data ?? payload;
  }

  /**
   * Fixed reopen-only gateway. This is intentionally not a generic control
   * request: the CLI can submit only the source decision, optional audit
   * reason, and an optional already-recorded outcome id. The server derives
   * parent/root/index/evidence and never receives a caller-selected plan or
   * execution instruction.
   */
  async reopenDecision(decisionId, reopenToken, options = {}) {
    if (typeof decisionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(decisionId)) {
      throw errorFor.invalidDecisionId(decisionId);
    }
    if (typeof reopenToken !== 'string' || !reopenToken) throw errorFor.reopenAuthMissing();
    const body = { decision_id: decisionId };
    if (options.reason !== undefined) body.reason = options.reason;
    if (options.outcome !== undefined) body.outcome_id = options.outcome;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}/api/control/reopen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Omni-Client': `omctx/${CLI_VERSION}`,
          Authorization: `Bearer ${reopenToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw errorFor.brainOffline('request timed out');
      throw errorFor.brainOffline(typeof error?.message === 'string' ? error.message.slice(0, 120) : 'connection failed');
    } finally { clearTimeout(timer); }
    let payload = null;
    try { payload = await response.json(); } catch { throw errorFor.unexpectedResponse('reopen response is not valid JSON'); }
    if (response.status === 401) throw errorFor.reopenAuthRejected();
    if (response.status === 403) throw errorFor.reopenScopeDenied();
    if (response.status === 404) throw errorFor.decisionNotFound(decisionId);
    if (response.status === 409) throw errorFor.reopenRejected(typeof payload?.error === 'string' ? payload.error : undefined);
    if (response.status === 422) throw errorFor.reopenEvidenceRejected();
    if (response.status === 429) throw errorFor.controlRateLimited();
    if (response.status >= 500) throw errorFor.brainOffline(`Brain Server error (HTTP ${response.status})`);
    if (!response.ok) throw errorFor.unexpectedResponse(`reopen endpoint returned HTTP ${response.status}`);
    return payload?.data ?? payload;
  }
}

export { OmctxError };
