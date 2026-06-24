#!/usr/bin/env node
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
import { tools } from './mcp-tools.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const fetchFn = globalThis.fetch;

function getTokenFilePath(): string {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), '.omni-context');
  return join(localAppData, 'omni-context', 'local-token.txt');
}

function readLocalToken(): string {
  try {
    const token = readFileSync(getTokenFilePath(), 'utf-8').trim();
    if (token) return token;
  } catch {
    console.error('[mcp-proxy] 无法读取 local-token.txt，请求将不带鉴权');
  }
  return '';
}

const localToken = readLocalToken();

async function requestBackend(path: string, options: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.signal.aborted || controller.abort(), 30000); // 30s timeout

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string> || {},
    };
    if (localToken) {
      headers['Authorization'] = `Bearer ${localToken}`;
    }
    const res = await fetchFn(`http://localhost:3001${path}`, {
      ...options,
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      let errMsg = `HTTP Error ${res.status}`;
      try {
        const errJson = await res.json() as any;
        if (errJson && errJson.error) {
          errMsg = errJson.error;
        }
      } catch {
        // ignore
      }
      throw new McpError(ErrorCode.InternalError, errMsg);
    }

    return await res.json();
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error instanceof McpError) {
      throw error;
    }

    if (error.name === 'AbortError') {
      throw new McpError(ErrorCode.InternalError, '请求 Omni-Context 后端超时 (30秒)');
    }

    if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      throw new McpError(
        ErrorCode.InternalError,
        'Omni-Context 桌面应用未启动，请先打开主窗口 (brain-server unreachable at localhost:3001)'
      );
    }

    throw new McpError(ErrorCode.InternalError, `代理请求失败: ${error.message || String(error)}`);
  }
}

class McpProxyServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'omni-context-mcp-proxy',
        version: '2.0.0',
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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const exists = tools.some((t) => t.name === name);
      if (!exists) {
        throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
      }

      try {
        const responseData = await requestBackend(`/api/mcp/tool/${name}`, {
          method: 'POST',
          body: JSON.stringify({ arguments: args || {} }),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : String(error)
        );
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        return await requestBackend(`/api/mcp/resources`, {
          method: 'GET',
        });
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : String(error)
        );
      }
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      try {
        return await requestBackend(`/api/mcp/resources/read`, {
          method: 'POST',
          body: JSON.stringify({ uri }),
        });
      } catch (error) {
        if (error instanceof McpError) throw error;
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : String(error)
        );
      }
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Omni-Context MCP Proxy Server (薄壳代理) 已启动');
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Omni-Context MCP Proxy Server');
    console.log('用法: node mcp-proxy.js');
    console.log('此进程作为 stdio MCP 服务器运行，转发请求到 http://localhost:3001');
    process.exit(0);
  }

  const server = new McpProxyServer();
  await server.start();
}

main().catch((error) => {
  console.error('代理服务器启动失败:', error);
  process.exit(1);
});
