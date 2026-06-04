import http from 'http';
import { URL } from 'url';
import { Database } from '../db/sqlite.js';
import { CoreMemory } from '../memory/core-memory.js';
import { ArchivalMemory } from '../memory/archival-memory.js';
import { GraphRAGExtractor } from '../graphrag/extractor.js';
import { AgentLoop } from '../agent/agent-loop.js';
import { EmbeddingService } from '../embedding/service.js';
import { MemoryDecayScheduler } from '../memory/decay-scheduler.js';
import {
  handleMemoryRoutes,
  handleEntityRoutes,
  handlePrincipleRoutes,
  handleGraphRoutes,
  handleStatsRoutes,
  handleNotificationRoutes,
  handleAdminRoutes,
  handleIngestRoutes,
  handleSettingsRoutes,
  handleMcpRoutes
} from './handlers/index.js';

export interface RequestContext {
  db: Database;
  coreMemory: CoreMemory;
  archivalMemory: ArchivalMemory;
  extractor: GraphRAGExtractor;
  agentLoop: AgentLoop | null;
  embeddingService: EmbeddingService;
  decayScheduler?: MemoryDecayScheduler;
}

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
  private context: RequestContext;

  constructor(db: Database, agentLoop: AgentLoop | null = null, embeddingService: EmbeddingService, decayScheduler?: MemoryDecayScheduler) {
    this.context = {
      db,
      coreMemory: new CoreMemory(db),
      archivalMemory: new ArchivalMemory(db),
      extractor: new GraphRAGExtractor(),
      agentLoop,
      embeddingService,
      decayScheduler: decayScheduler || new MemoryDecayScheduler(db, {
        decayFactor: 0.95,
        staleDays: 90,
        intervalMs: 60 * 60 * 1000,
        autoStart: true,
      }),
    };

    this.routes = [
      ...handleMemoryRoutes,
      ...handleEntityRoutes,
      ...handlePrincipleRoutes,
      ...handleGraphRoutes,
      ...handleStatsRoutes,
      ...handleNotificationRoutes,
      ...handleAdminRoutes,
      ...handleIngestRoutes,
      ...handleSettingsRoutes,
      ...handleMcpRoutes,
    ];
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method as Route['method'];

    res.setHeader('Content-Type', 'application/json');

    try {
      for (const route of this.routes) {
        if (route.method !== method) continue;

        const params = this.matchPath(route.path, pathname);
        if (params !== null) {
          await route.handler(req, res, this.context, params);
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

export function createDefaultEmbeddingService(): EmbeddingService {
  return new EmbeddingService({
    mode: (process.env.EMBEDDING_MODE as 'local' | 'api') || 'local',
    localModel: process.env.EMBEDDING_LOCAL_MODEL || 'Xenova/multilingual-e5-small',
    apiUrl: process.env.EMBEDDING_API_URL,
    apiKey: process.env.EMBEDDING_API_KEY,
    apiModel: process.env.EMBEDDING_API_MODEL,
  });
}

// 换 embedding 模型后，后台重算存量向量（旧模型的向量与新模型不可比，否则检索失准）。
// 用 app_meta 记录上次的模型；不一致才重算，跑完更新标记。不阻塞启动。
async function maybeReembedOnModelChange(db: Database, emb: EmbeddingService): Promise<void> {
  try {
    const current = emb.getInfo().model;
    if (!current || current === 'unknown') return;
    const stored = await db.getMeta('embedding_model');
    if (stored === current) return;
    console.log(`[reembed] embedding 模型: ${stored || '(无标记)'} -> ${current}，后台重算存量向量...`);
    const n = await db.reembedAllEntities(async (t) => (await emb.embed(t)).embedding);
    await db.setMeta('embedding_model', current);
    console.log(`[reembed] 完成，重算 ${n} 条向量`);
  } catch (e) {
    console.warn('[reembed] 跳过:', e);
  }
}

export function createServer(db: Database, agentLoop?: AgentLoop, embeddingService?: EmbeddingService, decayScheduler?: MemoryDecayScheduler): http.Server {
  const finalEmbeddingService = embeddingService ?? createDefaultEmbeddingService();
  const router = new ApiRouter(db, agentLoop ?? null, finalEmbeddingService, decayScheduler);

  void maybeReembedOnModelChange(db, finalEmbeddingService);

  const localApiToken = (process.env.LOCAL_API_TOKEN || '').trim();
  const pairCode = (process.env.PAIR_CODE || '').trim();

  // 鉴权：所有非 /health 请求都需要 Bearer token
  // localhost 也不再免鉴权 —— 恶意网页 JS 可以扫端口
  function isAuthorized(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization || '';
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = bearerMatch ? bearerMatch[1] : '';

    // 本地 token（桌面应用自带）
    if (localApiToken && token === localApiToken) {
      return true;
    }
    // 配对码（非 localhost 移动端场景）
    if (pairCode && token === pairCode) {
      return true;
    }
    return false;
  }

  return http.createServer(async (req, res) => {
    setSecurityHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
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

    // LAN 鉴权：非本机请求检查配对码
    if (!isAuthorized(req)) {
      sendError(res, 401, 'Unauthorized. Use Authorization: Bearer <token>');
      return;
    }

    await router.handle(req, res);
  });
}

export default ApiRouter;
