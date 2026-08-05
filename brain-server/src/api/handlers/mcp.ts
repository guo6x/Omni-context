import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { scopeForMcpTool, AuthPrincipal } from '../../security/auth.js';
import { McpBusinessDispatcher } from '../../mcp/dispatch.js';
import { BusinessError, businessErrorToHttpStatus, formatToolResult } from '../../mcp/errors.js';
import { tools as mcpToolDefs } from '../../mcp-tools.js';

/**
 * HTTP adapter for the unified MCP business dispatch layer.
 *
 * Protocol layer ONLY: routing, auth, logging, error translation.
 * All business semantics live in `mcp/dispatch.ts` (McpBusinessDispatcher),
 * shared with the stdio adapter (`mcp-server.ts`). Same input -> same result.
 */

const MCP_HTTP_INSTRUCTIONS = `You are connected to Omni-Context, the user's long-term memory and decision support system.

Before answering any substantive question:
1. Call \`unified_memory_search\` with key terms from the user's question to check whether they've discussed this topic before.
2. If the user is choosing between options or making a decision, call \`get_decision_context\` with their situation as the \`situation\` argument.
3. Cite matched memories by name in your answer so the user can verify.
4. At the end of a substantive conversation that produced a conclusion, call \`save_conclusion\` to persist the key takeaway.

These tools are read-cheap; over-call rather than under-call.`;

function getClientLabel(req: http.IncomingMessage): string {
  const explicit = req.headers['x-omni-client'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 80);
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string' && ua.trim()) return ua.trim().slice(0, 80);
  return 'mcp-client';
}

function extractQuerySummary(args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const fields = ['query', 'situation', 'question', 'summary', 'name', 'text'];
  for (const field of fields) {
    const value = args[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 500);
    }
  }
  return undefined;
}

