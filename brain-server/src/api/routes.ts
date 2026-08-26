import http from 'http';
import { URL } from 'url';
import { Database } from '../db/sqlite.js';
import { CoreMemory } from '../memory/core-memory.js';
import { ArchivalMemory } from '../memory/archival-memory.js';
import { GraphRAGExtractor } from '../graphrag/extractor.js';
import { AgentLoop } from '../agent/agent-loop.js';
import { EmbeddingService } from '../embedding/service.js';
import { MemoryDecayScheduler } from '../memory/decay-scheduler.js';
import { AuthPrincipal, AuthService } from '../security/auth.js';
import { McpBusinessDispatcher } from '../mcp/dispatch.js';
import { ControlApprovalFacade, type ControlApprovalRuntime } from '../control/approval-facade.js';
import { HttpNativeApprovalClient } from '../control/native-bridge.js';
import { ControlSessionManager, readBearerToken } from '../control/session.js';
import { SqliteControlApprovalAuditStore } from '../control/audit.js';
import {
  handleMemoryRoutes,
  handleEntityRoutes,
  handlePrincipleRoutes,
  handleGraphRoutes,
  handleStatsRoutes,
  handleNotificationRoutes,
  handleDiscussionRoutes,
  handleAdminRoutes,
  handleIngestRoutes,
  handleSettingsRoutes,
  handleMcpRoutes,
  handleDecisionHistoryRoutes
} from './handlers/index.js';

export interface RequestContext {
  db: Database;
  coreMemory: CoreMemory;
  archivalMemory: ArchivalMemory;
  extractor: GraphRAGExtractor;
  agentLoop: AgentLoop | null;
  embeddingService: EmbeddingService;
  decayScheduler?: MemoryDecayScheduler;
  mcpDispatcher: McpBusinessDispatcher;
  auth: AuthPrincipal;
}

type BaseRequestContext = Omit<RequestContext, 'auth'>;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => Promise<void>;
}

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 45 * 1024 * 1024);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'tauri://localhost',
  'http://tauri.localhost',
  // Windows WebView2 下 Tauri 1.x 的实际 Origin 是 https://tauri.localhost
  'https://tauri.localhost',
].join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX_KEYS = 5_000;

// 兜底清理：避免长时间运行下 rate-limit 桶无限累积
function pruneRateLimitBuckets(now: number) {
  if (rateLimitBuckets.size <= RATE_LIMIT_MAX_KEYS) return;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
  // 仍然超限：硬剪到一半，最早过期的先丢
  if (rateLimitBuckets.size > RATE_LIMIT_MAX_KEYS) {
    const sorted = [...rateLimitBuckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const toRemove = sorted.slice(0, sorted.length - Math.floor(RATE_LIMIT_MAX_KEYS / 2));
    for (const [key] of toRemove) rateLimitBuckets.delete(key);
  }
}

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class ApiRouter {
  private routes: Route[];
  private context: BaseRequestContext;

  constructor(
    db: Database,
    agentLoop: AgentLoop | null = null,
    embeddingService: EmbeddingService,
    decayScheduler?: MemoryDecayScheduler,
    mcpDispatcher?: McpBusinessDispatcher,
  ) {
    const extractor = new GraphRAGExtractor();
    const finalDecayScheduler = decayScheduler || new MemoryDecayScheduler(db, {
      decayFactor: 0.95,
      staleDays: 90,
      intervalMs: 60 * 60 * 1000,
      autoStart: true,
    });
    this.context = {
      db,
      coreMemory: new CoreMemory(db),
      archivalMemory: new ArchivalMemory(db),
      extractor,
      agentLoop,
      embeddingService,
      decayScheduler: finalDecayScheduler,
      // 统一业务 dispatch 层：HTTP 适配器与 stdio 适配器共享同一实现。
      // 若调用方（如 mcp-server.ts 双模模式）已持有 dispatcher 实例则复用，
      // 否则在此创建一份（与 HTTP 业务共用同一 db/embedding）。
      mcpDispatcher: mcpDispatcher ?? new McpBusinessDispatcher({
        db,
        extractor,
        embeddingService,
        decayScheduler: finalDecayScheduler,
        agentLoop,
      }),
    };

    this.routes = [
      ...handleMemoryRoutes,
      ...handleEntityRoutes,
      ...handlePrincipleRoutes,
      ...handleGraphRoutes,
      ...handleStatsRoutes,
      ...handleNotificationRoutes,
      ...handleDiscussionRoutes,
      ...handleAdminRoutes,
      ...handleIngestRoutes,
      ...handleSettingsRoutes,
      ...handleMcpRoutes,
      ...handleDecisionHistoryRoutes,
    ];
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse, auth: AuthPrincipal): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method as Route['method'];

    res.setHeader('Content-Type', 'application/json');

    try {
      for (const route of this.routes) {
        if (route.method !== method) continue;

        const params = this.matchPath(route.path, pathname);
        if (params !== null) {
          await route.handler(req, res, { ...this.context, auth }, params);
          return;
        }
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (error) {
      console.error('API Error:', error);
      if (error instanceof HttpError) {
        sendError(res, error.statusCode, error.message);
        return;
      }

      sendError(res, 500, 'Internal Server Error');
    }
  }

  private matchPath(pattern: string, pathname: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);

    if (patternParts.length !== pathParts.length) {
      return null;
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart.startsWith(':')) {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      } else if (patternPart !== pathPart) {
        return null;
      }
    }

    return params;
  }
}

