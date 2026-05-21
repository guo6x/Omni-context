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
import { EmbeddingService } from './embedding/service.js';
import { MemoryDecayScheduler } from './memory/decay-scheduler.js';
import { AgentLoop } from './agent/agent-loop.js';
import { createServer } from './api/routes.js';
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

const GetDecisionContextSchema = z.object({
  situation: z.string().min(1, 'situation 不能为空'),
  limit: z.number().min(1).max(20).optional().default(5),
});

class OmniContextServer {
  private db: Database;
  private extractor: GraphRAGExtractor;
  private embeddingService: EmbeddingService;
  private decayScheduler: MemoryDecayScheduler;
  private agentLoop: AgentLoop | null = null;
  private server: Server;

  constructor() {
    this.db = initDatabase({
      dbPath: process.env.DB_PATH || './data/omni-context.db',
      enableWAL: true,
      busyTimeout: 5000,
    });

    this.extractor = new GraphRAGExtractor();

    // [核心壁垒] Embedding 服务 — 支持本地/API 模式切换
    this.embeddingService = new EmbeddingService({
      mode: (process.env.EMBEDDING_MODE as 'local' | 'api') || 'local',
      localModel: process.env.EMBEDDING_LOCAL_MODEL || 'Xenova/all-MiniLM-L6-v2',
      apiUrl: process.env.EMBEDDING_API_URL,
      apiKey: process.env.EMBEDDING_API_KEY,
      apiModel: process.env.EMBEDDING_API_MODEL,
    });

    // [核心壁垒] 记忆衰减调度器 — 模拟艾宾浩斯遗忘曲线
    this.decayScheduler = new MemoryDecayScheduler(this.db, {
      decayFactor: 0.95,
      staleDays: 90,
      intervalMs: 60 * 60 * 1000, // 1 小时
      autoStart: true,
    });

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
          description: 'Store a capture event (screenshot, clipboard content, system logs) into the knowledge graph. Use when the user explicitly wants to save a moment or piece of context for future reference.',
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
          description: 'Get the user\'s core principles—their fundamental rules, preferences, and guidelines for how they work. Call this at the start of a conversation to understand the user\'s values and constraints before giving advice.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'search_entities',
          description: 'Search for entities in the knowledge graph by name or description. Use when you need to find specific concepts, tools, people, projects, or code the user has encountered before.',
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
          description: 'Add a new entity to the knowledge graph. Use when you discover a concept, tool, person, pattern, or piece of information worth remembering for future conversations.',
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
          description: 'Retrieve full details and all relationships for a specific entity by its ID. Use when you have an entity ID from search results and need to explore its connections.',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: '实体ID' } },
            required: ['id'],
          },
        },
        {
          name: 'add_relationship',
          description: 'Create a relationship edge between two entities in the knowledge graph (e.g. depends_on, conflicts_with, extends, belongs_to). Use when you discover a meaningful connection between two concepts.',
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
          description: 'Get the graph neighborhood around a specific entity—its directly related entities and their connections. Use when you need to understand the context and ecosystem surrounding a concept, rather than just its properties.',
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
          description: 'Analyze raw text or captured content and automatically extract entities, relationships, and principles into the knowledge graph. Use when processing a saved capture or analyzing a block of user-provided content.',
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
          description: 'List all entities in the knowledge graph, optionally filtered by type. Use to get an overview of what the user has stored, or to browse entities of a specific category.',
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
          description: 'Update an existing entity\'s name, description, tags, or metadata. Use when you need to correct or enrich information about something already in the knowledge graph.',
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
          description: 'Get system statistics: total entity count, relationship count, entity type distribution, and memory usage. Use when you need a high-level overview of the knowledge graph\'s size and composition.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'vector_search',
          description: 'Search the knowledge graph by semantic similarity using vector embeddings. Unlike text search, this finds conceptually related entities even when they use different words. Use when a keyword search misses relevant results.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (natural language, converted to embedding on the server)' },
              limit: { type: 'number', description: 'Max results', default: 10 },
            },
            required: ['query'],
          },
        },
        {
          name: 'unified_memory_search',
          description: 'Fused memory search combining text search, vector similarity, and graph traversal. Returns the most relevant entities for a given query across all three methods, deduplicated. This is the recommended go-to search when you want the most complete results.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索查询（自然语言）' },
              limit: { type: 'number', description: '每类搜索的结果限制', default: 5 },
              includeRelationships: { type: 'boolean', description: '是否包含关联关系', default: true },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_decision_context',
          description: 'When you are facing a specific situation or decision and need context from the user\'s knowledge graph to inform your judgment. Returns relevant principles, related memories, historical conflicts, and graph neighborhood — but does NOT make the decision for you. Call this before giving advice that depends on the user\'s past patterns or preferences.',
          inputSchema: {
            type: 'object',
            properties: {
              situation: { type: 'string', description: 'The situation or decision you are facing (natural language)' },
              limit: { type: 'number', description: 'Max items per result category', default: 5 },
            },
            required: ['situation'],
          },
        },
        {
          name: 'get_decay_report',
          description: 'Get the memory decay report showing which entities have decayed over time and may need reinforcement or cleanup. Use when maintaining the knowledge graph\'s health.',
          inputSchema: { type: 'object', properties: {} },
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
          // [核心壁垒] 自动生成 embedding
          let embedding: number[] | undefined;
          try {
            const embeddingText = `${parsed.name}: ${parsed.description || ''}`;
            const result = await this.embeddingService.embed(embeddingText);
            embedding = result.embedding;
          } catch (e) {
            console.warn('[add_entity] Embedding 生成失败，实体将不包含向量:', e);
          }
          const entity = await this.db.addEntity({
            name: parsed.name,
            type: parsed.type as EntityType,
            description: parsed.description,
            tags: parsed.tags,
            metadata: parsed.metadata,
            embedding,
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

          // 先并发生成所有实体的 embedding（带并发上限），再串行落库以避免 SQLite 写竞争
          const EMBED_CONCURRENCY = 4;
          for (let i = 0; i < result.entities.length; i += EMBED_CONCURRENCY) {
            const batch = result.entities.slice(i, i + EMBED_CONCURRENCY);
            await Promise.all(batch.map(async (entity) => {
              try {
                const embeddingText = `${entity.name}: ${entity.description || ''}`;
                const embResult = await this.embeddingService.embed(embeddingText);
                entity.embedding = embResult.embedding;
              } catch {
                // embedding 失败不阻塞主流程
              }
            }));
          }

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
            } catch (e) {
              // UNIQUE 约束冲突（重复关系）是预期的，其他错误需要记录
              const msg = e instanceof Error ? e.message : String(e);
              if (!msg.includes('UNIQUE constraint')) {
                console.error(`[extract_from_capture] 关系保存失败:`, msg);
              }
            }
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

          // 走 db API 保证返回结构与 getEntity 一致（tags / metadata 已反序列化）
          const entities = type
            ? await this.db.getEntitiesByType(type)
            : await this.db.getRecentEntities(limit);

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
          const query = args.query as string;
          if (!query) {
            throw new McpError(ErrorCode.InvalidParams, '缺少必需参数: query');
          }
          try {
            const embResult = await this.embeddingService.embed(query);
            const results = await this.db.vectorSearch(embResult.embedding, args.limit as number || 10);
            return this.formatResponse(results);
          } catch (e) {
            console.warn('[vector_search] 失败:', e);
            return this.formatResponse({ results: [], error: '向量搜索失败' });
          }
        }

        case 'unified_memory_search': {
          const query = args.query as string;
          const limit = (args.limit as number) || 5;
          const includeRels = args.includeRelationships !== false;

          // [核心壁垒] 三层记忆融合检索
          const results: any = { textResults: [], vectorResults: [], graphContext: [] };

          // 层1：文本搜索（FTS5 → LIKE 回退）
          results.textResults = await this.db.searchEntities(query, limit);

          // 层2：向量搜索（需要先将 query 转为 embedding）
          try {
            const embResult = await this.embeddingService.embed(query);
            results.vectorResults = await this.db.vectorSearch(embResult.embedding, limit);
          } catch (e) {
            // embedding 或向量搜索失败不阻塞
          }

          // 层3：图谱遍历（从搜索命中的实体出发，获取关联上下文）
          // 文本搜索为空时回退用向量搜索的 top 命中作为种子，避免完全丢图谱信号
          if (includeRels) {
            const seedId = results.textResults[0]?.id ?? results.vectorResults[0]?.id;
            if (seedId) {
              results.graphContext = await this.db.getGraphNeighborhood(seedId, 2);
            }
          }

          // 融合去重
          const seenIds = new Set<string>();
          const unified = [];
          for (const source of [results.textResults, results.vectorResults]) {
            for (const item of source) {
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                unified.push(item);
              }
            }
          }

          return this.formatResponse({
            results: unified.slice(0, limit * 2),
            graphContext: results.graphContext,
            searchMethods: {
              text: results.textResults.length,
              vector: results.vectorResults.length,
              graph: results.graphContext?.nodes?.length || 0,
            },
          });
        }

        case 'get_decision_context': {
          const parsed = GetDecisionContextSchema.parse(args);
          const { situation, limit } = parsed;

          // 层1：文本搜索
          const textResults = await this.db.searchEntities(situation, limit);

          // 层2：向量搜索
          let vectorResults: any[] = [];
          try {
            const embResult = await this.embeddingService.embed(situation);
            vectorResults = await this.db.vectorSearch(embResult.embedding, limit);
          } catch {
            // embedding 失败不阻塞
          }

          // 融合去重
          const seen = new Set<string>();
          const relevantMemories: any[] = [];
          for (const source of [textResults, vectorResults]) {
            for (const item of source) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                relevantMemories.push(item);
              }
            }
          }

          // 相关原则：核心原则 + 检索结果中的 principle 类型
          const corePrinciples = await this.db.getCorePrinciples();
          const seenPrincipleIds = new Set(corePrinciples.map((p: any) => p.id));
          const searchPrinciples = relevantMemories.filter(
            (m) => m.type === 'principle' && !seenPrincipleIds.has(m.id)
          );
          const principles = [...corePrinciples, ...searchPrinciples];

          // 冲突检测：相关实体集合内由 conflicts_with 连接的实体对
          const relevantIds = new Set(relevantMemories.map((m: any) => m.id));
          const conflictPairs: any[] = [];
          const seenConflictKeys = new Set<string>();
          for (const entity of relevantMemories) {
            const rels = await this.db.getRelationshipsForEntity(entity.id);
            for (const rel of rels) {
              if (rel.type !== 'conflicts_with') continue;
              const otherId = rel.source_id === entity.id ? rel.target_id : rel.source_id;
              if (!relevantIds.has(otherId)) continue;
              const key = [entity.id, otherId].sort().join('|');
              if (seenConflictKeys.has(key)) continue;
              seenConflictKeys.add(key);
              const other = relevantMemories.find((m: any) => m.id === otherId);
              if (other) {
                conflictPairs.push({
                  a: { id: entity.id, name: entity.name },
                  b: { id: other.id, name: other.name },
                  description: rel.description || '',
                });
              }
            }
          }

          // 图谱邻域：以检索 top 命中为种子
          let graphContext: any = {};
          const seed = relevantMemories[0];
          if (seed) {
            try {
              graphContext = await this.db.getGraphNeighborhood(seed.id, 2);
            } catch {
              // 图谱查询失败不阻塞
            }
          }

          return this.formatResponse({
            situation,
            principles,
            relevantMemories,
            conflicts: conflictPairs,
            graphContext,
          });
        }

        case 'get_decay_report': {
          const report = this.decayScheduler.getLastReport();
          return this.formatResponse(report || { message: '尚未执行衰减周期' });
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

    // [生态升级] 同时启动 HTTP API Server 供浏览器插件和移动端使用
    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
    const HOST = process.env.HOST || '127.0.0.1';
    // [Insights] 主动智能引擎 — 桌面端 InsightsInbox 依赖它产生通知
    const insightIntervalMs = process.env.INSIGHT_INTERVAL_MS
      ? Number(process.env.INSIGHT_INTERVAL_MS)
      : 10 * 60 * 1000;
    this.agentLoop = new AgentLoop(this.db);
    this.agentLoop.start(insightIntervalMs);

    const httpServer = createServer(this.db, this.agentLoop);
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
