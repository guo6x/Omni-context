import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, statSync } from 'fs';
import http from 'http';
import { URL } from 'url';
import { z } from 'zod';

import { Database } from '../db/sqlite.js';

export const AUTH_SCOPES = [
  'memory:read',
  'memory:write',
  'decision:read',
  'decision:write',
  // Goal26 least-authority external Agent Pilot scopes. These are deliberately
  // separate from the broad device scopes above so a pilot credential can
  // never inherit memory/decision mutation authority.
  'agent:ask',
  'agent:inspect',
  'agent:history',
  'agent:outcome:read',
  'admin:export',
  'admin:import',
  'admin:delete',
] as const;

export type AuthScope = typeof AUTH_SCOPES[number];
export type DeviceType = 'mobile' | 'browser_extension' | 'esp32' | 'agent_pilot';

export interface AuthPrincipal {
  kind: 'local_desktop' | 'device' | 'agent_pilot';
  deviceId: string;
  scopes: ReadonlySet<AuthScope>;
}

interface DeviceTokenRow {
  token_hash: string;
  device_id: string;
  device_type: string;
  scopes: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

interface PairingCodeSnapshot {
  code: string;
  issuedAtMs: number;
  fingerprint: string;
}

const PairingRequestSchema = z.object({
  device_id: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  device_type: z.enum(['mobile', 'browser_extension', 'esp32', 'agent_pilot']),
  requested_scopes: z.array(z.enum(AUTH_SCOPES)).max(AUTH_SCOPES.length).optional(),
}).strict();

const DEVICE_SCOPE_POLICY: Record<DeviceType, readonly AuthScope[]> = {
  mobile: ['memory:read', 'decision:read'],
  browser_extension: ['memory:read', 'memory:write', 'decision:read'],
  esp32: ['memory:write', 'decision:write'],
  agent_pilot: ['agent:ask', 'agent:inspect', 'agent:history', 'agent:outcome:read'],
};

const ALL_SCOPES = new Set<AuthScope>(AUTH_SCOPES);
const MAX_AUTH_BODY_BYTES = 64 * 1024;
const DEFAULT_DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization || '';
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseScopes(raw: string): AuthScope[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is AuthScope =>
      typeof scope === 'string' && AUTH_SCOPES.includes(scope as AuthScope));
  } catch (error) {
    console.error('[auth] Device token has invalid scopes JSON', error);
    return [];
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_AUTH_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}


const MCP_TOOL_SCOPE_MAP: Record<string, AuthScope> = {
  record_capture: "memory:write",
  get_core_context: "memory:read",
  search_entities: "memory:read",
  add_entity: "memory:write",
  get_entity: "memory:read",
  add_relationship: "memory:write",
  get_graph_neighborhood: "memory:read",
  extract_from_capture: "memory:write",
  update_entity: "memory:write",
  vector_search: "memory:read",
  unified_memory_search: "memory:read",
  save_conclusion: "memory:write",
  ask_memory: "memory:read",
  graph_answer: "memory:read",
  set_core_principle: "memory:write",
  delete_entity: "admin:delete",
  list_entities: "memory:read",
  get_stats: "memory:read",
  merge_entities: "admin:delete",
  get_decay_report: "memory:read",
  get_decision_context: "decision:read",
  save_decision: "decision:write",
  analyze_decision: "decision:read",
  discuss_decision: "decision:read",
  get_decision_lineage: "decision:read",
  record_decision_outcome: "decision:write",
  agent_ask: 'agent:ask',
  agent_inspect: 'agent:inspect',
  agent_history: 'agent:history',
  agent_outcome: 'agent:outcome:read',
};

/**
 * Explicit Goal26 Agent Pilot MCP allowlist. The normal MCP manifest contains
 * legacy memory/decision mutation tools; they are intentionally not inherited
 * by an agent credential even when a future scope is added to the manifest.
 */
export const AGENT_PILOT_MCP_ALLOWLIST = new Set([
  'agent_ask',
  'agent_inspect',
  'agent_history',
  'agent_outcome',
]);

export function isAgentPilotPrincipal(principal: AuthPrincipal): boolean {
  return principal.kind === 'agent_pilot' || principal.deviceId.startsWith('agent-pilot:');
}

export function scopeForMcpTool(toolName: string): AuthScope | null {
  return MCP_TOOL_SCOPE_MAP[toolName] || null;
}

