import http from 'http';
import { URL } from 'url';
import { CoreMemory } from '../memory/core-memory.js';
import { ArchivalMemory } from '../memory/archival-memory.js';
import { GraphRAGExtractor } from '../graphrag/extractor.js';
import { handleMemoryRoutes, handleEntityRoutes, handlePrincipleRoutes, handleGraphRoutes, handleStatsRoutes, handleNotificationRoutes, handleAdminRoutes, handleIngestRoutes } from './handlers/index.js';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 15 * 1024 * 1024);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'tauri://localhost',
    'http://tauri.localhost',
].join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const rateLimitBuckets = new Map();
const RATE_LIMIT_MAX_KEYS = 5000;
// 兜底清理：避免长时间运行下 rate-limit 桶无限累积
function pruneRateLimitBuckets(now) {
    if (rateLimitBuckets.size <= RATE_LIMIT_MAX_KEYS)
        return;
    for (const [key, bucket] of rateLimitBuckets) {
        if (bucket.resetAt <= now)
            rateLimitBuckets.delete(key);
    }
    // 仍然超限：硬剪到一半，最早过期的先丢
    if (rateLimitBuckets.size > RATE_LIMIT_MAX_KEYS) {
        const sorted = [...rateLimitBuckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        const toRemove = sorted.slice(0, sorted.length - Math.floor(RATE_LIMIT_MAX_KEYS / 2));
        for (const [key] of toRemove)
            rateLimitBuckets.delete(key);
    }
}
export class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}
export class ApiRouter {
    constructor(db) {
        this.context = {
            db,
            coreMemory: new CoreMemory(db),
            archivalMemory: new ArchivalMemory(db),
            extractor: new GraphRAGExtractor(),
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
        ];
    }
    async handle(req, res) {
        const url = new URL(req.url || '/', 'http://localhost');
        const pathname = url.pathname;
        const method = req.method;
        res.setHeader('Content-Type', 'application/json');
        try {
            for (const route of this.routes) {
                if (route.method !== method)
                    continue;
                const params = this.matchPath(route.path, pathname);
                if (params !== null) {
                    await route.handler(req, res, this.context, params);
                    return;
                }
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not Found' }));
        }
        catch (error) {
            console.error('API Error:', error);
            if (error instanceof HttpError) {
                sendError(res, error.statusCode, error.message);
                return;
            }
            sendError(res, 500, 'Internal Server Error');
        }
    }
    matchPath(pattern, pathname) {
        const patternParts = pattern.split('/').filter(Boolean);
        const pathParts = pathname.split('/').filter(Boolean);
        if (patternParts.length !== pathParts.length) {
            return null;
        }
        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            const patternPart = patternParts[i];
            const pathPart = pathParts[i];
            if (patternPart.startsWith(':')) {
                params[patternPart.slice(1)] = decodeURIComponent(pathPart);
            }
            else if (patternPart !== pathPart) {
                return null;
            }
        }
        return params;
    }
}
export async function parseBody(req) {
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
            if (settled)
                return;
            try {
                if (body && !String(req.headers['content-type'] || '').includes('application/json')) {
                    reject(new HttpError(415, 'Content-Type must be application/json'));
                    return;
                }
                resolve(body ? JSON.parse(body) : {});
            }
            catch (error) {
                reject(new HttpError(400, 'Invalid JSON'));
            }
        });
        req.on('error', (error) => {
            if (!settled)
                reject(error);
        });
    });
}
export function sendResponse(res, statusCode, data) {
    res.statusCode = statusCode;
    res.end(JSON.stringify(data));
}
export function sendError(res, statusCode, message) {
    res.statusCode = statusCode;
    res.end(JSON.stringify({ error: message }));
}
function getAllowedOrigin(origin) {
    if (!origin)
        return null;
    if (ALLOWED_ORIGINS.includes(origin))
        return origin;
    if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
        return origin;
    }
    return null;
}
function setSecurityHeaders(req, res) {
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
function isHealthRequest(req) {
    if (req.method !== 'GET')
        return false;
    const rawUrl = req.url || '/';
    const pathname = rawUrl.split('?', 1)[0];
    return pathname === '/health';
}
function checkRateLimit(req, res) {
    if (req.method === 'OPTIONS' || isHealthRequest(req))
        return true;
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
export function createServer(db) {
    const router = new ApiRouter(db);
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
        await router.handle(req, res);
    });
}
export default ApiRouter;
