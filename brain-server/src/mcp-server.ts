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
import { assertEvaluationEmbeddingReady, loadRetrievalConfig } from './retrieval/config.js';
import { parseTimeWindow } from './utils/time-window.js';
import { temporalOptsFromQuery, filterEntitiesByTemporal, filterAssertionsByTemporal } from './retrieval/temporal-layer.js';

const mcpLlmFetch = createAuditedAiFetch({ purpose: 'mcp.decision-intelligence', kind: 'llm' });

const CORE_PRINCIPLE_CAP = 3;
const RETRIEVAL_CONFIG = loadRetrievalConfig();

interface RetrievalCandidate {
  id: string;
  name: string;
  type: string;
  description: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  valid_from?: string;
  valid_until?: string;
}

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
  AnalyzeDecisionResultSchema,
  DiscussDecisionSchema,
  GetDecisionLineageSchema,
  RecordDecisionOutcomeSchema,
  AskMemorySchema,
  GraphAnswerSchema,
} from './mcp-tools.js';
import { buildDecisionMetadata, getRecursiveDecisionLineage, recordDecisionOutcome } from './decision/decision-store.js';
import {
  capGraphContext,
  collectGraphCandidates,
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
      localModel: process.env.EMBEDDING_LOCAL_MODEL || 'Xenova/multilingual-e5-large',
      localModelPath: process.env.EMBEDDING_LOCAL_MODEL_PATH,
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

          for (const a of result.assertions || []) {
            const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
            const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
            try {
              await this.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
            } catch (err) {
              console.warn('[MCP extract_from_capture] assertion write failed:', err);
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
            const embResult = await this.embeddingService.embedQuery(query);
            const results = await this.db.vectorSearch(embResult.embedding, args.limit as number || 10);
            return this.formatResponse(results.map(toCompactEntity));
          } catch (e) {
            console.warn('[vector_search] 失败:', e);
            return this.formatResponse({ results: [], error: '向量搜索失败' });
          }
        }

        case 'unified_memory_search': {
          const parsed = UnifiedMemorySearchSchema.parse(args);
          const limit = parsed.limit || 5;
          const retrieval = await this._retrieveMemoryCandidates(
            parsed.query,
            limit * 2,
            false,
            parsed.includeRelationships !== false,
            parsed.include_invalidated === true,
          );

          // 隐式 access tracking（仅 MCP 路径）
          const accIds = [
            ...retrieval.ranked.map((entity) => entity.id),
            ...retrieval.graphContext.nodes.map((node) => node.id),
          ].filter(Boolean);
          if (accIds.length > 0) {
            this.db.bumpAccessCounts(accIds).catch(() => {});
          }

    return this.formatResponse({
      results: retrieval.ranked.map(toCompactEntity),
      graphContext: { ...retrieval.graphContext, nodes: retrieval.graphContext.nodes.map(toCompactEntity) },
      assertions: retrieval.assertions || [],
      searchMethods: retrieval.counts,
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
            relationship.provenance = { ...(relationship.provenance || {}), source: 'mcp:save_conclusion' };
          }
          try {
            await resolveConflicts(resolution.relationshipsToCreate, this.db, this.extractor);
          } catch (err) {
            console.error('[MCP save_conclusion] Conflict resolution failed:', err);
          }

          for (const a of extractResult.assertions || []) {
            const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
            const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
            try {
              await this.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
            } catch (err) {
              console.warn('[MCP save_conclusion] assertion write failed:', err);
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
          const retrieval = await this._retrieveMemoryCandidates(situation, limit, true, true);

          // 层1：文本搜索
          const textResults = retrieval.ranked;

          // 层2：向量搜索
          const vectorResults: any[] = [];

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

          // Multi-seed graph nodes were fused into the candidate pool before ranking.
          const graphContext = retrieval.graphContext;

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

          // Valid evidence ID set: every claim's evidence_ids must reference one of these.
          const validEvidenceIds = new Set(rawCitations.map((c: any) => c.id));

          // Step 2: call LLM
          let llmResponse: string;
          try {
            const promptText = this._buildAnalysisPrompt(situation, ctxData);
            llmResponse = await this._callLlmDecision(
              '你是一个决策分析助手。你基于用户的知识图谱数据，帮助分析决策情境。只输出有效的 JSON。使用中文回复。',
              promptText,
            );
          } catch (e: any) {
            if (e.message === 'LLM_NOT_CONFIGURED') {
              throw new McpError(ErrorCode.InvalidRequest, 'LLM_NOT_CONFIGURED: LLM provider not configured');
            }
            console.error('[analyze_decision] LLM analysis failed:', e);
            throw new McpError(ErrorCode.InternalError, `LLM_ANALYSIS_FAILED: ${e?.message || 'LLM call failed'}`);
          }

          // Step 3: parse JSON — no fallback to plain string on failure
          let rawJson: unknown;
          try {
            rawJson = JSON.parse(llmResponse);
          } catch (e: any) {
            console.error('[analyze_decision] LLM output JSON parse failed:', e);
            throw new McpError(ErrorCode.InternalError, `LLM_OUTPUT_INVALID_JSON: ${e?.message || 'JSON parse failed'}`);
          }

          // Step 4: validate against Zod schema — schema failure returns error, no string fallback
          const parseResult = AnalyzeDecisionResultSchema.safeParse(rawJson);
          if (!parseResult.success) {
            console.error('[analyze_decision] LLM output schema validation failed:', parseResult.error);
            throw new McpError(
              ErrorCode.InternalError,
              `LLM_OUTPUT_INVALID: schema validation failed — ${parseResult.error.message}`,
            );
          }
          const analysis = parseResult.data;

          // Step 5: validate evidence_ids — strip IDs not in the retrieved set;
          // if a claim cited non-existent IDs, downgrade its classification to 'unknown'.
          const sanitizeClaim = <C extends { evidence_ids?: string[]; classification?: string }>(claim: C): C => {
            const ids = claim.evidence_ids ?? [];
            const validIds = ids.filter((id) => validEvidenceIds.has(id));
            const hadInvalid = validIds.length < ids.length;
            return {
              ...claim,
              evidence_ids: validIds,
              classification: hadInvalid ? 'unknown' : (claim.classification ?? 'unknown'),
            } as C;
          };

          const summary = sanitizeClaim(analysis.summary);
          const pros = analysis.pros.map(sanitizeClaim);
          const cons = analysis.cons.map(sanitizeClaim);
          const risks = analysis.risks.map(sanitizeClaim);
          const recommendation = sanitizeClaim(analysis.recommendation);

          // Step 6: build evidence list with relevance derived from actual citations
          const citedIds = new Set<string>([
            ...(summary.evidence_ids ?? []),
            ...pros.flatMap((c) => c.evidence_ids ?? []),
            ...cons.flatMap((c) => c.evidence_ids ?? []),
            ...risks.flatMap((c) => c.evidence_ids ?? []),
            ...(recommendation.evidence_ids ?? []),
          ]);
          const evidence = rawCitations.slice(0, 8).map((c: any) => ({
            entityId: c.id,
            entityName: c.name,
            entityType: c.type,
            relevance: citedIds.has(c.id) ? 'cited' : 'relevant',
          }));

          return this.formatResponse({
            summary,
            pros,
            cons,
            risks,
            recommendation,
            questions: analysis.questions.slice(0, 3),
            evidence,
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

          // 检索相关记忆（含时间感知过滤：根据查询中的时间词剔除已失效事实）
          const latestUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
          const retrievalQuery = `${situation}\n${latestUserMessage?.content || ''}`.trim();
          const discussionRetrieval = await this._retrieveMemoryCandidates(retrievalQuery, 6, true, true);
          const discussionSources = discussionRetrieval.ranked
            .slice(0, 10)
            .map(toCompactEntity);
          const evidenceBlock = discussionSources.length
            ? discussionSources.map((source: any, index: number) => `[${index + 1}] (${source.type}) ${source.name}: ${source.description || ''}`).join('\n')
            : '（本轮没有检索到相关记忆）';

          const systemPrompt = `你是一个决策讨论助手。用户正在讨论一个决策："""${situation}"""
每一轮都必须根据下面重新检索的当前记忆回答，而不是只依赖历史对话。重要事实需用 [编号] 标明依据；证据不足时明确说不知道并提出要补充的信息。帮助用户深入思考、质疑假设、补充视角。回复简洁、直接，使用中文。

本轮证据：
${evidenceBlock}`;

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

            return this.formatResponse({
              reply: data.choices?.[0]?.message?.content || '(no response)',
              sources: discussionSources,
            });
          } catch (e: any) {
            console.error('[discuss_decision] Failed:', e);
            return this.formatResponse({ reply: '抱歉，讨论服务暂时不可用。', sources: discussionSources });
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

        case 'ask_memory': {
          // stdio 版「问大脑」：与 HTTP 路径同构，复用 _retrieveMemoryCandidates 做时间感知检索
          const parsed = AskMemorySchema.parse(args);
          const messages: Array<{ role: string; content: string }> = Array.isArray(parsed.messages)
            ? parsed.messages.filter((m): m is { role: string; content: string } => Boolean(m && typeof m.content === 'string'))
            : [];
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          const question = (lastUser?.content || parsed.query || '').trim();

          const llmConfig = this.extractor.getLlmConfig();
          if (!llmConfig.apiUrl) {
            throw new McpError(ErrorCode.InvalidRequest, 'LLM_NOT_CONFIGURED');
          }
          if (!question) {
            return this.formatResponse({ reply: '', sources: [] });
          }

          const retrieval = await this._retrieveMemoryCandidates(question, 6, true, true);
          const seenSrc = new Set<string>();
          const sources: any[] = [];
          for (const m of [...retrieval.ranked, ...retrieval.graphContext.nodes]) {
            if (m && m.id && !seenSrc.has(m.id)) {
              seenSrc.add(m.id);
              sources.push(toCompactEntity(m));
            }
          }
          const cappedSources = sources.slice(0, 12);

          const memoryItems = cappedSources
            .map((m: any, i: number) => ({ item: m, index: i + 1 }))
            .filter(({ item }) => item.type !== 'principle');
          const principleItems = cappedSources
            .map((m: any, i: number) => ({ item: m, index: i + 1 }))
            .filter(({ item }) => item.type === 'principle');
          const memoryBlock = memoryItems.length
            ? memoryItems
                .map(({ item, index }) => `[${index}] (${item.type}) ${item.name}: ${item.description || ''}`)
                .join('\n')
            : '（没有检索到相关记忆）';
          const principleBlock = principleItems.length
            ? principleItems
                .map(({ item, index }) => `[${index}] (${item.type}) ${item.name}: ${item.description || ''}`)
                .join('\n')
            : '（没有相关核心原则）';

          const systemPrompt = `你是用户的「第二大脑」。下面是从用户本地知识图谱中检索到的相关记忆和少量核心原则。
请主要依据「相关记忆」回答用户的问题，并在每个重要事实后用 [编号] 标明对应 Entity 证据。
「核心原则」只有在确实与本问题相关时才参考或引用；无关原则必须忽略，不能为了引用而引用。
如果这些记忆里没有答案，就如实说"我的记忆里暂时没有这部分"，可顺带建议用户该捕获什么，不要编造。
回答简洁、口语化，使用用户提问所用的语言。

相关记忆：
${memoryBlock}

核心原则（仅在确与本问题相关时参考/引用，否则忽略）：
${principleBlock}`;

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            const llmRes = await mcpLlmFetch(`${llmConfig.apiUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: llmConfig.model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...(messages.length ? messages.slice(-8) : [{ role: 'user', content: question }]),
                ],
                max_tokens: 768,
                temperature: 0.5,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!llmRes.ok) throw new Error(`LLM API error: ${llmRes.status}`);
            const data = (await llmRes.json()) as { choices: Array<{ message: { content: string } }> };
            return this.formatResponse({
              reply: data.choices?.[0]?.message?.content || '(no response)',
              sources: cappedSources,
              assertions: retrieval.assertions || [],
            });
          } catch (e) {
            console.error('[ask_memory] Failed:', e);
            return this.formatResponse({
              reply: '抱歉，问答服务暂时不可用。',
              sources: cappedSources,
              assertions: retrieval.assertions || [],
            });
          }
        }

        case 'graph_answer': {
          // stdio 版图谱原生回答：结构化输出 + 命中子图边 + 时间感知
          const parsed = GraphAnswerSchema.parse(args);
          const gaMessages: Array<{ role: string; content: string }> = Array.isArray(parsed.messages)
            ? parsed.messages.filter((m): m is { role: string; content: string } => Boolean(m && typeof m.content === 'string'))
            : [];
          const gaLastUser = [...gaMessages].reverse().find((m) => m.role === 'user');
          const gaQuestion = (gaLastUser?.content || parsed.query || '').trim();

          const gaLlm = this.extractor.getLlmConfig();
          if (!gaLlm.apiUrl) {
            throw new McpError(ErrorCode.InvalidRequest, 'LLM_NOT_CONFIGURED');
          }
          if (!gaQuestion) {
            return this.formatResponse({
              conclusion: '', reasons: [], sources: [], edges: [], citedEntityIds: [],
            });
          }

          const gaRetrieval = await this._retrieveMemoryCandidates(gaQuestion, 6, true, true);
          const gaSeen = new Set<string>();
          const gaSources: any[] = [];
          for (const m of [...gaRetrieval.ranked, ...gaRetrieval.graphContext.nodes]) {
            if (m && m.id && !gaSeen.has(m.id)) {
              gaSeen.add(m.id);
              gaSources.push(toCompactEntity(m));
            }
          }
          const gaCapped = gaSources.slice(0, 10);
          const gaIds = new Set(gaCapped.map((s) => s.id));

          // 时间感知：根据问题中的时间词决定是否剔除已失效关系
          const gaTemporalOpts = temporalOptsFromQuery(gaQuestion);
          const gaNowIso = new Date().toISOString();

          // 命中节点之间的关系（构成高亮子图的边）
          const gaEdges: Array<{ source: string; target: string; type: string }> = [];
          const gaSeenEdge = new Set<string>();
          for (const s of gaCapped) {
            const rels = await this.db.getRelationshipsForEntity(s.id);
            for (const r of rels) {
              if (gaIds.has(r.source_id) && gaIds.has(r.target_id)) {
                if (!gaTemporalOpts.includeHistorical) {
                  const ru = (r as any).valid_until;
                  if (ru && ru <= gaNowIso) continue;
                }
                const k = `${r.source_id}|${r.target_id}|${r.type}`;
                if (!gaSeenEdge.has(k)) {
                  gaSeenEdge.add(k);
                  gaEdges.push({ source: r.source_id, target: r.target_id, type: r.type });
                }
              }
            }
          }

          const gaMemoryItems = gaCapped
            .map((m: any, i: number) => ({ item: m, index: i + 1 }))
            .filter(({ item }) => item.type !== 'principle');
          const gaCtxBlock = gaMemoryItems.length
            ? gaMemoryItems
                .map(({ item, index }) => `[${index}] (${item.type}) ${item.name}: ${item.description || ''}`)
                .join('\n')
            : '（没有检索到相关记忆）';
          const gaConnBlock = gaEdges.length
            ? gaEdges
                .map((e) => {
                  const sn = gaCapped.find((x) => x.id === e.source)?.name || '?';
                  const tn = gaCapped.find((x) => x.id === e.target)?.name || '?';
                  return `- ${sn} --[${e.type}]--> ${tn}`;
                })
                .join('\n')
            : '（无已知关系）';

          const gaSystem = `你是用户的「第二大脑」。基于下面从用户本地知识图谱检索到的记忆以及它们之间的关系来回答。
要求：
1. 先给一句话结论(conclusion)，直接、口语化；
2. 给 2-4 条依据(reasons)，每条尽量用 refs 数组引用上面记忆的编号；
3. 善用关系信息(冲突/取代/支持/源于)让推理有据，比如"X 和 Y 冲突过"；
4. 若现有记忆不足以给出有深度的回答（尤其抉择类）：不要硬凑一个浅答案。conclusion 里如实说"要答好这个我得先了解一些情况"，并在 questions 里列出 3-6 个具体、全面的澄清问题；
5. 判断用户是不是在做一个抉择(该不该/选哪个/要不要/选型)，是则 is_decision=true。
只输出 JSON：{"conclusion":"...","reasons":[{"text":"...","refs":[1,2]}],"questions":["..."],"is_decision":false}
使用用户提问所用的语言。

相关记忆：
${gaCtxBlock}

它们之间的关系：
${gaConnBlock}`;

          try {
            const gaController = new AbortController();
            const gaTimeout = setTimeout(() => gaController.abort(), 60000);
            let raw = '';
            try {
              const llmRes = await mcpLlmFetch(`${gaLlm.apiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(gaLlm.apiKey ? { Authorization: `Bearer ${gaLlm.apiKey}` } : {}),
                },
                body: JSON.stringify({
                  model: gaLlm.model,
                  messages: [
                    { role: 'system', content: gaSystem },
                    ...(gaMessages.length ? gaMessages.slice(-8) : [{ role: 'user', content: gaQuestion }]),
                  ],
                  max_tokens: 1200,
                  temperature: 0.4,
                  response_format: { type: 'json_object' },
                }),
                signal: gaController.signal,
              });
              if (!llmRes.ok) throw new Error(`LLM API error: ${llmRes.status}`);
              const d = (await llmRes.json()) as { choices: Array<{ message: { content: string } }> };
              raw = d.choices?.[0]?.message?.content || '';
            } finally {
              clearTimeout(gaTimeout);
            }
            const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            const parsedGa = JSON.parse(jsonMatch ? jsonMatch[1].trim() : raw.trim());
            const reasons = Array.isArray(parsedGa.reasons) ? parsedGa.reasons.slice(0, 5) : [];
            return this.formatResponse({
              conclusion: typeof parsedGa.conclusion === 'string' ? parsedGa.conclusion : '',
              reasons: reasons
                .map((r: any) => ({
                  text: String(r?.text || ''),
                  entityIds: Array.isArray(r?.refs)
                    ? r.refs.map((n: any) => gaCapped[Number(n) - 1]?.id).filter(Boolean)
                    : [],
                }))
                .filter((r: any) => r.text),
              questions: Array.isArray(parsedGa.questions)
                ? parsedGa.questions.slice(0, 6).filter((q: any) => typeof q === 'string' && q.trim())
                : [],
              isDecision: !!parsedGa.is_decision,
              sources: gaCapped,
              edges: gaEdges,
              citedEntityIds: gaCapped.map((s) => s.id),
              assertions: gaRetrieval.assertions || [],
            });
          } catch (e) {
            console.error('[graph_answer] Failed:', e);
            return this.formatResponse({
              conclusion: '抱歉，回答服务暂时不可用。',
              reasons: [],
              sources: gaCapped,
              edges: gaEdges,
              citedEntityIds: gaCapped.map((s) => s.id),
              assertions: gaRetrieval.assertions || [],
            });
          }
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

  private async _retrieveMemoryCandidates(
    query: string,
    limit: number,
    decisionMode: boolean,
    includeGraph: boolean,
    includeHistorical = false,
  ): Promise<{
    ranked: RetrievalCandidate[];
    graphContext: { nodes: Entity[]; edges: any[] };
    assertions: RetrievalCandidate[];
    counts: { text: number; vector: number; temporal: number; graph: number; assertion: number };
  }> {
    const pool = Math.max(
      limit * RETRIEVAL_CONFIG.candidatePoolMultiplier,
      RETRIEVAL_CONFIG.candidatePoolMinimum,
    );
    const textResults = await this.db.searchEntities(query, pool);
    let vectorResults: RetrievalCandidate[] = [];
    try {
      const embedded = await this.embeddingService.embedQuery(query);
      assertEvaluationEmbeddingReady(this.embeddingService.getStatus());
      vectorResults = await this.db.vectorSearch(embedded.embedding, pool);
    } catch (error) {
      if (process.env.OMNI_EVALUATION_MODE === '1') {
        throw new McpError(
          ErrorCode.InternalError,
          `EVALUATION_EMBEDDING_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      console.warn('[retrieval] semantic embedding unavailable; continuing outside evaluation mode');
    }

    const candidateMap = new Map<string, RetrievalCandidate>();
    for (const entity of [...textResults, ...vectorResults]) candidateMap.set(entity.id, entity);
    let temporalCount = 0;
    const window = parseTimeWindow(query);
    if (window) {
      const temporal = await this.db.getEntitiesByTimeWindow(window.start, window.end, pool);
      temporalCount = temporal.length;
     for (const entity of temporal) candidateMap.set(entity.id, entity);
    }

    // Include assertions as temporal fact candidates
    let assertionCount = 0;
    const assertionCandidates: RetrievalCandidate[] = [];
    try {
      const assertions = await this.db.getAssertions({
        includeHistorical,
        limit: pool,
      } as any);
      assertionCount = assertions.length;
      for (const a of assertions) {
        assertionCandidates.push({
          id: a.id,
          name: `${a.predicate}: ${a.literal_value || a.object_id || ''}`,
          type: 'assertion',
          description: a.literal_value
            ? `${a.predicate} = ${a.literal_value}`
            : `${a.predicate} -> ${a.object_id}`,
          similarity: a.confidence || 0.5,
          metadata: {
            subject_id: a.subject_id,
            predicate: a.predicate,
            object_id: a.object_id,
            literal_value: a.literal_value,
            confidence: a.confidence,
            source_span: a.source_span,
            valid_from: a.valid_from,
            valid_until: a.valid_until,
            is_historical: !!(a.valid_until && new Date(a.valid_until) < new Date()),
          },
          valid_from: a.valid_from,
          valid_until: a.valid_until,
        });
      }
    } catch (e) {
      console.warn('[retrieval] assertion fetch failed:', e);
    }

    const graphNodes = new Map<string, Entity>();
    const graphEdges = new Map<string, any>();
    if (includeGraph) {
      const seeds = rankMemoryCandidates(query, [...candidateMap.values()], {
        decisionMode,
        config: RETRIEVAL_CONFIG,
      }).slice(0, RETRIEVAL_CONFIG.graphSeedCount);
      const graph = await collectGraphCandidates(this.db, seeds, RETRIEVAL_CONFIG, includeHistorical);
      for (const node of graph.nodes) {
        graphNodes.set(node.id, node);
        candidateMap.set(node.id, node);
      }
      for (const edge of graph.edges) graphEdges.set(edge.id, edge);
    }

    // 时间感知过滤：根据查询中的时间词（"现在"/"当时"/"去年"等），
    // 剔除已失效事实或按具体日期过滤，确保 reranker 只看到时间上有效的候选。
    const temporalOpts = temporalOptsFromQuery(query);
    const temporallyFiltered = filterEntitiesByTemporal([...candidateMap.values()], temporalOpts);
    const temporallyFilteredAssertions = filterAssertionsByTemporal(assertionCandidates, temporalOpts);

    const ranked = rankMemoryCandidates(query, temporallyFiltered, {
      decisionMode,
      historicalMode: includeHistorical,
      config: RETRIEVAL_CONFIG,
    }).slice(0, limit);
    return {
      ranked,
      graphContext: capGraphContext(
        { nodes: [...graphNodes.values()], edges: [...graphEdges.values()] },
        Math.max(limit * RETRIEVAL_CONFIG.graphNodeLimitMultiplier, 8),
        Math.max(limit * RETRIEVAL_CONFIG.graphEdgeLimitMultiplier, 12),
      ),
      counts: {
        text: textResults.length,
        vector: vectorResults.length,
        temporal: temporalCount,
        graph: graphNodes.size,
        assertion: temporallyFilteredAssertions.length,
      },
      assertions: temporallyFilteredAssertions.slice(0, limit),
    };
  }

  private async _retrieveDecisionContext(
    situation: string,
    limit: number,
  ): Promise<{ principles: any[]; relevantMemories: any[]; conflicts: any[] }> {
    const retrieval = await this._retrieveMemoryCandidates(situation, limit, true, true);
    const textResults = retrieval.ranked;
    const vectorResults: any[] = [];

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
    const principles = context.principles.map((p: any) => `- [${p.id}] [${p.type}] ${p.name}: ${p.description || ''}`).join('\n');
    const history = context.relevantMemories
      .filter((m: any) => m.type !== 'principle')
      .slice(0, 8)
      .map((m: any) => `- [${m.id}] [${m.type}] ${m.name}: ${m.description || ''}`)
      .join('\n');
    const conflicts = context.conflicts
      .map((c: any) => `- ${c.a.name} (id=${c.a.id}) vs ${c.b.name} (id=${c.b.id}): ${c.description || ''}`)
      .join('\n');

    // 可用证据 ID 清单：LLM 只能引用这些 id，不得编造
    const evidenceRoster = [
      ...context.principles.map((p: any) => `${p.id} | ${p.name} | ${p.type}`),
      ...context.relevantMemories
        .filter((m: any) => m.type !== 'principle')
        .map((m: any) => `${m.id} | ${m.name} | ${m.type}`),
    ].join('\n');

    return `用户正在做以下决策：
"${situation}"

知识图谱中的相关信息：

【核心原则】
${principles || '(无)'}

【相关历史记忆】
${history || '(无)'}

【潜在冲突】
${conflicts || '(无)'}

【可用证据 ID 清单】（evidence_ids 只能引用以下 id，不得编造；无对应证据时使用空数组 []）
${evidenceRoster || '(无)'}

请基于以上知识图谱数据，进行结构化分析。严格按以下 JSON 格式输出（不要添加任何其他文字、不要包裹在 markdown 代码块中）：

{
  "summary": {
    "text": "对决策情境的简要分析（2-3句话）",
    "evidence_ids": ["引用的证据 id，必须来自上方清单；无则空数组"],
    "classification": "fact",
    "confidence": 0.8
  },
  "pros": [
    {
      "text": "有利因素（带具体依据）",
      "evidence_ids": ["对应证据 id"],
      "classification": "fact",
      "confidence": 0.8
    }
  ],
  "cons": [
    {
      "text": "风险/不利因素（带具体依据）",
      "evidence_ids": ["对应证据 id"],
      "classification": "fact",
      "confidence": 0.8
    }
  ],
  "risks": [
    {
      "text": "潜在风险（推理或事实）",
      "evidence_ids": ["对应证据 id"],
      "classification": "inference",
      "confidence": 0.5
    }
  ],
  "recommendation": {
    "text": "基于证据的建议方向（不要替用户做决定，而是给出有依据的方向）",
    "evidence_ids": ["对应证据 id"],
    "classification": "inference",
    "confidence": 0.6
  },
  "questions": ["当上述信息不足以给出可靠判断时，列出你需要用户补充的关键问题，最多3条；信息已充分则返回空数组 []"]
}

字段说明：
- evidence_ids：必须只引用上方"可用证据 ID 清单"中的 id，不得编造。无对应证据时使用空数组 []。
- classification：fact=直接来自知识图谱的事实；inference=基于证据的推理；unknown=无明确依据。recommendation 只允许 inference 或 unknown。
- confidence：0.0-1.0 之间的置信度。
- pros/cons/risks 可为空数组 []，但字段必须存在。`;
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
        const emb = await this.embeddingService.embedQuery(query);
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
    await this.agentLoop?.stop();
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
