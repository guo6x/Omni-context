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
import initDatabase, { Database } from './db/sqlite.js';
import { GraphRAGExtractor } from './graphrag/extractor.js';
import { z } from 'zod';
import type { EntityType, RelationshipType } from './shared-types.js';

const RecordCaptureSchema = z.object({
  screenshot: z.string().optional(),
  clipboard: z.string().optional(),
  activeWindow: z.string().optional(),
  systemLogs: z.string().optional(),
  source: z.enum(['physical_button', 'keyboard_shortcut', 'manual', 'automated']),
  buttonType: z.enum(['precipitate', 'decision', 'reset']).optional(),
});

const AddEntitySchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  type: z.enum([
    'principle',
    'evidence',
    'concept',
    'tool',
    'person',
    'project',
    'code_snippet',
    'architecture_pattern',
    'bug_vulnerability',
    'business_logic',
    'critical_review',
    'capture_snapshot',
    'memory',
  ]),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.any().optional(),
});

const AddRelationshipSchema = z.object({
  sourceId: z.string().min(1, '源实体ID不能为空'),
  targetId: z.string().min(1, '目标实体ID不能为空'),
  type: z.enum([
    'derived_from',
    'relates_to',
    'depends_on',
    'conflicts_with',
    'extends',
    'cites',
    'belongs_to',
    'supported_by',
    'extracted_from',
    'reviewed_by',
    'references',
  ]),
  description: z.string().optional(),
  weight: z.number().min(0).optional(),
});

const GetGraphNeighborhoodSchema = z.object({
  entityId: z.string(),
  depth: z.number().min(1).max(3).optional().default(2),
});

const ExtractFromCaptureSchema = z.object({
  text: z.string().optional(),
  screenshot: z.string().optional(),
  clipboard: z.string().optional(),
  captureId: z.string().optional(),
});

class OmniContextServer {
  private db: Database;
  private extractor: GraphRAGExtractor;
  private server: Server;