export async function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;

    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        reject(new HttpError(413, `Request body too large. Limit is ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      if (settled) return;
      try {
        if (body && !String(req.headers['content-type'] || '').includes('application/json')) {
          reject(new HttpError(415, 'Content-Type must be application/json'));
          return;
        }
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

export function sendResponse(res: http.ServerResponse, statusCode: number, data: any): void {
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

export function sendError(res: http.ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.end(JSON.stringify({ error: message }));
}

function getAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
    return origin;
  }
  return null;
}

function setSecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  const allowedOrigin = getAllowedOrigin(req.headers.origin);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
}

function isHealthRequest(req: http.IncomingMessage): boolean {
  if (req.method !== 'GET') return false;
  const rawUrl = req.url || '/';
  const pathname = rawUrl.split('?', 1)[0];
  return pathname === '/health';
}

function checkRateLimit(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method === 'OPTIONS' || isHealthRequest(req)) return true;

  // 本地回环豁免限流：限流是防远程 DoS，本地进程(含 /mcp 自回环、桌面 UI)不是威胁；
  // 鉴权仍照常执行，恶意本地网页拿不到 token 一样被 401 拦下。
  const remote = req.socket.remoteAddress || '';
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') return true;

  const now = Date.now();
  const key = req.socket.remoteAddress || 'unknown';
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    pruneRateLimitBuckets(now);
    return true;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    sendError(res, 429, 'Too many requests');
    return false;
  }

  return true;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function controlHostAllowed(req: http.IncomingMessage): boolean {
  const host = String(req.headers.host || '').toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host);
}

function controlBoundaryFailure(req: http.IncomingMessage): string | null {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return 'CONTROL_REMOTE_ADDRESS_REJECTED';
  if (!controlHostAllowed(req)) return 'CONTROL_HOST_REJECTED';
  if (req.headers.origin) return 'CONTROL_ORIGIN_REJECTED';
  return null;
}

function isControlApproveRequest(req: http.IncomingMessage): boolean {
  return req.method === 'POST' && new URL(req.url || '/', 'http://localhost').pathname === '/api/control/approve';
}

function isControlSessionMintRequest(req: http.IncomingMessage): boolean {
  return req.method === 'POST' && new URL(req.url || '/', 'http://localhost').pathname === '/internal/control/session';
}

function isControlSessionRevokeRequest(req: http.IncomingMessage): boolean {
  return req.method === 'POST' && new URL(req.url || '/', 'http://localhost').pathname === '/internal/control/session/revoke';
}

export function createDefaultEmbeddingService(): EmbeddingService {
  return new EmbeddingService({
    mode: (process.env.EMBEDDING_MODE as 'local' | 'api') || 'local',
    localModel: process.env.EMBEDDING_LOCAL_MODEL || 'Xenova/multilingual-e5-large',
    localModelPath: process.env.EMBEDDING_LOCAL_MODEL_PATH,
    apiUrl: process.env.EMBEDDING_API_URL,
    apiKey: process.env.EMBEDDING_API_KEY,
    apiModel: process.env.EMBEDDING_API_MODEL,
  });
}

// Read-only startup audit. Rebuilds are explicit management operations and
// are never triggered by startup or query traffic.
async function auditEmbeddingIndexCompatibility(db: Database, emb: EmbeddingService): Promise<void> {
  try {
    if (db.isInMemory() || process.env.VITEST || process.env.NODE_ENV === 'test') return;
    const profile = emb.getUsageProfile();
    const manifests = await db.getEmbeddingIndexManifests();
    const mismatch = manifests.length !== 2 || manifests.some((manifest) =>
      manifest.model_id !== profile.modelId
      || manifest.model_revision !== profile.modelRevision
      || Number(manifest.dimension) !== profile.dimension
      || manifest.usage_profile_version !== profile.usageProfileVersion
      || manifest.status !== 'active');
    if (mismatch) console.warn('[embedding-index] explicit rebuild required; run npm run embeddings:rebuild');
  } catch (e) {
    console.warn('[embedding-index] compatibility audit failed:', e);
  }
}

export function createServer(
  db: Database,
  agentLoop?: AgentLoop,
  embeddingService?: EmbeddingService,
  decayScheduler?: MemoryDecayScheduler,
  mcpDispatcher?: McpBusinessDispatcher,
  controlRuntime?: ControlApprovalRuntime,
): http.Server {
  const finalEmbeddingService = embeddingService ?? createDefaultEmbeddingService();
  db.attachEmbeddingService(finalEmbeddingService);
  const ownsDecayScheduler = !decayScheduler;
  const finalDecayScheduler = decayScheduler ?? new MemoryDecayScheduler(db, {
    decayFactor: 0.95,
    staleDays: 90,
    intervalMs: 60 * 60 * 1000,
    autoStart: true,
  });
  const router = new ApiRouter(db, agentLoop ?? null, finalEmbeddingService, finalDecayScheduler, mcpDispatcher);

  void auditEmbeddingIndexCompatibility(db, finalEmbeddingService);

  const localApiToken = (process.env.LOCAL_API_TOKEN || '').trim();
  const authService = new AuthService(db, {
    localApiToken,
    pairCode: (process.env.PAIR_CODE || '').trim(),
    pairCodeFile: (process.env.PAIR_CODE_FILE || '').trim() || undefined,
    pairCodeTtlMs: Number(process.env.PAIR_CODE_TTL_MS || 10 * 60 * 1000),
  });
  const controlSessions = new ControlSessionManager();
  const controlAudit = new SqliteControlApprovalAuditStore(db);
  const controlFacade = new ControlApprovalFacade(controlRuntime, new HttpNativeApprovalClient(), () => new Date(), controlAudit);

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(req, res);

    if (req.method === 'OPTIONS') {
      const optionsPath = new URL(req.url || '/', 'http://localhost').pathname;
      if (optionsPath === '/api/control/approve' || optionsPath.startsWith('/internal/control/session')) {
        sendError(res, 405, 'CONTROL_OPTIONS_REJECTED');
        return;
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    if (isControlSessionMintRequest(req)) {
      const boundaryError = controlBoundaryFailure(req);
      if (boundaryError) {
        sendError(res, 403, boundaryError);
        return;
      }
      const expected = (process.env.NATIVE_BRIDGE_SECRET || '').trim();
      const supplied = readBearerToken(req);
      if (!expected || supplied !== expected) {
        sendError(res, 401, 'CONTROL_AUTH_REQUIRED');
        return;
      }
      const issued = controlSessions.mint();
      // Raw token is returned only to the trusted native Desktop caller. It
      // is never logged, persisted by Brain, or accepted by the public CLI as
      // an argument.
      sendResponse(res, 201, { data: issued });
      return;
    }

    if (isControlSessionRevokeRequest(req)) {
      const boundaryError = controlBoundaryFailure(req);
      if (boundaryError) { sendError(res, 403, boundaryError); return; }
      const expected = (process.env.NATIVE_BRIDGE_SECRET || '').trim();
      if (!expected || readBearerToken(req) !== expected) { sendError(res, 401, 'CONTROL_AUTH_REQUIRED'); return; }
      controlSessions.revokeAll();
      sendResponse(res, 204, null);
      return;
    }

    if (isControlApproveRequest(req)) {
      const boundaryError = controlBoundaryFailure(req);
      if (boundaryError) {
        sendError(res, 403, boundaryError);
        return;
      }
      const supplied = readBearerToken(req);
      const session = controlSessions.authenticate(supplied);
      if (!session) {
        const readPrincipal = await authService.authenticate(req);
        sendError(res, readPrincipal ? 403 : 401, readPrincipal
          ? 'CONTROL_SCOPE_INSUFFICIENT'
          : 'CONTROL_AUTH_REQUIRED');
        return;
      }
      if (!controlSessions.consumeBurst(session.session_id)) {
        sendError(res, 429, 'CONTROL_RATE_LIMITED');
        return;
      }
      try {
        const body = await parseBody<unknown>(req);
        const result = await controlFacade.approve(body, session);
        sendResponse(res, 200, { data: result });
      } catch (error) {
        const code = error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_CONTROL_ERROR';
        const mapping: Record<string, [number, string]> = {
          APPROVAL_INPUT_INVALID: [400, 'PLAN_NOT_APPROVABLE'],
          APPROVAL_PLAN_NOT_FOUND: [404, 'PLAN_NOT_FOUND'],
          APPROVAL_REQUEST_EXPIRED: [409, 'PLAN_EXPIRED'],
          APPROVAL_STATE_CONFLICT: [409, 'PLAN_NOT_APPROVABLE'],
          APPROVAL_GRANT_INVALID: [502, 'NATIVE_APPROVAL_UNAVAILABLE'],
          APPROVAL_GRANT_EXPIRED: [409, 'PLAN_EXPIRED'],
          APPROVAL_AUTHORITY_INSUFFICIENT: [403, 'APPROVAL_AUTHORITY_INSUFFICIENT'],
          APPROVAL_STORE_CONFLICT: [409, 'PLAN_ALREADY_CONSUMED'],
          APPROVAL_AUDIT_UNAVAILABLE: [503, 'CONTROL_AUDIT_UNAVAILABLE'],
        };
        const [status, publicCode] = mapping[code] || [500, 'INTERNAL_CONTROL_ERROR'];
        sendError(res, status, publicCode);
      }
      return;
    }

    if (!checkRateLimit(req, res)) {
      return;
    }

    if (isHealthRequest(req)) {
      sendResponse(res, 200, {
        ok: true,
        service: 'omni-context-brain-server',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (authService.isPairExchange(req)) {
      await authService.handlePairExchange(req, res);
      return;
    }

    // localhost 也不免鉴权：恶意网页 JavaScript 可以扫描本机端口。
    // 配对码只在上面的短期交换端点有效，不能直接访问任何业务 API。
    const principal = await authService.authenticate(req);
    if (!principal) {
      sendError(res, 401, 'Unauthorized. Use Authorization: Bearer <token>');
      return;
    }

    if (!authService.authorize(req, principal)) {
      sendError(res, 403, 'Forbidden: token scope does not allow this operation');
      return;
    }

    if (await authService.handleDeviceAdministration(req, res)) return;

    await router.handle(req, res, principal);
  });

  if (ownsDecayScheduler) {
    server.once('close', () => finalDecayScheduler.stop());
  }
  server.once('close', () => controlSessions.revokeAll());
  return server;
}

export default ApiRouter;