export function requiredScope(req: http.IncomingMessage): AuthScope | null {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const method = req.method || 'GET';

  if (pathname === '/api/admin/export') return 'admin:export';
  if (pathname === '/api/admin/import') return 'admin:import';
  // JSON-RPC 入口：tool name 在 body 中，HTTP 层不做 per-tool scope 检查，
  // 仅要求有效认证；具体 tools/call 的 scope 检查在 handleMcpRpcMessage 中进行。
  if (pathname === '/mcp') {
    return null;
  }
  if (pathname === '/api/agent/ask') return 'agent:ask';
  if (pathname.startsWith('/api/agent/inspect')) return 'agent:inspect';
  if (pathname.startsWith('/api/agent/history')) return 'agent:history';
  if (pathname.startsWith('/api/agent/outcome')) return 'agent:outcome:read';
  // Per-tool MCP scope resolution
  // REST 入口 /api/mcp/tool/:name：只用 path 中的 tool name，忽略 query 参数，
  // 防止攻击者用 ?tool=<read-only-tool> 绕过 write/admin scope。
  if (pathname.startsWith('/api/mcp/')) {
    const toolName = (pathname.split('/').pop() || '').trim();
    const scope = scopeForMcpTool(toolName);
    if (scope) return scope;
    return 'admin:delete';
  }
  if (pathname.startsWith('/api/settings')) return 'admin:import';
  if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/auth/devices')) {
    return 'admin:delete';
  }
  if (method === 'DELETE') return 'admin:delete';

  const decisionRoute = pathname.includes('/decision') || pathname.includes('/discussions');
  if (decisionRoute) return method === 'GET' ? 'decision:read' : 'decision:write';
  return method === 'GET' ? 'memory:read' : 'memory:write';
}

export interface AuthServiceConfig {
  localApiToken: string;
  pairCode?: string;
  pairCodeFile?: string;
  pairCodeTtlMs?: number;
  deviceTokenTtlMs?: number;
  now?: () => number;
}

