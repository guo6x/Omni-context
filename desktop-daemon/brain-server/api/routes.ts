import http from 'http';
import { URL } from 'url';
import { Database } from '../db/sqlite.js';
import { CoreMemory } from '../memory/core-memory.js';
import { ArchivalMemory } from '../memory/archival-memory.js';
import { GraphRAGExtractor } from '../graphrag/extractor.js';
import { 
  handleMemoryRoutes,
  handleEntityRoutes,
  handlePrincipleRoutes,
  handleGraphRoutes,
  handleStatsRoutes
} from './handlers/index.js';

export interface RequestContext {
  db: Database;
  coreMemory: CoreMemory;
  archivalMemory: ArchivalMemory;
  extractor: GraphRAGExtractor;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => Promise<void>;
}

export class ApiRouter {
  private routes: Route[];
  private context: RequestContext;

  constructor(db: Database) {
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
    ];
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
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
      res.statusCode = 500;
      res.end(JSON.stringify({ 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }));
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
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
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

export function createServer(db: Database): http.Server {
  const router = new ApiRouter(db);

  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    await router.handle(req, res);
  });
}

export default ApiRouter;
