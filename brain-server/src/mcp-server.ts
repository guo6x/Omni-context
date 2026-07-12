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
import { createAuditedAiFetch } from './security/audited-ai-fetch.js';

const mcpLlmFetch = createAuditedAiFetch({ purpose: 'mcp.decision-intelligence', kind: 'llm' });

const CORE_PRINCIPLE_CAP = 3;

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
  GetCoreContextSchema,
  SearchEntitiesSchema,
  GetEntitySchema,
  ListEntitiesSchema,
  UpdateEntitySchema,
  VectorSearchSchema,
  UnifiedMemorySearchSchema,
  SaveConclusionSchema,
  SaveDecisionSchema,
  AnalyzeDecisionSchema,
  DiscussDecisionSchema,
  GetDecisionLineageSchema,
  RecordDecisionOutcomeSchema,
} from './mcp-tools.js';
import { buildDecisionMetadata, getRecursiveDecisionLineage, recordDecisionOutcome } from './decision/decision-store.js';
import {
  capGraphContext,
  rankMemoryCandidates,
  selectGeneralCorePrinciples,
  selectRelevantPrinciples,
} from './mcp-retrieval.js';

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
      localModel: process.env.EMBEDDING_LOCAL_MODEL || 'Xenova/multilingual-e5-small',
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
          const parsed = GetCoreContextSchema.parse(args);
          const corePrinciples = await this.db.getCorePrinciples();
          const selected = parsed.query
            ? selectRelevantPrinciples(parsed.query, corePrinciples, parsed.limit)
            : selectGeneralCorePrinciples(corePrinciples, parsed.limit);
          const context = {
            role: 'system',
            content: `[Omni-Context Core Principles]

${selected.map((p, i) => `${i + 1}. **${p.name}**
   ${p.description || ''}
`).join('\n')}

仅在与当前任务相关时遵循以上原则；不要把无关原则强行套用。`,
            totalCorePrinciples: corePrinciples.length,
            returnedPrinciples: selected.length,
            truncated: selected.length < corePrinciples.length,
          };
          return this.formatResponse(context);
        }

        case 'search_entities': {
          const parsed = SearchEntitiesSchema.parse(args);
          const entities = await this.db.searchEntities(
            parsed.query,
            parsed.limit,
            parsed.type as EntityType | undefined,
          );

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
            // provenance：记录此实体由外部 AI 经哪个 MCP 工具写入（与 HTTP 路径一致）
            metadata: { ...(parsed.metadata || {}), provenance: { source: 'external_ai', tool: 'add_entity', at: new Date().toISOString() } },
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

          try {
            savedRelationships.push(...await resolveConflicts(resolution.relationshipsToCreate, this.db, this.extractor));
          } catch (err) {
            console.error('[MCP extract_from_capture] Conflict resolution failed:', err);
            throw err;
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
            // provenance：save_conclusion 是外部 AI 把对话结论写回图谱（与 HTTP 路径一致）
            const saved = await this.db.addEntity({
              ...entity,
              tags: [...new Set([...(entity.tags || []), ...(tags || [])])],
              metadata: { ...((entity as any).metadata || {}), provenance: { source: 'external_ai', tool: 'save_conclusion', at: new Date().toISOString() } },
            });
            savedEntityIds.push(saved.id);
          }

          for (const update of resolution.entitiesToUpdate) {
            await this.db.updateEntity(update.id, {
              description: update.description,
              tags: [...new Set([...(update.tags || []), ...(tags || [])])],
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
          const candidates: any[] = [];
          for (const source of [textResults, vectorResults]) {
            for (const item of source) {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                candidates.push(item);
              }
            }
          }

          const relevantMemories = rankMemoryCandidates(
            situation,
            candidates,
            { decisionMode: true },
          ).slice(0, limit);

          const corePrinciples = selectRelevantPrinciples(
            situation,
            await this.db.getCorePrinciples(),
            CORE_PRINCIPLE_CAP,
          );
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
              graphContext = capGraphContext(
                await this.db.getGraphNeighborhood(seed.id, 2),
                Math.max(limit * 2, 8),
                Math.max(limit * 3, 12),
              );
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

        case 'analyze_decision': {
          const parsed = AnalyzeDecisionSchema.parse(args);
          const { situation } = parsed;

          const ctxData = await this._retrieveDecisionContext(situation, 5);

          // Step 1b: agentic — 让 LLM 自主检索补齐还缺的背景信息（与 HTTP 路径一致）
          try {
            const extra = await this._agenticEnrichMemories(situation, ctxData.relevantMemories);
            const known = new Set(ctxData.relevantMemories.map((m: any) => m.id));
            for (const e of extra) {
              if (!known.has(e.id)) { known.add(e.id); ctxData.relevantMemories.push(e); }
            }
          } catch {
            // additive enrichment; ignore failures
          }

          const rawCitations = [
            ...ctxData.principles.map((p: any) => ({ id: p.id, name: p.name, type: p.type, description: p.description })),
            ...ctxData.relevantMemories
              .filter((m: any) => m.type !== 'principle')
              .map((m: any) => ({ id: m.id, name: m.name, type: m.type, description: m.description })),
          ];

          let analysisJson: any;
          try {
            const promptText = this._buildAnalysisPrompt(situation, ctxData);
            const llmResponse = await this._callLlmDecision(
              '你是一个决策分析助手。你基于用户的知识图谱数据，帮助分析决策情境。只输出有效的 JSON。使用中文回复。',
              promptText,
            );
            analysisJson = JSON.parse(llmResponse);
          } catch (e: any) {
            if (e.message === 'LLM_NOT_CONFIGURED') {
              throw new McpError(ErrorCode.InvalidRequest, 'LLM_NOT_CONFIGURED: LLM provider not configured');
            }
            console.error('[analyze_decision] LLM analysis failed:', e);
            analysisJson = { summary: '', pros: [], cons: [], recommendation: '' };
          }

          return this.formatResponse({
            summary: analysisJson.summary || '',
            pros: analysisJson.pros || [],
            cons: analysisJson.cons || [],
            recommendation: analysisJson.recommendation || '',
            questions: Array.isArray(analysisJson.questions) ? analysisJson.questions.slice(0, 3) : [],
            evidence: rawCitations.slice(0, 8).map((c: any) => ({
              entityId: c.id,
              entityName: c.name,
              entityType: c.type,
              relevance: 'relevant',
            })),
            rawCitations: rawCitations.slice(0, 8),
          });
        }

        case 'discuss_decision': {
          const parsed = DiscussDecisionSchema.parse(args);
          const { situation, messages } = parsed;

          const llmConfig = this.extractor.getLlmConfig();
          if (!llmConfig.apiUrl) {
            throw new McpError(ErrorCode.InvalidRequest, 'LLM_NOT_CONFIGURED');
          }

          const systemPrompt = `你是一个决策讨论助手。用户正在讨论一个决策："""${situation}"""
你在帮助用户深入思考、质疑假设、补充视角。回复要简洁、直接、有帮助。使用中文。`;

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);

            const response = await mcpLlmFetch(`${llmConfig.apiUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: llmConfig.model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...messages,
                ],
                max_tokens: 512,
                temperature: 0.6,
              }),
              signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!response.ok) {
              throw new Error(`LLM API error: ${response.status}`);
            }

            const data = await response.json() as {
              choices: Array<{ message: { content: string } }>;
            };

            return this.formatResponse({ reply: data.choices?.[0]?.message?.content || '(no response)' });
          } catch (e: any) {
            console.error('[discuss_decision] Failed:', e);
            return this.formatResponse({ reply: '抱歉，讨论服务暂时不可用。' });
          }
        }

        case 'get_decay_report': {
          const report = this.decayScheduler.getLastReport();
          return this.formatResponse(report || { message: '尚未执行衰减周期' });
        }

        case 'save_decision': {
          const parsed = SaveDecisionSchema.parse(args);
          const { situation, conclusion, cited_entity_ids, confidence, previous_decision_id, supersedes_decision_id, lineage_relation } = parsed;

          const confidenceLabel = { high: '高', medium: '中', low: '低' }[confidence];
          const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.join('；') : parsed.alternatives;
          const fullDescription = `情境：${situation}\n\n决策：${conclusion}\n\n置信度：${confidenceLabel}${alternatives ? `\n\n替代方案：${alternatives}` : ''}`;
          const decisionName = conclusion.length > 60 ? conclusion.substring(0, 60) + '...' : conclusion;

          let embedding: number[] | undefined;
          try {
            const embResult = await this.embeddingService.embed(`${decisionName}: ${fullDescription}`);
            embedding = embResult.embedding;
          } catch { /* ignore */ }

          const decisionEntity = await this.db.addEntity({
            name: decisionName,
            type: 'decision',
            description: fullDescription,
            tags: ['decision', `confidence-${confidence}`],
            embedding,
            metadata: buildDecisionMetadata(parsed),
            valid_from: parsed.valid_from,
            valid_until: parsed.valid_until,
          });

          const evidenceLinks = [
            ...(cited_entity_ids || []).map((id) => ({ id, type: 'decision_referenced' as const })),
            ...parsed.supporting_evidence_ids.map((id) => ({ id, type: 'supported_by' as const })),
            ...parsed.opposing_evidence_ids.map((id) => ({ id, type: 'opposed_by' as const })),
            ...parsed.principle_ids.map((id) => ({ id, type: 'supported_by' as const })),
          ];
          for (const link of evidenceLinks) {
            try {
              await this.db.addRelationship({
                source_id: decisionEntity.id,
                target_id: link.id,
                type: link.type,
                description: `Decision evidence: ${link.type}`,
                weight: 1.0,
              });
            } catch { /* duplicate */ }
          }

          if (previous_decision_id && previous_decision_id !== decisionEntity.id) {
            try {
              await this.db.addRelationship({
                source_id: decisionEntity.id,
                target_id: previous_decision_id,
                type: lineage_relation,
                description: `Explicit decision lineage: ${lineage_relation}`,
                weight: 1,
              });
            } catch { /* duplicate */ }
          }
          if (supersedes_decision_id && supersedes_decision_id !== decisionEntity.id) {
            try {
              await this.db.addRelationship({
                source_id: decisionEntity.id,
                target_id: supersedes_decision_id,
                type: 'supersedes',
                description: 'Explicitly supersedes previous decision',
                weight: 1,
              });
            } catch { /* duplicate */ }
          }

          try {
            const candidates = (await this.db.searchEntities(situation, 3))
              .filter((entity) => entity.type === 'decision' && entity.id !== decisionEntity.id)
              .slice(0, 3)
              .map((entity) => ({ id: entity.id, name: entity.name, status: 'pending_confirmation' }));
            if (candidates.length > 0) {
              await this.db.updateEntity(decisionEntity.id, {
                metadata: { ...decisionEntity.metadata, pending_lineage_candidates: candidates },
              });
            }
          } catch (error) {
            console.warn('[save_decision] candidate lineage search failed:', error);
          }

          return this.formatResponse(await this.db.getEntity(decisionEntity.id));
        }

        case 'record_decision_outcome': {
          const parsed = RecordDecisionOutcomeSchema.parse(args);
          const outcome = await recordDecisionOutcome(this.db, parsed);
          if (!outcome) {
            throw new McpError(ErrorCode.InvalidParams, 'Decision not found');
          }
          return this.formatResponse(outcome);
        }

        case 'get_decision_lineage': {
          const parsed = GetDecisionLineageSchema.parse(args);
          const lineage = await getRecursiveDecisionLineage(this.db, parsed.decision_id);
          if (!lineage) {
            throw new McpError(ErrorCode.InvalidParams, 'Decision not found');
          }
          return this.formatResponse(lineage);
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
          description: '知识图谱摘要（最多 100 个实体和 150 条关系）',
          mimeType: 'application/json',
        },
        {
          uri: 'memory://core-principles',
          name: '核心原则',
          description: '核心原则摘要（最多 20 条）',
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
      const entities = await this.db.all<any>(
        `SELECT id, name, type, description, tags, created_at, access_count
         FROM entities
         WHERE json_extract(metadata, '$.merged_into') IS NULL
         ORDER BY access_count DESC, updated_at DESC
         LIMIT 100`,
      );
      const relationships = await this.db.all(
        `SELECT id, source_id, target_id, type, description, weight
         FROM relationships
         WHERE valid_until IS NULL OR valid_until > datetime('now')
         ORDER BY weight DESC
         LIMIT 150`,
      );
      return this.formatResource(uri, {
        entities: entities.map((entity) => toCompactEntity({
          ...entity,
          tags: entity.tags ? JSON.parse(entity.tags) : undefined,
        })),
        relationships,
        truncated: true,
        note: 'Use unified_memory_search or get_graph_neighborhood for topic-specific retrieval.',
      });
    }

    if (uri === 'memory://core-principles') {
      const all = await this.db.getCorePrinciples();
      const items = selectGeneralCorePrinciples(all, 20).map(toCompactEntity);
      return this.formatResource(uri, {
        items,
        total: all.length,
        returned: items.length,
        truncated: items.length < all.length,
      });
    }

    if (uri === 'memory://stats') {
      const stats = await this.db.getStats();
      return this.formatResource(uri, stats);
    }

    const entityTypeMatch = uri.match(/^memory:\/\/entities\/(.+)$/);
    if (entityTypeMatch) {
      const type = decodeURIComponent(entityTypeMatch[1]);
      const all = await this.db.getEntitiesByType(type);
      const items = rankMemoryCandidates(type, all).slice(0, 100).map(toCompactEntity);
      return this.formatResource(uri, {
        items,
        total: all.length,
        returned: items.length,
        truncated: items.length < all.length,
        note: 'Use search_entities or unified_memory_search for precise retrieval.',
      });
    }

    throw new McpError(ErrorCode.InvalidRequest, `未知资源: ${uri}`);
  }

  // ── 决策助手共享逻辑（与 HTTP handler api/handlers/mcp.ts 保持一致） ──

  private async _retrieveDecisionContext(
    situation: string,
    limit: number,
  ): Promise<{ principles: any[]; relevantMemories: any[]; conflicts: any[] }> {
    const textResults = await this.db.searchEntities(situation, limit);
    let vectorResults: any[] = [];
    try {
      const embResult = await this.embeddingService.embed(situation);
      vectorResults = await this.db.vectorSearch(embResult.embedding, limit);
    } catch {
      // embedding 失败不阻塞
    }

    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const source of [textResults, vectorResults]) {
      for (const item of source) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          candidates.push(item);
        }
      }
    }

    const relevantMemories = rankMemoryCandidates(
      situation,
      candidates,
      { decisionMode: true },
    ).slice(0, limit);

    const corePrinciples = selectRelevantPrinciples(
      situation,
      await this.db.getCorePrinciples(),
      CORE_PRINCIPLE_CAP,
    );
    const seenPrincipleIds = new Set(corePrinciples.map((p: any) => p.id));
    const searchPrinciples = relevantMemories.filter(
      (m) => m.type === 'principle' && !seenPrincipleIds.has(m.id)
    );
    const principles = [...corePrinciples, ...searchPrinciples];

    const relevantIds = new Set(relevantMemories.map((m: any) => m.id));
    const conflicts: any[] = [];
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
          conflicts.push({
            a: { id: entity.id, name: entity.name },
            b: { id: other.id, name: other.name },
            description: rel.description || '',
          });
        }
      }
    }

    const accIds = [
      ...relevantMemories.map((m: any) => m.id),
      ...principles.map((p: any) => p.id),
    ].filter(Boolean);
    if (accIds.length > 0) {
      this.db.bumpAccessCounts(accIds).catch(() => {});
    }

    return { principles, relevantMemories, conflicts };
  }

  private _buildAnalysisPrompt(
    situation: string,
    context: { principles: any[]; relevantMemories: any[]; conflicts: any[] },
  ): string {
    const principles = context.principles.map((p: any) => `- [${p.type}] ${p.name}: ${p.description || ''}`).join('\n');
    const history = context.relevantMemories
      .filter((m: any) => m.type !== 'principle')
      .slice(0, 8)
      .map((m: any) => `- [${m.type}] ${m.name}: ${m.description || ''}`)
      .join('\n');
    const conflicts = context.conflicts
      .map((c: any) => `- ${c.a.name} vs ${c.b.name}: ${c.description || ''}`)
      .join('\n');

    return `用户正在做以下决策：
"${situation}"

知识图谱中的相关信息：

【核心原则】
${principles || '(无)'}

【相关历史记忆】
${history || '(无)'}

【潜在冲突】
${conflicts || '(无)'}

请基于以上知识图谱数据，进行结构化分析。严格按以下 JSON 格式输出（不要添加任何其他文字）：

{
  "summary": "对决策情境的简要分析（2-3句话）",
  "pros": ["有利因素1", "有利因素2", ...],
  "cons": ["风险/不利因素1", "风险/不利因素2", ...],
  "recommendation": "基于证据的建议方向（不要替用户做决定，而是给出有依据的方向）",
  "questions": ["当上述信息不足以给出可靠判断时，列出你需要用户补充的关键问题，最多3条；信息已充分则返回空数组 []"]
}`;
  }

  private async _callLlmDecision(systemPrompt: string, userPrompt: string): Promise<string> {
    const llmConfig = this.extractor.getLlmConfig();
    if (!llmConfig.apiUrl) {
      throw new Error('LLM_NOT_CONFIGURED');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await mcpLlmFetch(`${llmConfig.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: llmConfig.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1024,
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty LLM response');

      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      return jsonMatch ? jsonMatch[1].trim() : content.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  // agentic：给 LLM 一个 search_memory 工具，让它多轮自主检索补齐情境缺失的信息。
  // 与 api/handlers/mcp.ts 的 agenticEnrichMemories 保持一致（stdio 路径镜像）。
  private async _agenticEnrichMemories(
    situation: string,
    baseMemories: any[],
    maxIter = 3,
  ): Promise<any[]> {
    const llmConfig = this.extractor.getLlmConfig();
    if (!llmConfig.apiUrl) return [];

    const runSearch = async (query: string, limit = 5): Promise<any[]> => {
      const text = await this.db.searchEntities(query, limit);
      let vec: any[] = [];
      try {
        const emb = await this.embeddingService.embed(query);
        vec = await this.db.vectorSearch(emb.embedding, limit);
      } catch {
        // vector optional
      }
      const out: any[] = [];
      const seen = new Set<string>();
      for (const src of [text, vec]) {
        for (const it of src) {
          if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
        }
      }
      return out.map(toCompactEntity);
    };

    const tools = [{
      type: 'function',
      function: {
        name: 'search_memory',
        description: '在用户的知识图谱中检索与查询相关的实体（融合关键词 + 语义搜索）。当你缺少判断所需的背景信息时调用。',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '聚焦的检索查询词' } },
          required: ['query'],
        },
      },
    }];

    const baseSummary = baseMemories.slice(0, 8).map((m: any) => `- ${m.name}`).join('\n') || '(无)';
    const messages: any[] = [
      { role: 'system', content: '你在为一个决策收集背景信息。可调用 search_memory 在用户知识图谱里检索你还缺的信息（最多几次，用聚焦的查询词）。信息足够后直接回复 DONE，不要做分析。' },
      { role: 'user', content: `决策情境：${situation}\n\n已检索到的相关记忆：\n${baseSummary}\n\n还需要补充信息就调用 search_memory；否则回复 DONE。` },
    ];

    const found: any[] = [];
    const foundIds = new Set<string>(baseMemories.map((m: any) => m.id));

    try {
      for (let i = 0; i < maxIter; i++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let data: any;
        try {
          const resp = await mcpLlmFetch(`${llmConfig.apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
            },
            body: JSON.stringify({
              model: llmConfig.model,
              messages,
              tools,
              tool_choice: 'auto',
              temperature: 0.3,
              max_tokens: 512,
            }),
            signal: controller.signal,
          });
          if (!resp.ok) break;
          data = await resp.json();
        } finally {
          clearTimeout(timeout);
        }

        const msg = data?.choices?.[0]?.message;
        const toolCalls = msg?.tool_calls;
        if (!msg || !Array.isArray(toolCalls) || toolCalls.length === 0) break; // LLM 收手

        messages.push(msg);
        for (const tc of toolCalls) {
          let query = '';
          try { query = JSON.parse(tc.function?.arguments || '{}').query || ''; } catch { /* bad args */ }
          const results = query ? await runSearch(query) : [];
          for (const r of results) {
            if (!foundIds.has(r.id)) { foundIds.add(r.id); found.push(r); }
          }
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(results.map((r: any) => ({ id: r.id, name: r.name, type: r.type, description: r.description }))),
          });
        }
      }
    } catch (e) {
      console.warn('[analyze_decision] agentic enrich skipped (model may not support tools):', e);
    }
    return found;
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
