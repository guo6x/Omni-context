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
import { resolveConflicts } from './graphrag/conflict-resolver.js';
import { resolveEntities } from './graphrag/entity-resolver.js';
import { EmbeddingService } from './embedding/service.js';
import { MemoryDecayScheduler } from './memory/decay-scheduler.js';
import { AgentLoop } from './agent/agent-loop.js';
import { createServer } from './api/routes.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { EntityType, RelationshipType, Entity } from './shared-types.js';

/**
 * 精简实体，丢弃 embedding 和 metadata，保留关键字段，并截断 description。
 */
export function toCompactEntity(entity: any): any {
  if (!entity) return entity;

  let description = entity.description;
  if (typeof description === 'string' && description.length > 200) {
    description = description.substring(0, 200) + '...';
  }

  const compact: any = {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    tags: entity.tags,
    created_at: entity.created_at,
    access_count: entity.access_count,
  };

  if (description !== undefined) {
    compact.description = description;
  }

  if (entity.similarity !== undefined) {
    compact.similarity = entity.similarity;
  }

  return compact;
}

import {
  tools,
  RecordCaptureSchema,
  AddEntitySchema,
  AddRelationshipSchema,
  GetGraphNeighborhoodSchema,
  ExtractFromCaptureSchema,
  GetDecisionContextSchema,
  SearchEntitiesSchema,
  GetEntitySchema,
  ListEntitiesSchema,
  UpdateEntitySchema,
  VectorSearchSchema,
  UnifiedMemorySearchSchema,
  SaveConclusionSchema
} from './mcp-tools.js';

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
        instructions: `You are connected to Omni-Context, the user's long-term memory and decision support system.

Before answering any substantive question:
1. Call \`unified_memory_search\` with key terms from the user's question to check whether they've discussed this topic before.
2. If the user is choosing between options or making a decision, call \`get_decision_context\` with their situation as the \`situation\` argument.
3. Cite matched memories by name in your answer so the user can verify.
4. At the end of a substantive conversation that produced a conclusion, call \`save_conclusion\` to persist the key takeaway.

These tools are read-cheap; over-call rather than under-call.`,
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
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
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

          // 隐式 access tracking（仅 MCP 路径）
          const returnedIds = entities.map((e: any) => e.id).filter(Boolean);
          if (returnedIds.length > 0) {
            this.db.bumpAccessCounts(returnedIds).catch(() => {});
          }

          return this.formatResponse(entities.map(toCompactEntity));
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
          return this.formatResponse({ entity: toCompactEntity(entity), relationships });
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
          if (neighborhood && neighborhood.nodes) {
            neighborhood.nodes = neighborhood.nodes.map(toCompactEntity);
          }
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
          // 实体消解与重映射
          const resolution = await resolveEntities(result.entities, result.relationships, this.db, this.embeddingService);

          const savedEntities = [];
          const savedRelationships = [];

          for (const entity of resolution.entitiesToCreate) {
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

          for (const update of resolution.entitiesToUpdate) {
            await this.db.updateEntity(update.id, {
              description: update.description,
              tags: update.tags,
              embedding: update.embedding,
              metadata: update.metadata,
              created_at: update.created_at,
              access_count: update.access_count,
            });
            const current = await this.db.peekEntity(update.id);
            if (current) {
              savedEntities.push(current);
            }
            if (parsed.captureId) {
              await this.db.addRelationship({
                source_id: parsed.captureId,
                target_id: update.id,
                type: 'extracted_from',
                description: '从capture提取的实体',
                weight: 1.0,
              });
            }
          }

          // 自动冲突检测与消解
          try {
            await resolveConflicts(resolution.relationshipsToCreate, this.db, this.extractor);
          } catch (err) {
            console.error('[MCP extract_from_capture] Conflict resolution failed:', err);
          }

          for (const relationship of resolution.relationshipsToCreate) {
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

          // 原则实体走消解，避免重复 capture 产生重复原则
          const principleNow = new Date().toISOString();
          const principleEntities = result.principles.map((principle): Entity => ({
            id: uuidv4(),
            name: principle.title,
            type: 'principle',
            description: principle.content,
            created_at: principleNow,
            updated_at: principleNow,
            last_accessed: principleNow,
            access_count: 0,
            tags: ['auto_extracted'],
            metadata: {
              isCore: principle.isCore,
              version: principle.version || 1,
            },
          }));
          const principleResolution = await resolveEntities(principleEntities, [], this.db, this.embeddingService);
          for (const entity of principleResolution.entitiesToCreate) {
            const saved = await this.db.addEntity(entity);
            savedEntities.push(saved);
          }
          for (const update of principleResolution.entitiesToUpdate) {
            await this.db.updateEntity(update.id, {
              description: update.description,
              tags: update.tags,
              embedding: update.embedding,
              metadata: update.metadata,
              created_at: update.created_at,
              access_count: update.access_count,
            });
          }
          if (parsed.captureId) {
            for (const pe of principleEntities) {
              const resolvedId = principleResolution.idMap[pe.id] || pe.id;
              try {
                await this.db.addRelationship({
                  source_id: parsed.captureId,
                  target_id: resolvedId,
                  type: 'extracted_from',
                  description: '从capture提取的原则',
                  weight: 1.0,
                });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (!msg.includes('UNIQUE constraint')) {
                  console.error(`[extract_from_capture] 原则关系保存失败:`, msg);
                }
              }
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

          return this.formatResponse(entities.slice(0, limit).map(toCompactEntity));
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
            return this.formatResponse(results.map(toCompactEntity));
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

          let graphContext = results.graphContext;
          if (graphContext && graphContext.nodes) {
            graphContext.nodes = graphContext.nodes.map(toCompactEntity);
          }

          // 隐式 access tracking（仅 MCP 路径）
          const accIds = [
            ...unified.map((e: any) => e.id),
            ...(results.graphContext?.nodes || []).map((n: any) => n.id),
          ].filter(Boolean);
          if (accIds.length > 0) {
            this.db.bumpAccessCounts(accIds).catch(() => {});
          }

          return this.formatResponse({
            results: unified.slice(0, limit * 2).map(toCompactEntity),
            graphContext,
            searchMethods: {
              text: results.textResults.length,
              vector: results.vectorResults.length,
              graph: results.graphContext?.nodes?.length || 0,
            },
          });
        }

        case 'save_conclusion': {
          const parsed = SaveConclusionSchema.parse(args);
          const { summary, related_entity_ids, tags } = parsed;

          // 走 ingest pipeline：把 summary 当 textContent 喂给 extractor
          const input = {
            textContent: summary,
            timestamp: new Date().toISOString(),
          };
          const extractResult = await this.extractor.extract(input);

          // 实体消解
          const resolution = await resolveEntities(extractResult.entities, extractResult.relationships, this.db, this.embeddingService);

          const savedEntityIds: string[] = [];
          for (const entity of resolution.entitiesToCreate) {
            const saved = await this.db.addEntity(entity);
            savedEntityIds.push(saved.id);
          }

          for (const update of resolution.entitiesToUpdate) {
            await this.db.updateEntity(update.id, {
              description: update.description,
              tags: update.tags,
              embedding: update.embedding,
              metadata: update.metadata,
              created_at: update.created_at,
              access_count: update.access_count,
            });
            savedEntityIds.push(update.id);
          }

          for (const relationship of resolution.relationshipsToCreate) {
            try {
              await this.db.addRelationship(relationship);
            } catch {
              // 重复关系是预期的
            }
          }

          // 关联到 related_entity_ids（如果提供了）
          if (related_entity_ids && related_entity_ids.length > 0) {
            for (const savedId of savedEntityIds) {
              for (const relatedId of related_entity_ids) {
                if (savedId === relatedId) continue;
                try {
                  await this.db.addRelationship({
                    source_id: savedId,
                    target_id: relatedId,
                    type: 'relates_to',
                    description: 'save_conclusion 关联',
                    weight: 1.0,
                  });
                } catch {
                  // 重复关系忽略
                }
              }
            }
          }

          return this.formatResponse({
            savedEntities: savedEntityIds.length,
            summary: await this.extractor.summarizeEntities(extractResult.entities),
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

          const compactPrinciples = principles.map(toCompactEntity);
          const compactRelevantMemories = relevantMemories.map(toCompactEntity);
          const compactGraphContext = graphContext && graphContext.nodes ? {
            ...graphContext,
            nodes: graphContext.nodes.map(toCompactEntity)
          } : graphContext;

          // 隐式 access tracking（仅 MCP 路径）
          const decIds = [
            ...relevantMemories.map((m: any) => m.id),
            ...principles.map((p: any) => p.id),
            ...(graphContext?.nodes || []).map((n: any) => n.id),
          ].filter(Boolean);
          if (decIds.length > 0) {
            this.db.bumpAccessCounts(decIds).catch(() => {});
          }

          return this.formatResponse({
            situation,
            principles: compactPrinciples,
            relevantMemories: compactRelevantMemories,
            conflicts: conflictPairs,
            graphContext: compactGraphContext,
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
    this.agentLoop = new AgentLoop(this.db, this.decayScheduler);
    this.agentLoop.start(insightIntervalMs);

    const httpServer = createServer(this.db, this.agentLoop, this.embeddingService, this.decayScheduler);
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