function collectMatchedEntities(value: any, out: Array<{ id: string; name?: string; type?: string }> = []): Array<{ id: string; name?: string; type?: string }> {
  if (!value || out.length >= 12) return out;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMatchedEntities(item, out);
      if (out.length >= 12) break;
    }
    return out;
  }
  if (typeof value !== 'object') return out;

  const id = typeof value.id === 'string' ? value.id : typeof value.entityId === 'string' ? value.entityId : undefined;
  const name = typeof value.name === 'string' ? value.name : typeof value.entityName === 'string' ? value.entityName : undefined;
  const type = typeof value.type === 'string' ? value.type : typeof value.entityType === 'string' ? value.entityType : undefined;
  if (id && (name || type || value.description)) {
    if (!out.some((e) => e.id === id)) out.push({ id, name, type });
  }

  for (const key of ['results', 'sources', 'rawCitations', 'relevantMemories', 'principles', 'nodes', 'graphContext', 'entity', 'candidatePool', 'evidence']) {
    if (value[key] !== undefined) {
      collectMatchedEntities(value[key], out);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function rpcResult(id: any, result: any) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function rpcError(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * JSON-RPC (streamable-HTTP style) entry. Protocol layer only: parses the
 * request, performs per-tool scope checks, delegates to the shared business
 * dispatcher, and formats JSON-RPC responses.
 */
async function handleMcpRpcMessage(msg: any, principal: AuthPrincipal, dispatcher: McpBusinessDispatcher): Promise<any | null> {
  const id = msg?.id;
  const method = msg?.method;
  const params = msg?.params || {};
  if (typeof method !== 'string') return null;
  if (method.startsWith('notifications/')) return null; // 通知不回响应

  try {
    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'omni-context', version: '2.0.0' },
        instructions: MCP_HTTP_INSTRUCTIONS,
      });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: mcpToolDefs.map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    }
    if (method === 'tools/call') {
      const name = params.name;
      if (!mcpToolDefs.some((t: any) => t.name === name)) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      // Per-tool scope 检查（鉴权属于协议层）
      const requiredScope = scopeForMcpTool(name);
      if (requiredScope && !principal.scopes.has(requiredScope)) {
        return rpcError(id, -32602, `Permission denied: missing scope ${requiredScope}`);
      }
      try {
        const data = await dispatcher.callTool(name, params.arguments || {});
        return rpcResult(id, formatToolResult(data));
      } catch (e: any) {
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${e?.message || String(e)}` }], isError: true });
      }
    }
    return rpcError(id, -32601, `Method not found: ${method}`);
  } catch (e: any) {
    return rpcError(id, -32603, e?.message || String(e));
  }
}

export const handleMcpRoutes = [
  {
    method: 'POST' as const,
    path: '/mcp',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<any>(req);
      let payload: any;
      if (Array.isArray(body)) {
        const results = (await Promise.all(body.map((m) => handleMcpRpcMessage(m, ctx.auth, ctx.mcpDispatcher)))).filter((r) => r !== null);
        payload = results.length ? results : null;
      } else {
        payload = await handleMcpRpcMessage(body, ctx.auth, ctx.mcpDispatcher);
      }
      if (payload === null) {
        res.statusCode = 202; // 仅通知，无响应体
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    },
  },
  {
    method: 'GET' as const,
    path: '/mcp',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse) => {
      // 不做服务端主动推送(SSE)，请求-响应足够
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed; use POST for JSON-RPC' }));
    },
  },
  {
    method: 'POST' as const,
    path: '/api/mcp/tool/:name',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const toolName = params.name;
      const body = await parseBody<{ arguments: any }>(req);
      const args = body.arguments || {};
      const startedAt = Date.now();
      const client = getClientLabel(req);
      const query = extractQuerySummary(args);

      try {
        // 业务执行：全部委托给统一 dispatch 层（与 stdio 同一实现）
        const result = await ctx.mcpDispatcher.callTool(toolName, args);
        const matchedEntities = collectMatchedEntities(result);

        // ── 协议层日志与埋点 ──
        const behaviorEvents: import('../../behavior/events.js').BehaviorEventInput[] = [];
        if (['search_entities', 'vector_search', 'unified_memory_search', 'get_decision_context', 'ask_memory', 'graph_answer'].includes(toolName)) {
          behaviorEvents.push({ eventType: 'searched', topic: query, intent: 'informational' });
        }
        for (const entity of matchedEntities) {
          behaviorEvents.push({ eventType: 'retrieved', entityId: entity.id, topic: query, intent: 'informational' });
          if (['ask_memory', 'graph_answer', 'analyze_decision', 'discuss_decision'].includes(toolName)) {
            behaviorEvents.push({ eventType: 'cited', entityId: entity.id, topic: query, intent: 'informational' });
          }
        }
        if (['record_capture', 'extract_from_capture', 'save_conclusion'].includes(toolName)) {
          behaviorEvents.push({ eventType: 'captured', topic: query, intent: 'action' });
        }
        if (toolName === 'update_entity' || toolName === 'record_decision_outcome') {
          behaviorEvents.push({ eventType: 'edited', entityId: typeof args.id === 'string' ? args.id : undefined, intent: 'action' });
        }
        if (toolName === 'save_decision') {
          behaviorEvents.push({ eventType: 'decided', entityId: typeof result?.id === 'string' ? result.id : undefined, topic: query, intent: 'action' });
        }
        try {
          await ctx.db.recordBehaviorEvents(behaviorEvents);
        } catch (behaviorError) {
          console.warn(`[MCP behavior] failed to record ${toolName}:`, behaviorError);
        }

        ctx.db.addMcpUsageLog({
          toolName,
          client,
          query,
          matchedEntities,
          success: true,
          durationMs: Date.now() - startedAt,
        }).catch(() => {});
        sendResponse(res, 200, result);
      } catch (error) {
        console.error(`MCP tool execution error (${toolName}):`, error);
        ctx.db.addMcpUsageLog({
          toolName,
          client,
          query,
          matchedEntities: [],
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        }).catch(() => {});
        if (error instanceof BusinessError) {
          sendError(res, businessErrorToHttpStatus(error.code), error.message);
        } else {
          sendError(res, 500, error instanceof Error ? error.message : String(error));
        }
      }
    },
  },
  {
    method: 'GET' as const,
    path: '/api/mcp/usage',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const limit = q.get('limit') ? Number(q.get('limit')) : 20;
      sendResponse(res, 200, await ctx.db.getRecentMcpUsage(limit));
    },
  },
  {
    method: 'GET' as const,
    path: '/api/mcp/resources',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      try {
        const data = await ctx.mcpDispatcher.listResources();
        sendResponse(res, 200, data);
      } catch (error) {
        sendError(res, 500, error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    method: 'POST' as const,
    path: '/api/mcp/resources/read',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      try {
        const body = await parseBody<{ uri: string }>(req);
        const uri = body.uri;
        if (!uri) {
          return sendError(res, 400, 'URI is required');
        }
        const data = await ctx.mcpDispatcher.readResource(uri);
        sendResponse(res, 200, {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        });
      } catch (error) {
        if (error instanceof BusinessError) {
          sendError(res, businessErrorToHttpStatus(error.code), error.message);
        } else {
          sendError(res, 500, error instanceof Error ? error.message : String(error));
        }
      }
    },
  },
];