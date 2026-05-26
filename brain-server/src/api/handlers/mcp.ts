import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { resolveEntities } from '../../graphrag/entity-resolver.js';
import { resolveConflicts } from '../../graphrag/conflict-resolver.js';
import { v4 as uuidv4 } from 'uuid';
import type { EntityType, RelationshipType, Entity } from '../../shared-types.js';
import {
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
  SaveConclusionSchema,
  SaveDecisionSchema
} from '../../mcp-tools.js';

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

export const handleMcpRoutes = [
  {
    method: 'POST' as const,
    path: '/api/mcp/tool/:name',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const toolName = params.name;
      const body = await parseBody<{ arguments: any }>(req);
      const args = body.arguments || {};

      try {
        let result: any;
        switch (toolName) {
          case 'record_capture': {
            const parsed = RecordCaptureSchema.parse(args);
            const capture = await ctx.db.addEntity({
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
            result = { captureId: capture.id, success: true };
            break;
          }
          case 'get_core_context': {
            const corePrinciples = await ctx.db.getCorePrinciples();
            result = {
              role: 'system',
              content: `[Omni-Context Core Principles]

${corePrinciples.map((p, i) => `${i + 1}. **${p.name}**
   ${p.description || ''}
   Metadata: ${JSON.stringify(p.metadata, null, 2)}
`).join('\n')}

请务必遵循以上核心原则进行工作。`,
            };
            break;
          }
          case 'search_entities': {
            const parsed = SearchEntitiesSchema.parse(args);
            const query = parsed.query;
            const type = parsed.type;
            const limit = parsed.limit || 10;

            let entities;
            if (type) {
              entities = await ctx.db.getEntitiesByType(type);
              entities = entities.filter((e) =>
                e.name.toLowerCase().includes(query.toLowerCase()) ||
                e.description?.toLowerCase().includes(query.toLowerCase())
              ).slice(0, limit);
            } else {
              entities = await ctx.db.searchEntities(query, limit);
            }

            // 隐式 access tracking（仅 MCP 路径）
            const returnedIds = entities.map((e: any) => e.id).filter(Boolean);
            if (returnedIds.length > 0) {
              ctx.db.bumpAccessCounts(returnedIds).catch(() => {});
            }

            result = entities.map(toCompactEntity);
            break;
          }
          case 'add_entity': {
            const parsed = AddEntitySchema.parse(args);
            let embedding: number[] | undefined;
            try {
              const embeddingText = `${parsed.name}: ${parsed.description || ''}`;
              const embedResult = await ctx.embeddingService.embed(embeddingText);
              embedding = embedResult.embedding;
            } catch (e) {
              console.warn('[add_entity] Embedding 生成失败，实体将不包含向量:', e);
            }
            const entity = await ctx.db.addEntity({
              name: parsed.name,
              type: parsed.type as EntityType,
              description: parsed.description,
              tags: parsed.tags,
              metadata: parsed.metadata,
              embedding,
            });
            result = entity;
            break;
          }
          case 'get_entity': {
            const parsed = GetEntitySchema.parse(args);
            const entity = await ctx.db.getEntity(parsed.id);
            if (!entity) {
              return sendError(res, 404, `实体未找到: ${parsed.id}`);
            }
            const relationships = await ctx.db.getRelationshipsForEntity(entity.id);
            result = { entity: toCompactEntity(entity), relationships };
            break;
          }
          case 'add_relationship': {
            const parsed = AddRelationshipSchema.parse(args);
            const source = await ctx.db.getEntity(parsed.sourceId);
            const target = await ctx.db.getEntity(parsed.targetId);
            if (!source) {
              return sendError(res, 404, `源实体未找到: ${parsed.sourceId}`);
            }
            if (!target) {
              return sendError(res, 404, `目标实体未找到: ${parsed.targetId}`);
            }
            const relationship = await ctx.db.addRelationship({
              source_id: parsed.sourceId,
              target_id: parsed.targetId,
              type: parsed.type as RelationshipType,
              description: parsed.description,
              weight: parsed.weight || 1.0,
            });
            result = relationship;
            break;
          }
          case 'get_graph_neighborhood': {
            const parsed = GetGraphNeighborhoodSchema.parse(args);
            const neighborhood = await ctx.db.getGraphNeighborhood(parsed.entityId, parsed.depth);
            if (neighborhood && neighborhood.nodes) {
              neighborhood.nodes = neighborhood.nodes.map(toCompactEntity);
            }
            result = neighborhood;
            break;
          }
          case 'extract_from_capture': {
            const parsed = ExtractFromCaptureSchema.parse(args);
            const input = {
              textContent: parsed.text,
              screenshot: parsed.screenshot,
              clipboard: parsed.clipboard,
              timestamp: new Date().toISOString(),
            };
            const extractResult = await ctx.extractor.extract(input);
            const resolution = await resolveEntities(extractResult.entities, extractResult.relationships, ctx.db, ctx.embeddingService);

            const savedEntities = [];
            const savedRelationships = [];

            for (const entity of resolution.entitiesToCreate) {
              const saved = await ctx.db.addEntity(entity);
              savedEntities.push(saved);
              if (parsed.captureId) {
                await ctx.db.addRelationship({
                  source_id: parsed.captureId,
                  target_id: saved.id,
                  type: 'extracted_from',
                  description: '从capture提取的实体',
                  weight: 1.0,
                });
              }
            }

            for (const update of resolution.entitiesToUpdate) {
              await ctx.db.updateEntity(update.id, {
                description: update.description,
                tags: update.tags,
                embedding: update.embedding,
                metadata: update.metadata,
                created_at: update.created_at,
                access_count: update.access_count,
              });
              const current = await ctx.db.peekEntity(update.id);
              if (current) {
                savedEntities.push(current);
              }
              if (parsed.captureId) {
                await ctx.db.addRelationship({
                  source_id: parsed.captureId,
                  target_id: update.id,
                  type: 'extracted_from',
                  description: '从capture提取的实体',
                  weight: 1.0,
                });
              }
            }

            try {
              await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor);
            } catch (err) {
              console.error('[MCP extract_from_capture] Conflict resolution failed:', err);
            }

            for (const relationship of resolution.relationshipsToCreate) {
              try {
                const saved = await ctx.db.addRelationship(relationship);
                savedRelationships.push(saved);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (!msg.includes('UNIQUE constraint')) {
                  console.error(`[extract_from_capture] 关系保存失败:`, msg);
                }
              }
            }

            const principleNow = new Date().toISOString();
            const principleEntities = extractResult.principles.map((principle): Entity => ({
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
            const principleResolution = await resolveEntities(principleEntities, [], ctx.db, ctx.embeddingService);
            for (const entity of principleResolution.entitiesToCreate) {
              const saved = await ctx.db.addEntity(entity);
              savedEntities.push(saved);
            }
            for (const update of principleResolution.entitiesToUpdate) {
              await ctx.db.updateEntity(update.id, {
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
                  await ctx.db.addRelationship({
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

            result = {
              entitiesAdded: savedEntities.length,
              relationshipsAdded: savedRelationships.length,
              summary: await ctx.extractor.summarizeEntities(extractResult.entities),
              ...(extractResult.suspicious && extractResult.suspicious.length > 0 ? { suspicious_patterns: extractResult.suspicious } : {}),
            };
            break;
          }
          case 'list_entities': {
            const parsed = ListEntitiesSchema.parse(args);
            const type = parsed.type;
            const limit = parsed.limit || 50;

            const entities = type
              ? await ctx.db.getEntitiesByType(type)
              : await ctx.db.getRecentEntities(limit);

            result = entities.slice(0, limit).map(toCompactEntity);
            break;
          }
          case 'update_entity': {
            const parsed = UpdateEntitySchema.parse(args);
            await ctx.db.updateEntity(parsed.id, {
              name: parsed.name,
              description: parsed.description,
              tags: parsed.tags,
              metadata: parsed.metadata,
            });
            result = await ctx.db.getEntity(parsed.id);
            break;
          }
          case 'get_stats': {
            result = await ctx.db.getStats();
            break;
          }
          case 'vector_search': {
            const parsed = VectorSearchSchema.parse(args);
            try {
              const embResult = await ctx.embeddingService.embed(parsed.query);
              const results = await ctx.db.vectorSearch(embResult.embedding, parsed.limit || 10);
              result = results.map(toCompactEntity);
            } catch (e) {
              console.warn('[vector_search] 失败:', e);
              result = { results: [], error: '向量搜索失败' };
            }
            break;
          }
          case 'unified_memory_search': {
            const parsed = UnifiedMemorySearchSchema.parse(args);
            const limit = parsed.limit || 5;
            const includeRels = parsed.includeRelationships !== false;
            const includeInvalidated = (parsed as any).include_invalidated === true;

            const resultsData: any = { textResults: [], vectorResults: [], graphContext: [] };
            resultsData.textResults = await ctx.db.searchEntities(parsed.query, limit);

            try {
              const embResult = await ctx.embeddingService.embed(parsed.query);
              resultsData.vectorResults = await ctx.db.vectorSearch(embResult.embedding, limit);
            } catch (e) {
              // ignore
            }

            if (includeRels) {
              const seedId = resultsData.textResults[0]?.id ?? resultsData.vectorResults[0]?.id;
              if (seedId) {
                resultsData.graphContext = await ctx.db.getGraphNeighborhood(seedId, 2, includeInvalidated);
              }
            }

            const seenIds = new Set<string>();
            const unified = [];
            for (const source of [resultsData.textResults, resultsData.vectorResults]) {
              for (const item of source) {
                if (!seenIds.has(item.id)) {
                  seenIds.add(item.id);
                  unified.push(item);
                }
              }
            }

            let graphContext = resultsData.graphContext;
            if (graphContext && graphContext.nodes) {
              graphContext.nodes = graphContext.nodes.map(toCompactEntity);
            }

            // 隐式 access tracking（仅 MCP 路径）
            const umsAccIds = [
              ...unified.map((e: any) => e.id),
              ...(resultsData.graphContext?.nodes || []).map((n: any) => n.id),
            ].filter(Boolean);
            if (umsAccIds.length > 0) {
              ctx.db.bumpAccessCounts(umsAccIds).catch(() => {});
            }

            result = {
              results: unified.slice(0, limit * 2).map(toCompactEntity),
              graphContext,
              searchMethods: {
                text: resultsData.textResults.length,
                vector: resultsData.vectorResults.length,
                graph: resultsData.graphContext?.nodes?.length || 0,
              },
            };
            break;
          }
          case 'get_decision_context': {
            const parsed = GetDecisionContextSchema.parse(args);
            const { situation, limit } = parsed;

            const textResults = await ctx.db.searchEntities(situation, limit);
            let vectorResults: any[] = [];
            try {
              const embResult = await ctx.embeddingService.embed(situation);
              vectorResults = await ctx.db.vectorSearch(embResult.embedding, limit);
            } catch {
              // ignore
            }

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

            const corePrinciples = await ctx.db.getCorePrinciples();
            const seenPrincipleIds = new Set(corePrinciples.map((p: any) => p.id));
            const searchPrinciples = relevantMemories.filter(
              (m) => m.type === 'principle' && !seenPrincipleIds.has(m.id)
            );
            const principles = [...corePrinciples, ...searchPrinciples];

            const relevantIds = new Set(relevantMemories.map((m: any) => m.id));
            const conflictPairs: any[] = [];
            const seenConflictKeys = new Set<string>();
            for (const entity of relevantMemories) {
              const rels = await ctx.db.getRelationshipsForEntity(entity.id);
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

            let graphContext: any = {};
            const seed = relevantMemories[0];
            if (seed) {
              try {
                graphContext = await ctx.db.getGraphNeighborhood(seed.id, 2);
              } catch {
                // ignore
              }
            }

            // 隐式 access tracking（仅 MCP 路径）
            const gdcAccIds = [
              ...relevantMemories.map((m: any) => m.id),
              ...principles.map((p: any) => p.id),
              ...(graphContext?.nodes || []).map((n: any) => n.id),
            ].filter(Boolean);
            if (gdcAccIds.length > 0) {
              ctx.db.bumpAccessCounts(gdcAccIds).catch(() => {});
            }

            result = {
              situation,
              principles: principles.map(toCompactEntity),
              relevantMemories: relevantMemories.map(toCompactEntity),
              conflicts: conflictPairs,
              graphContext: graphContext && graphContext.nodes ? {
                ...graphContext,
                nodes: graphContext.nodes.map(toCompactEntity)
              } : graphContext,
            };
            break;
          }
          case 'save_conclusion': {
            const parsed = SaveConclusionSchema.parse(args);
            const { summary, related_entity_ids, tags } = parsed;

            const input = {
              textContent: summary,
              timestamp: new Date().toISOString(),
            };
            const extractResult = await ctx.extractor.extract(input);
            const resolution = await resolveEntities(extractResult.entities, extractResult.relationships, ctx.db, ctx.embeddingService);

            const savedEntityIds: string[] = [];
            for (const entity of resolution.entitiesToCreate) {
              const saved = await ctx.db.addEntity(entity);
              savedEntityIds.push(saved.id);
            }

            for (const update of resolution.entitiesToUpdate) {
              await ctx.db.updateEntity(update.id, {
                description: update.description,
                tags: update.tags,
                embedding: update.embedding,
                metadata: update.metadata,
                created_at: update.created_at,
                access_count: update.access_count,
              });
              savedEntityIds.push(update.id);
            }

            try {
              await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor);
            } catch (err) {
              console.error('[MCP save_conclusion] Conflict resolution failed:', err);
            }

            for (const relationship of resolution.relationshipsToCreate) {
              try {
                await ctx.db.addRelationship(relationship);
              } catch {
                // 重复关系是预期的
              }
            }

            if (related_entity_ids && related_entity_ids.length > 0) {
              for (const savedId of savedEntityIds) {
                for (const relatedId of related_entity_ids) {
                  if (savedId === relatedId) continue;
                  try {
                    await ctx.db.addRelationship({
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

            result = {
              savedEntities: savedEntityIds.length,
              summary: await ctx.extractor.summarizeEntities(extractResult.entities),
              ...(extractResult.suspicious && extractResult.suspicious.length > 0 ? { suspicious_patterns: extractResult.suspicious } : {}),
            };
            break;
          }
          case 'save_decision': {
            const parsed = SaveDecisionSchema.parse(args);
            const { situation, conclusion, cited_entity_ids } = parsed;

            // Build full description: situation + decision
            const fullDescription = `情境：${situation}\n\n决策：${conclusion}`;
            const decisionName = conclusion.length > 60 ? conclusion.substring(0, 60) + '...' : conclusion;

            // Generate embedding for the decision entity
            let embedding: number[] | undefined;
            try {
              const embeddingText = `${decisionName}: ${fullDescription}`;
              const embResult = await ctx.embeddingService.embed(embeddingText);
              embedding = embResult.embedding;
            } catch {
              // ignore embedding failure
            }

            // Create the decision entity
            const decisionEntity = await ctx.db.addEntity({
              name: decisionName,
              type: 'decision',
              description: fullDescription,
              tags: ['decision'],
              embedding,
              metadata: {
                situation,
                conclusion,
                cited_entity_ids: cited_entity_ids || [],
              },
            });

            // Create decision_referenced relationships to cited entities
            if (cited_entity_ids && cited_entity_ids.length > 0) {
              for (const citedId of cited_entity_ids) {
                try {
                  await ctx.db.addRelationship({
                    source_id: decisionEntity.id,
                    target_id: citedId,
                    type: 'decision_referenced',
                    description: '决策引用了此实体',
                    weight: 1.0,
                  });
                } catch (e) {
                  // duplicate relationship is expected
                }
              }
            }

            // Write to archival memory
            try {
              await ctx.archivalMemory.add(fullDescription, {
                summary: `决策: ${conclusion}`,
                tags: ['decision', 'user-decision'],
                embedding,
                importance: 7,
              });
            } catch (e) {
              console.warn('[save_decision] 写入 archival memory 失败:', e);
            }

            result = decisionEntity;
            break;
          }
          case 'get_decay_report': {
            if (!ctx.decayScheduler) {
              result = { message: '尚未执行衰减周期' };
            } else {
              const report = ctx.decayScheduler.getLastReport();
              result = report || { message: '尚未执行衰减周期' };
            }
            break;
          }
          default:
            return sendError(res, 404, `未知工具: ${toolName}`);
        }

        sendResponse(res, 200, result);
      } catch (error) {
        console.error(`MCP tool execution error (${toolName}):`, error);
        sendError(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
  },
  {
    method: 'GET' as const,
    path: '/api/mcp/resources',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      try {
        const entityTypes = await ctx.db.all<{ type: string; count: number }>(
          'SELECT type, COUNT(*) as count FROM entities GROUP BY type'
        );

        const resources = [
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
        ];

        sendResponse(res, 200, { resources });
      } catch (error) {
        sendError(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
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

        let contents: any;

        if (uri === 'memory://graph') {
          const entities = await ctx.db.all('SELECT * FROM entities LIMIT 200');
          const relationships = await ctx.db.all('SELECT * FROM relationships LIMIT 200');
          contents = { entities, relationships };
        } else if (uri === 'memory://core-principles') {
          contents = await ctx.db.getCorePrinciples();
        } else if (uri === 'memory://stats') {
          contents = await ctx.db.getStats();
        } else {
          const entityTypeMatch = uri.match(/^memory:\/\/entities\/(.+)$/);
          if (entityTypeMatch) {
            const type = decodeURIComponent(entityTypeMatch[1]);
            contents = await ctx.db.getEntitiesByType(type);
          } else {
            return sendError(res, 404, `未知资源: ${uri}`);
          }
        }

        sendResponse(res, 200, {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(contents, null, 2),
            }
          ]
        });
      } catch (error) {
        sendError(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
  }
];