export class AuthService {
  private readonly now: () => number;
  private readonly pairCodeTtlMs: number;
  private readonly deviceTokenTtlMs: number;
  private readonly fallbackPairIssuedAt: number;
  private consumedPairFingerprint: string | null = null;
  private pairingInProgress = false;
  private readonly pairAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly db: Database, private readonly config: AuthServiceConfig) {
    this.now = config.now ?? Date.now;
    this.pairCodeTtlMs = config.pairCodeTtlMs ?? DEFAULT_PAIR_CODE_TTL_MS;
    this.deviceTokenTtlMs = config.deviceTokenTtlMs ?? DEFAULT_DEVICE_TOKEN_TTL_MS;
    this.fallbackPairIssuedAt = this.now();
  }

  isPairExchange(req: http.IncomingMessage): boolean {
    return req.method === 'POST'
      && new URL(req.url || '/', 'http://localhost').pathname === '/api/auth/pair/exchange';
  }

  async authenticate(req: http.IncomingMessage): Promise<AuthPrincipal | null> {
    const token = readBearerToken(req);
    if (!token) return null;

    if (this.config.localApiToken && constantTimeEqual(token, this.config.localApiToken)) {
      return { kind: 'local_desktop', deviceId: 'local-desktop', scopes: ALL_SCOPES };
    }

    const tokenHash = hashToken(token);
    const row = await this.db.get<DeviceTokenRow>(
      `SELECT token_hash, device_id, device_type, scopes, issued_at, expires_at, revoked_at, last_used_at
       FROM device_tokens WHERE token_hash = ?`,
      [tokenHash]
    );
    const expiresAt = row ? Date.parse(row.expires_at) : Number.NaN;
    if (!row || row.revoked_at || !Number.isFinite(expiresAt) || expiresAt <= this.now()) return null;

    const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
    if (!lastUsed || this.now() - lastUsed >= LAST_USED_WRITE_INTERVAL_MS) {
      await this.db.run('UPDATE device_tokens SET last_used_at = ? WHERE token_hash = ?', [
        new Date(this.now()).toISOString(),
        tokenHash,
      ]);
    }

    return {
      kind: row.device_type === 'agent_pilot' ? 'agent_pilot' : 'device',
      deviceId: row.device_id,
      scopes: new Set(parseScopes(row.scopes)),
    };
  }

  authorize(req: http.IncomingMessage, principal: AuthPrincipal): boolean {
    const scope = requiredScope(req);
    // null 表示该路由不需要特定 scope，仅要求有效认证（如 /mcp JSON-RPC 入口，
    // 其 per-tool scope 检查在 handler 内根据 body 中的 tool name 进行）。
    if (scope === null) return true;
    return principal.scopes.has(scope);
  }

  async handlePairExchange(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const address = req.socket.remoteAddress || 'unknown';
    if (!this.allowPairAttempt(address)) {
      sendJson(res, 429, { error: 'Too many pairing attempts' });
      return;
    }

    if (this.pairingInProgress) {
      sendJson(res, 409, { error: 'Pairing already in progress' });
      return;
    }

    const snapshot = this.readPairingCode();
    const suppliedCode = readBearerToken(req);
    const pairCodeAge = snapshot ? this.now() - snapshot.issuedAtMs : Number.POSITIVE_INFINITY;
    if (!snapshot
      || pairCodeAge < 0
      || pairCodeAge > this.pairCodeTtlMs
      || this.consumedPairFingerprint === snapshot.fingerprint
      || !constantTimeEqual(suppliedCode, snapshot.code)) {
      sendJson(res, 401, { error: 'Invalid or expired pairing code' });
      return;
    }

    this.pairingInProgress = true;
    try {
      const parsed = PairingRequestSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        sendJson(res, 400, { error: 'Invalid pairing request', details: parsed.error.issues });
        return;
      }

      const policy = DEVICE_SCOPE_POLICY[parsed.data.device_type];
      const requested = parsed.data.requested_scopes ?? [...policy];
      const scopes = requested.filter((scope): scope is AuthScope => policy.includes(scope));
      if (scopes.length === 0) {
        sendJson(res, 403, { error: 'No permitted scopes requested' });
        return;
      }

      const issuedAt = new Date(this.now()).toISOString();
      const expiresAt = new Date(this.now() + this.deviceTokenTtlMs).toISOString();
      const deviceToken = `ocd_${randomBytes(32).toString('base64url')}`;
      const tokenHash = hashToken(deviceToken);

      await this.db.withTransaction(async () => {
        await this.db.run(
          'UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL',
          [issuedAt, parsed.data.device_id]
        );
        await this.db.run(
          `INSERT INTO device_tokens
           (token_hash, device_id, device_type, scopes, issued_at, expires_at, revoked_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
          [
            tokenHash,
            parsed.data.device_id,
            parsed.data.device_type,
            JSON.stringify(scopes),
            issuedAt,
            expiresAt,
          ]
        );
      });

      this.consumedPairFingerprint = snapshot.fingerprint;
      sendJson(res, 201, {
        device_token: deviceToken,
        device_id: parsed.data.device_id,
        scopes,
        issued_at: issuedAt,
        expires_at: expiresAt,
      });
    } catch (error) {
      console.error('[auth] Pair exchange failed', error);
      sendJson(res, 400, { error: 'Pair exchange failed' });
    } finally {
      this.pairingInProgress = false;
    }
  }

  async handleDeviceAdministration(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<boolean> {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/api/auth/devices') {
      const devices = await this.db.all<{
        device_id: string;
        device_type: string;
        scopes: string;
        issued_at: string;
        expires_at: string;
        revoked_at: string | null;
        last_used_at: string | null;
      }>(
        `SELECT device_id, device_type, scopes, issued_at, expires_at, revoked_at, last_used_at
         FROM device_tokens ORDER BY issued_at DESC`
      );
      sendJson(res, 200, devices.map((device) => ({
        ...device,
        scopes: parseScopes(device.scopes),
      })));
      return true;
    }

    const revokeMatch = pathname.match(/^\/api\/auth\/devices\/([^/]+)\/revoke$/);
    if (req.method === 'POST' && revokeMatch) {
      const deviceId = decodeURIComponent(revokeMatch[1]);
      const revokedAt = new Date(this.now()).toISOString();
      const result = await this.db.run(
        'UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL',
        [revokedAt, deviceId]
      );
      sendJson(res, result.changes ? 200 : 404, result.changes
        ? { device_id: deviceId, revoked_at: revokedAt }
        : { error: 'Active device not found' });
      return true;
    }
    return false;
  }

  private readPairingCode(): PairingCodeSnapshot | null {
    try {
      if (this.config.pairCodeFile) {
        const stat = statSync(this.config.pairCodeFile);
        const code = readFileSync(this.config.pairCodeFile, 'utf8').trim();
        if (!/^\d{6}$/.test(code)) return null;
        return {
          code,
          issuedAtMs: stat.mtimeMs,
          fingerprint: hashToken(`${code}:${stat.mtimeMs}`),
        };
      }

      const code = (this.config.pairCode || '').trim();
      if (!/^\d{6}$/.test(code)) return null;
      return {
        code,
        issuedAtMs: this.fallbackPairIssuedAt,
        fingerprint: hashToken(`${code}:${this.fallbackPairIssuedAt}`),
      };
    } catch (error) {
      console.error('[auth] Unable to read pairing code state', error);
      return null;
    }
  }

  private allowPairAttempt(address: string): boolean {
    const now = this.now();
    const current = this.pairAttempts.get(address);
    if (!current || current.resetAt <= now) {
      this.pairAttempts.set(address, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    current.count += 1;
    return current.count <= 10;
  }
}
