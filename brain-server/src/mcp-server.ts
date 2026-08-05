#!/usr/bin/env node
/**
 * Omni-Context Brain Server — stdio MCP protocol adapter.
 *
 * Protocol layer ONLY: transport, framing, error translation.
 * All business semantics live in `mcp/dispatch.ts` (McpBusinessDispatcher),
 * shared with the HTTP adapter (`api/handlers/mcp.ts`). Same input -> same
 * business result on both transports.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import initDatabase, { Database } from './db/sqlite.js';
import { GraphRAGExtractor } from './graphrag/extractor.js';
import { EmbeddingService } from './embedding/service.js';
import { MemoryDecayScheduler } from './memory/decay-scheduler.js';
import { AgentLoop } from './agent/agent-loop.js';
import { createServer } from './api/routes.js';
import { McpBusinessDispatcher } from './mcp/dispatch.js';
import { BusinessError, formatToolResult, formatResourceResult } from './mcp/errors.js';

// Backward-compatible re-export: `toCompactEntity` moved to the unified
// business dispatch layer (mcp/dispatch.ts).
export { toCompactEntity } from './mcp/dispatch.js';

function translateError(error: unknown): McpError {
  if (error instanceof McpError) return error;
  if (error instanceof BusinessError) {
    switch (error.code) {
      case 'INVALID_PARAMS':
        return new McpError(ErrorCode.InvalidParams, error.message);
      case 'NOT_FOUND':
        return new McpError(ErrorCode.InvalidRequest, error.message);
      case 'METHOD_NOT_FOUND':
        return new McpError(ErrorCode.MethodNotFound, error.message);
      default:
        return new McpError(ErrorCode.InternalError, error.message);
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new McpError(ErrorCode.InternalError, message);
}

class OmniContextServer {
  private db: Database;
  private embeddingService: EmbeddingService;
  private dispatcher: McpBusinessDispatcher;
  private server: Server;
  private agentLoop: AgentLoop | null = null;
  private decayScheduler: MemoryDecayScheduler;

  constructor() {
    this.db = initDatabase({
      dbPath: process.env.DB_PATH || './data/omni-context.db',
      enableWAL: true,
      busyTimeout: 5000,
    });

    const extractor = new GraphRAGExtractor();

    // [核心壁垒] Embedding 服务 — 支持本地/API 模式切换
    this.embeddingService = new EmbeddingService({
      mode: (process.env.EMBEDDING_MODE as 'local' | 'api') || 'local',
      localModel: process.env.EMBEDDING_LOCAL_MODEL || 'Xenova/multilingual-e5-large',
      localModelPath: process.env.EMBEDDING_LOCAL_MODEL_PATH,
      apiUrl: process.env.EMBEDDING_API_URL,
      apiKey: process.env.EMBEDDING_API_KEY,
      apiModel: process.env.EMBEDDING_API_MODEL,
    });
    this.db.attachEmbeddingService(this.embeddingService);

    // [核心壁垒] 记忆衰减调度器 — 模拟艾宾浩斯遗忘曲线
    this.decayScheduler = new MemoryDecayScheduler(this.db, {
      decayFactor: 0.95,
      staleDays: 90,
      intervalMs: 60 * 60 * 1000, // 1 小时
      autoStart: true,
    });

    // 单一业务 dispatch 层：stdio 与 HTTP 共享同一实现
    this.dispatcher = new McpBusinessDispatcher({
      db: this.db,
      extractor,
      embeddingService: this.embeddingService,
      decayScheduler: this.decayScheduler,
    });

    this.server = new Server(
      {
        name: 'omni-context-brain-server',
        version: '0.1.1',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
        instructions: `You are connected to Omni-Context, the user's long-term memory and decision support system.

Use memory selectively:
1. Call \`unified_memory_search\` when prior user context, project history, preferences, or past decisions could materially improve the answer. Skip it for simple factual, transient, or unrelated requests.
2. Call \`get_decision_context\` when the user is making a meaningful choice and historical context is relevant.
3. Cite matched memories by name and ignore results that do not clearly match the current topic.
4. Call \`save_conclusion\` only for durable, useful conclusions or explicit user preferences. Do not save small talk, temporary details, guesses, or duplicate conclusions.`,
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => this.dispatcher.listTools());
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const data = await this.dispatcher.callTool(name, args);
        // 与 HTTP JSON-RPC 适配器共用同一格式化器，保证载荷逐字节一致
        return formatToolResult(data);
      } catch (error) {
        throw translateError(error);
      }
    });
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => this.dispatcher.listResources());
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      try {
        const data = await this.dispatcher.readResource(uri);
        return formatResourceResult(uri, data);
      } catch (error) {
        throw translateError(error);
      }
    });
  }

  async start(): Promise<void> {
    await this.db.runMigrations();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Omni-Context Brain Server v2 (统一 GraphRAG 架构) 已启动');

    // [生态升级] 同时启动 HTTP API Server 供浏览器插件和移动端使用
    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
    const HOST = process.env.HOST || '127.0.0.1';
    // [Insights] 主动智能引擎 — 桌面端 InsightsInbox 依赖它产生通知
    const insightIntervalMs = process.env.INSIGHT_INTERVAL_MS
      ? Number(process.env.INSIGHT_INTERVAL_MS)
      : 10 * 60 * 1000;
    this.agentLoop = new AgentLoop(this.db, this.decayScheduler);
    this.agentLoop.start(insightIntervalMs);

    const httpServer = createServer(this.db, this.agentLoop, this.embeddingService, this.decayScheduler, this.dispatcher);
    // 端口冲突场景：用户既开桌面应用、又通过 MCP 接 Claude Desktop / Cursor，
    // 第二个实例无法绑定 3001，但 MCP stdio 仍可工作。这里捕获 EADDRINUSE 让进程
    // 不会因 listen 错误未处理而 crash。
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `[brain-server] HTTP 端口 ${HOST}:${PORT} 已被占用，HTTP API 不可用（MCP stdio 仍正常工作）。`,
          '如果同时打开了 Omni-Context 桌面应用，这是预期现象。'
        );
      } else {
        console.error('[brain-server] HTTP server 错误:', err);
      }
    });
    httpServer.listen(PORT, HOST, () => {
      console.error(`Omni-Context API Server 运行在 http://${HOST}:${PORT} (供外部生态接入)`);
    });
  }

  async stop(): Promise<void> {
    this.agentLoop?.stop();
    this.decayScheduler.stop();
    await this.db.close();
  }
}

async function main() {
  const server = new OmniContextServer();

  process.on('SIGINT', async () => {
    console.error('正在关闭服务器...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('正在关闭服务器...');
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

main().catch((error) => {
  console.error('服务器错误:', error);
  process.exit(1);
});