  constructor() {
    this.db = initDatabase({
      dbPath: process.env.DB_PATH || './data/omni-context.db',
      enableWAL: true,
      busyTimeout: 5000,
    });

    this.extractor = new GraphRAGExtractor();

    this.server = new Server(
      {
        name: 'omni-context-brain-server',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => this.listTools());
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => this.callTool(request));
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => this.listResources());
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => this.readResource(request));
  }

  private async listTools() {
    return {
      tools: [
        {
          name: 'record_capture',
          description: '记录沉淀事件（物理按钮或键盘快捷键触发）- 核心入口',
          inputSchema: {
            type: 'object',
            properties: {
              screenshot: { type: 'string', description: '截图数据（base64）' },
              clipboard: { type: 'string', description: '剪贴板内容' },
              activeWindow: { type: 'string', description: '当前活动窗口' },
              systemLogs: { type: 'string', description: '系统日志' },
              source: {
                type: 'string',
                enum: ['physical_button', 'keyboard_shortcut', 'manual', 'automated'],
                description: '触发源',
              },
              buttonType: {
                type: 'string',
                enum: ['precipitate', 'decision', 'reset'],
                description: '按钮类型',
              },
            },
            required: ['source'],
          },
        },
        {
          name: 'get_core_context',
          description: '获取核心原则上下文（自动注入每次对话系统提示词）',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'search_entities',
          description: '搜索知识图谱实体',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索查询' },
              type: { type: 'string', description: '实体类型过滤' },
              limit: { type: 'number', description: '结果限制', default: 10 },
            },
            required: ['query'],
          },
        },
        {
          name: 'add_entity',
          description: '添加实体到知识图谱',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '实体名称' },
              type: {
                type: 'string',
                enum: [
                  'principle',
                  'evidence',
                  'concept',
                  'tool',
                  'person',
                  'project',
                  'code_snippet',
                  'architecture_pattern',
                  'bug_vulnerability',
                  'business_logic',
                  'critical_review',
                  'capture_snapshot',
                  'memory',
                ],
                description: '实体类型',
              },
              description: { type: 'string', description: '实体描述' },
              tags: { type: 'array', items: { type: 'string' }, description: '标签' },
              metadata: { type: 'object', description: '扩展元数据（原则的 isCore、version 等）' },
            },
            required: ['name', 'type'],
          },
        },
        {
          name: 'get_entity',
          description: '获取指定实体信息',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: '实体ID' } },
            required: ['id'],
          },
        },
        {
          name: 'add_relationship',
          description: '添加实体关系',
          inputSchema: {
            type: 'object',
            properties: {
              sourceId: { type: 'string', description: '源实体ID' },
              targetId: { type: 'string', description: '目标实体ID' },
              type: {
                type: 'string',
                enum: [
                  'derived_from',
                  'relates_to',
                  'depends_on',
                  'conflicts_with',
                  'extends',
                  'cites',
                  'belongs_to',
                  'supported_by',
                  'extracted_from',
                  'reviewed_by',
                  'references',
                ],
                description: '关系类型',
              },
              description: { type: 'string', description: '关系描述' },
              weight: { type: 'number', description: '权重（记忆衰减机制）' },
            },
            required: ['sourceId', 'targetId', 'type'],
          },
        },
        {
          name: 'get_graph_neighborhood',
          description: '获取图邻域上下文（用于3D可视化）',
          inputSchema: {
            type: 'object',
            properties: {
              entityId: { type: 'string', description: '起始实体ID' },
              depth: { type: 'number', description: '遍历深度 1-3', default: 2 },
            },
            required: ['entityId'],
          },
        },
        {
          name: 'extract_from_capture',
          description: '从沉淀内容提取知识图谱（实体、关系、原则）',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: '文本内容' },
              screenshot: { type: 'string', description: '截图数据' },
              clipboard: { type: 'string', description: '剪贴板内容' },
              captureId: { type: 'string', description: '关联的capture_snapshot实体ID' },
            },
          },
        },
        {
          name: 'list_entities',
          description: '列出知识图谱实体',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', description: '按类型过滤' },
              limit: { type: 'number', description: '结果限制', default: 50 },
            },
          },
        },
        {
          name: 'update_entity',
          description: '更新实体信息',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '实体ID' },
              name: { type: 'string', description: '新名称' },
              description: { type: 'string', description: '新描述' },
              tags: { type: 'array', items: { type: 'string' }, description: '新标签' },
              metadata: { type: 'object', description: '新元数据' },
            },
            required: ['id'],
          },
        },
        {
          name: 'get_stats',
          description: '获取系统统计信息',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'vector_search',
          description: '向量相似度搜索',
          inputSchema: {
            type: 'object',
            properties: {
              embedding: { type: 'array', items: { type: 'number' }, description: '查询向量' },
              limit: { type: 'number', description: '结果限制', default: 10 },
            },
            required: ['embedding'],
          },
        },
      ],
    };
  }

  private async callTool(request: any) {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'record_capture': {
          const parsed = RecordCaptureSchema.parse(args);
          const capture = await this.db.addEntity({
            name: `Capture_${new Date().toISOString()}`,
            type: 'capture_snapshot',
            description: '沉淀事件记录',
            tags: ['capture', parsed.buttonType || parsed.source],
            metadata: {
              screenshot: parsed.screenshot,
              clipboard: parsed.clipboard,
              activeWindow: parsed.activeWindow,
              systemLogs: parsed.systemLogs,
              source: parsed.source,
              buttonType: parsed.buttonType,
            },
          });
          return this.formatResponse({ captureId: capture.id, success: true });
        }

        case 'get_core_context': {
          const corePrinciples = await this.db.getCorePrinciples();
          const context = {
            role: 'system',
            content: `[Omni-Context Core Principles]

${corePrinciples.map((p, i) => `${i + 1}. **${p.name}**
   ${p.description || ''}
   Metadata: ${JSON.stringify(p.metadata, null, 2)}
`).join('\n')}

请务必遵循以上核心原则进行工作。`,
          };
          return this.formatResponse(context);
        }

        case 'search_entities': {
          const query = args.query as string;
          const type = args.type as string;
          const limit = (args.limit as number) || 10;

          let entities;
          if (type) {
            entities = await this.db.getEntitiesByType(type);
            entities = entities.filter((e) =>
              e.name.toLowerCase().includes(query.toLowerCase()) ||
              e.description?.toLowerCase().includes(query.toLowerCase())
            ).slice(0, limit);
          } else {
            entities = await this.db.searchEntities(query, limit);
          }
          return this.formatResponse(entities);
        }

        case 'add_entity': {
          const parsed = AddEntitySchema.parse(args);
          const entity = await this.db.addEntity({
            name: parsed.name,
            type: parsed.type as EntityType,
            description: parsed.description,
            tags: parsed.tags,
            metadata: parsed.metadata,
          });
          return this.formatResponse(entity);
        }

        case 'get_entity': {
          if (!args.id) {
            throw new McpError(ErrorCode.InvalidParams, '缺少必需参数: id');
          }
          const entity = await this.db.getEntity(args.id as string);
          if (!entity) {
            throw new McpError(ErrorCode.InvalidRequest, `实体未找到: ${args.id}`);
          }
          const relationships = await this.db.getRelationshipsForEntity(entity.id);
          return this.formatResponse({ entity, relationships });
        }

        case 'add_relationship': {
          const parsed = AddRelationshipSchema.parse(args);
          const source = await this.db.getEntity(parsed.sourceId);
          const target = await this.db.getEntity(parsed.targetId);
          if (!source) {
            throw new McpError(ErrorCode.InvalidRequest, `源实体未找到: ${parsed.sourceId}`);
          }
          if (!target) {
            throw new McpError(ErrorCode.InvalidRequest, `目标实体未找到: ${parsed.targetId}`);
          }
          const relationship = await this.db.addRelationship({
            source_id: parsed.sourceId,
            target_id: parsed.targetId,
            type: parsed.type as RelationshipType,
            description: parsed.description,
            weight: parsed.weight || 1.0,
          });
          return this.formatResponse(relationship);
        }

        case 'get_graph_neighborhood': {
          const parsed = GetGraphNeighborhoodSchema.parse(args);
          const neighborhood = await this.db.getGraphNeighborhood(parsed.entityId, parsed.depth);
          return this.formatResponse(neighborhood);
        }

        case 'extract_from_capture': {
          const parsed = ExtractFromCaptureSchema.parse(args);
          const input = {
            textContent: parsed.text,
            screenshot: parsed.screenshot,
            clipboard: parsed.clipboard,
            timestamp: new Date().toISOString(),
          };
          const result = await this.extractor.extract(input);
          const savedEntities = [];
          const savedRelationships = [];

          for (const entity of result.entities) {
            const saved = await this.db.addEntity(entity);
            savedEntities.push(saved);
            if (parsed.captureId) {
              await this.db.addRelationship({
                source_id: parsed.captureId,
                target_id: saved.id,
                type: 'extracted_from',
                description: '从capture提取的实体',
                weight: 1.0,
              });
            }
          }

          for (const relationship of result.relationships) {
            try {
              const saved = await this.db.addRelationship(relationship);
              savedRelationships.push(saved);
            } catch (e) {}
          }

          for (const principle of result.principles) {
            const saved = await this.db.addEntity({
              name: principle.title,
              type: 'principle',
              description: principle.content,
              tags: ['auto_extracted'],
              metadata: {
                isCore: principle.isCore,
                version: principle.version || 1,
              },
            });
            savedEntities.push(saved);
            if (parsed.captureId) {
              await this.db.addRelationship({
                source_id: parsed.captureId,
                target_id: saved.id,
                type: 'extracted_from',
                description: '从capture提取的原则',
                weight: 1.0,
              });
            }
          }

          return this.formatResponse({
            entitiesAdded: savedEntities.length,
            relationshipsAdded: savedRelationships.length,
            summary: await this.extractor.summarizeEntities(result.entities),
          });
        }

        case 'list_entities': {
          const type = args.type as string;
          const limit = (args.limit as number) || 50;

          let entities;
          if (type) {
            entities = await this.db.getEntitiesByType(type);
          } else {
            const rows = await this.db.all('SELECT * FROM entities ORDER BY updated_at DESC LIMIT ?', [limit]);
            entities = rows;
          }

          return this.formatResponse(entities.slice(0, limit));
        }

        case 'update_entity': {
          if (!args.id) {
            throw new McpError(ErrorCode.InvalidParams, '缺少必需参数: id');
          }
          await this.db.updateEntity(args.id, {
            name: args.name,
            description: args.description,
            tags: args.tags,
            metadata: args.metadata,
          });
          const updated = await this.db.getEntity(args.id);
          return this.formatResponse(updated);
        }

        case 'get_stats': {
          const stats = await this.db.getStats();
          return this.formatResponse(stats);
        }

        case 'vector_search': {
          const results = await this.db.vectorSearch(args.embedding as number[], args.limit as number || 10);
          return this.formatResponse(results);
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (error instanceof z.ZodError) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `参数验证失败: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `执行错误: ${errorMessage}`);
    }
  }

  private async listResources() {
    const entityTypes = await this.db.all<{ type: string; count: number }>(
      'SELECT type, COUNT(*) as count FROM entities GROUP BY type'
    );

    return {
      resources: [
        {
          uri: 'memory://graph',
          name: '知识图谱',
          description: '完整的知识图谱',
          mimeType: 'application/json',
        },
        {
          uri: 'memory://core-principles',
          name: '核心原则',
          description: '核心原则（Letta Core Memory）',
          mimeType: 'application/json',
        },
        {
          uri: 'memory://stats',
          name: '系统统计',
          description: '系统统计信息',
          mimeType: 'application/json',
        },
        ...entityTypes.map((et) => ({
          uri: `memory://entities/${encodeURIComponent(et.type)}`,
          name: `实体: ${et.type}`,
          description: `${et.type}类型实体 (${et.count}个)`,
          mimeType: 'application/json',
        })),
      ],
    };
  }

  private async readResource(request: any) {
    const { uri } = request.params;

    if (uri === 'memory://graph') {
      const entities = await this.db.all('SELECT * FROM entities LIMIT 200');
      const relationships = await this.db.all('SELECT * FROM relationships LIMIT 200');
      return this.formatResource(uri, { entities, relationships });
    }

    if (uri === 'memory://core-principles') {
      const principles = await this.db.getCorePrinciples();
      return this.formatResource(uri, principles);
    }

    if (uri === 'memory://stats') {
      const stats = await this.db.getStats();
      return this.formatResource(uri, stats);
    }

    const entityTypeMatch = uri.match(/^memory:\/\/entities\/(.+)$/);
    if (entityTypeMatch) {
      const type = decodeURIComponent(entityTypeMatch[1]);
      const entities = await this.db.getEntitiesByType(type);
      return this.formatResource(uri, entities);
    }

    throw new McpError(ErrorCode.InvalidRequest, `未知资源: ${uri}`);
  }

  private formatResponse(data: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private formatResource(uri: string, data: any) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  async start(): Promise<void> {
    await this.db.runMigrations();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Omni-Context Brain Server v2 (统一 GraphRAG 架构) 已启动');
  }

  async stop(): Promise<void> {
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
