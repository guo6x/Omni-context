import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { resolveEntities } from '../../graphrag/entity-resolver.js';
import { v4 as uuidv4 } from 'uuid';
import { Entity } from '../../shared-types.js';
import {
  EntityCreateSchema,
  EntityUpdateSchema,
  RelationshipCreateSchema,
} from '../../schema/domain.js';

export const handleMemoryRoutes = [
  {
    method: 'GET' as const,
    path: '/api/memory/core',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const items = await ctx.coreMemory.getAll();
      sendResponse(res, 200, items);
    }
  },
  // 注意: 静态路径 (stats / search / compress / category) 必须先于 ":key" 注册，
  // 否则 router 会按顺序匹配，导致这些固定路径被当作动态 key 走到 404。
  {
    method: 'GET' as const,
    path: '/api/memory/core/stats',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const stats = await ctx.coreMemory.getStats();
      sendResponse(res, 200, stats);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/memory/core/search',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ query: string; category?: string; limit?: number }>(req);
      const items = await ctx.coreMemory.search(body.query, {
        category: body.category,
        limit: body.limit,
      });
      sendResponse(res, 200, items);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/memory/core/compress',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ category?: string }>(req);
      const result = await ctx.coreMemory.compress(body.category);
      sendResponse(res, 200, result);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/memory/core/category/:category',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const items = await ctx.coreMemory.getByCategory(params.category);
      sendResponse(res, 200, items);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/memory/core/:key',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const item = await ctx.coreMemory.get(params.key);
      if (!item) {
        return sendError(res, 404, 'Memory item not found');
      }
      sendResponse(res, 200, item);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/memory/core',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ key: string; value: any; category?: string }>(req);
      if (!body.key) {
        return sendError(res, 400, 'Key is required');
      }
      await ctx.coreMemory.set(body.key, body.value, body.category);
      sendResponse(res, 201, { success: true, key: body.key });
    }
  },
  {
    method: 'DELETE' as const,
    path: '/api/memory/core/:key',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      await ctx.coreMemory.delete(params.key);
      sendResponse(res, 200, { success: true });
    }
  },
  {
    method: 'GET' as const,
    path: '/api/memory/archival',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const items = await ctx.archivalMemory.getAll({ limit: 100 });
      sendResponse(res, 200, items);
    }
  },
  // 静态路径 (summary / search / compress) 必须先于 ":id" 动态路径
  {
    method: 'GET' as const,
    path: '/api/memory/archival/summary',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const summary = await ctx.archivalMemory.summarize();
      sendResponse(res, 200, summary);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/memory/archival/search',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{
        query: string;
        tags?: string[];
        limit?: number;
      }>(req);
      const results = await ctx.archivalMemory.search(body.query, {
        tags: body.tags,
        limit: body.limit,
      });
      sendResponse(res, 200, results);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/memory/archival/compress',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const result = await ctx.archivalMemory.compress();
      sendResponse(res, 200, result);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/memory/archival/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const item = await ctx.archivalMemory.get(params.id);
      if (!item) {
        return sendError(res, 404, 'Archival item not found');
      }
      sendResponse(res, 200, item);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/memory/archival',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ 
        content: string; 
        summary?: string; 
        tags?: string[];
        importance?: number;
      }>(req);
      if (!body.content) {
        return sendError(res, 400, 'Content is required');
      }
      const item = await ctx.archivalMemory.add(body.content, {
        summary: body.summary,
        tags: body.tags,
        importance: body.importance,
      });
      sendResponse(res, 201, item);
    }
  },
  {
    method: 'PUT' as const,
    path: '/api/memory/archival/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const body = await parseBody<{ 
        content?: string; 
        summary?: string; 
        tags?: string[];
        importance?: number;
      }>(req);
      const item = await ctx.archivalMemory.update(params.id, body);
      if (!item) {
        return sendError(res, 404, 'Archival item not found');
      }
      sendResponse(res, 200, item);
    }
  },
  {
    method: 'DELETE' as const,
    path: '/api/memory/archival/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const deleted = await ctx.archivalMemory.delete(params.id);
      sendResponse(res, 200, { success: deleted });
    }
  },
];

export const handleEntityRoutes = [
  {
    method: 'GET' as const,
    path: '/api/review/tasks',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const targetCoreCount = Number(q.get('targetCoreCount')) || 30;
      sendResponse(res, 200, await ctx.db.getReviewTaskSummary(targetCoreCount));
    }
  },
  {
    method: 'POST' as const,
    path: '/api/review/core-principles/demote-excess',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ targetCoreCount?: number }>(req);
      const targetCoreCount = Number(body.targetCoreCount) || 30;
      sendResponse(res, 200, await ctx.db.demoteExcessCorePrinciples(targetCoreCount));
    }
  },
  {
    method: 'GET' as const,
    path: '/api/entities/review',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const result = await ctx.db.listEntitiesForReview({
        limit: Number(q.get('limit')) || 50,
        offset: Number(q.get('offset')) || 0,
        source: q.get('source') || undefined,
        type: q.get('type') || undefined,
        q: q.get('q') || undefined,
        coreOnly: q.get('coreOnly') === 'true',
        unlinkedOnly: q.get('unlinkedOnly') === 'true',
      });
      sendResponse(res, 200, result);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/entities/sources',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      sendResponse(res, 200, await ctx.db.countEntitiesBySource());
    }
  },
  {
    method: 'GET' as const,
    path: '/api/entities',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const limit = q.get('limit') ? Number(q.get('limit')) : undefined;
      const queryStr = q.get('q') || undefined;
      const type = q.get('type') || undefined;
      
      let entities;
      if (queryStr) {
        entities = await ctx.db.searchEntities(queryStr, limit || 10, type);
      } else {
        entities = await ctx.db.getRecentEntities(limit || 100);
      }
      sendResponse(res, 200, entities);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/entities/:id/neighborhood',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const depth = q.get('depth') ? Number(q.get('depth')) : 1;
      const neighborhood = await ctx.db.getGraphNeighborhood(params.id, depth);
      sendResponse(res, 200, {
        nodes: neighborhood.nodes,
        edges: neighborhood.edges,
        entities: neighborhood.nodes,
        relationships: neighborhood.edges
      });
    }
  },
  {
    method: 'GET' as const,
    path: '/api/entities/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const entity = await ctx.db.getEntity(params.id);
      if (!entity) {
        return sendError(res, 404, 'Entity not found');
      }
      const relationships = await ctx.db.getRelationshipsForEntity(entity.id);
      sendResponse(res, 200, { entity, relationships });
    }
  },
  {
    method: 'POST' as const,
    path: '/api/entities',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const parsed = EntityCreateSchema.safeParse(await parseBody<unknown>(req));
      if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid entity');
      const body = parsed.data;
      const entity = await ctx.db.addEntity({
        name: body.name,
        type: body.type,
        description: body.description,
        tags: body.tags,
        metadata: body.metadata,
        observed_at: body.observed_at,
        recorded_at: body.recorded_at,
        event_time: body.event_time,
        valid_from: body.valid_from,
        valid_until: body.valid_until,
        temporal_confidence: body.temporal_confidence,
        temporal_source: body.temporal_source,
        timezone: body.timezone,
      });
      sendResponse(res, 201, entity);
    }
  },
  {
    method: 'PUT' as const,
    path: '/api/entities/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const parsed = EntityUpdateSchema.safeParse(await parseBody<unknown>(req));
      if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid entity update');
      await ctx.db.updateEntity(params.id, parsed.data);
      const entity = await ctx.db.getEntity(params.id);
      sendResponse(res, 200, entity);
    }
  },
  {
    method: 'DELETE' as const,
    path: '/api/entities/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      await ctx.db.deleteEntity(params.id);
      sendResponse(res, 200, { success: true });
    }
  },
  {
    method: 'POST' as const,
    path: '/api/entities/:id/merge',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const body = await parseBody<{ targetId: string }>(req);
      if (!body.targetId) {
        return sendError(res, 400, 'targetId is required');
      }
      try {
        const result = await ctx.db.mergeEntities(params.id, body.targetId);
        sendResponse(res, 200, { success: true, ...result, mergedInto: body.targetId });
      } catch (error: unknown) {
        sendError(res, 400, error instanceof Error ? error.message : 'merge failed');
      }
    }
  },
  {
    method: 'GET' as const,
    path: '/api/entities/type/:type',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const entities = await ctx.db.getEntitiesByType(params.type);
      sendResponse(res, 200, entities);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/entities/search',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ query: string; limit?: number }>(req);
      const entities = await ctx.db.searchEntities(body.query, body.limit);
      sendResponse(res, 200, entities);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/relationships',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const parsed = RelationshipCreateSchema.safeParse(await parseBody<unknown>(req));
      if (!parsed.success) return sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid relationship');
      const body = parsed.data;
      const relationship = await ctx.db.addRelationship({
        source_id: body.sourceId,
        target_id: body.targetId,
        type: body.type,
        description: body.description,
        weight: body.weight,
        valid_from: body.valid_from,
        valid_until: body.valid_until,
      });
      sendResponse(res, 201, relationship);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/relationships',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const limit = q.get('limit') ? Number(q.get('limit')) : 200;
      const relationships = await ctx.db.getRelationships(limit);
      sendResponse(res, 200, relationships);
    }
  },
  {
    method: 'DELETE' as const,
    path: '/api/relationships/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      await ctx.db.deleteRelationship(params.id);
      sendResponse(res, 200, { success: true });
    }
  },
];

export const handlePrincipleRoutes = [
  {
    method: 'GET' as const,
    path: '/api/principles',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      // 统一图谱：principles 现在是 type='principle' 的 entities
      const principles = await ctx.db.getEntitiesByType('principle');
      sendResponse(res, 200, principles);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/principles',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{
        title: string;
        content: string;
        type: string;
        isCore?: boolean;
      }>(req);
      if (!body.title || !body.content || !body.type) {
        return sendError(res, 400, 'Title, content, and type are required');
      }
      // 统一图谱：作为 principle 类型的 entity 创建
      const entity = await ctx.db.addEntity({
        name: body.title,
        type: 'principle',
        description: body.content,
        tags: [body.type],
        metadata: {
          isCore: body.isCore || false,
          version: 1,
          principleType: body.type,
        },
      });
      sendResponse(res, 201, entity);
    }
  },
  // 静态路径 (core / type/:type) 必须先于 ":id"
  {
    method: 'GET' as const,
    path: '/api/principles/core',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const principles = await ctx.db.getCorePrinciples();
      sendResponse(res, 200, principles);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/principles/type/:type',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      // 通过 tags 或 metadata.principleType 过滤
      const allPrinciples = await ctx.db.getEntitiesByType('principle');
      const filtered = allPrinciples.filter(p =>
        p.tags?.includes(params.type) ||
        p.metadata?.principleType === params.type
      );
      sendResponse(res, 200, filtered);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/principles/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const entity = await ctx.db.getEntity(params.id);
      if (!entity || entity.type !== 'principle') {
        return sendError(res, 404, 'Principle not found');
      }
      const relationships = await ctx.db.getRelationshipsForEntity(entity.id);
      sendResponse(res, 200, { ...entity, relationships });
    }
  },
  {
    method: 'DELETE' as const,
    path: '/api/principles/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      await ctx.db.deleteEntity(params.id);
      sendResponse(res, 200, { success: true });
    }
  },
  {
    method: 'POST' as const,
    path: '/api/principles/:id/evidence',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const body = await parseBody<{
        content: string;
        sourceType: string;
        sourceFile?: string;
        ocrText?: string;
      }>(req);
      if (!body.content || !body.sourceType) {
        return sendError(res, 400, 'Content and source type are required');
      }
      // 统一图谱：证据作为 evidence 类型的 entity + 关系
      const evidence = await ctx.db.addEntity({
        name: `Evidence_${new Date().toISOString()}`,
        type: 'evidence',
        description: body.content,
        source_file: body.sourceFile,
        tags: [body.sourceType],
        metadata: {
          sourceType: body.sourceType,
          ocrText: body.ocrText,
        },
      });
      // 创建 evidence -> principle 的 supported_by 关系
      await ctx.db.addRelationship({
        source_id: evidence.id,
        target_id: params.id,
        type: 'supported_by',
        description: '证据支持原则',
        weight: 1.0,
      });
      sendResponse(res, 201, evidence);
    }
  },
];

export const handleGraphRoutes = [
  {
    method: 'POST' as const,
    path: '/api/graph/extract',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{
        text?: string;
        content?: string;
        clipboard?: string;
        screenshot?: string;
        source?: string;
      }>(req);

      const textContent = body.text || body.content;
      if (!textContent && !body.clipboard && !body.screenshot) {
        return sendError(res, 400, 'Text, clipboard, or screenshot content is required');
      }
      
      const result = await ctx.extractor.extract({
        textContent: body.source && textContent
          ? `Source: ${body.source}\n${textContent}`
          : textContent,
        clipboard: body.clipboard,
        screenshot: body.screenshot,
        timestamp: new Date().toISOString(),
        source: body.source || 'api:graph-extract',
      });

      const resolution = await resolveEntities(result.entities, result.relationships, ctx.db, ctx.embeddingService);

      for (const entity of resolution.entitiesToCreate) {
        await ctx.db.addEntity(entity);
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
      }

      for (const relationship of resolution.relationshipsToCreate) {
        await ctx.db.addRelationship(relationship);
      }

      // 原则实体同样走消解，避免重复抽取产生重复原则
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
        tags: ['auto_extracted', principle.type],
        metadata: {
          isCore: principle.isCore,
          version: principle.version || 1,
          principleType: principle.type,
        },
      }));
      const principleResolution = await resolveEntities(principleEntities, [], ctx.db, ctx.embeddingService);
      for (const entity of principleResolution.entitiesToCreate) {
        await ctx.db.addEntity(entity);
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

      sendResponse(res, 200, {
        entities: result.entities.length,
        relationships: result.relationships.length,
        principles: result.principles.length,
        summary: await ctx.extractor.summarizeEntities(result.entities),
      });
    }
  },
  {
    method: 'GET' as const,
    path: '/api/graph/context',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const context = await buildGraphContext(ctx, {});
      sendResponse(res, 200, context);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/graph/context',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{
        entityId?: string;
        query?: string;
        depth?: number;
        limit?: number;
      }>(req);
      const context = await buildGraphContext(ctx, body);
      sendResponse(res, 200, context);
    }
  },
];

async function buildGraphContext(
  ctx: RequestContext,
  body: { entityId?: string; query?: string; depth?: number; limit?: number }
) {
  let entities: any[] = [];
  let relationships: any[] = [];

  if (!body.entityId && !body.query) {
    // 节点上限由前端按设备/用户自定义传入，这里夹到 [50,20000]（重度用户可拉到"全部显示"）
    const cap = Math.min(Math.max(Number(body.limit) || 300, 50), 20000);
    entities = await ctx.db.getRecentEntities(cap);
    const total = await ctx.db.getEntityCount();
    const visibleEntityIds = new Set(entities.map((entity) => entity.id));
    relationships = (await ctx.db.getRelationships(cap * 2))
      .filter((relationship) =>
        visibleEntityIds.has(relationship.source_id) && visibleEntityIds.has(relationship.target_id)
      )
      .slice(0, cap * 2);

    return {
      entities,
      relationships,
      depth: body.depth || 2,
      total,
      shown: entities.length,
    };
  }

  if (body.entityId) {
    // 主动查询的目标节点保留 access 计数；其邻居仅展示，不应触发写放大
    const entity = await ctx.db.getEntity(body.entityId);
    if (entity) {
      entities.push(entity);
      const relatedRels = await ctx.db.getRelationshipsForEntity(entity.id);
      relationships.push(...relatedRels);

      for (const rel of relatedRels) {
        const relatedId = rel.source_id === entity.id ? rel.target_id : rel.source_id;
        const related = await ctx.db.peekEntity(relatedId);
        if (related) entities.push(related);
      }
    }
  }

  if (body.query) {
    const searchResults = await ctx.db.searchEntities(body.query, 10);
    entities.push(...searchResults);
  }

  const uniqueEntities = Array.from(
    new Map(entities.map(e => [e.id, e])).values()
  );

  const visibleEntityIds = new Set(uniqueEntities.map((entity) => entity.id));
  relationships = relationships.filter((relationship) =>
    visibleEntityIds.has(relationship.source_id) && visibleEntityIds.has(relationship.target_id)
  );

  return {
    entities: uniqueEntities,
    relationships: relationships.slice(0, 40),
    depth: body.depth || 2,
  };
}

export const handleStatsRoutes = [
  {
    method: 'GET' as const,
    path: '/api/stats',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const dbStats = await ctx.db.getStats();
      const coreStats = await ctx.coreMemory.getStats();
      const archivalSummary = await ctx.archivalMemory.summarize();

      sendResponse(res, 200, {
        database: dbStats,
        coreMemory: coreStats,
        archivalMemory: {
          totalItems: archivalSummary.totalItems,
          totalSize: archivalSummary.totalSize,
          topTags: archivalSummary.topTags,
        },
      });
    }
  },
  {
    method: 'POST' as const,
    path: '/api/export',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{
        type: 'core' | 'archival' | 'all';
        format: 'json' | 'csv';
      }>(req);

      const result: any = {};

      if (body.type === 'core' || body.type === 'all') {
        result.core = await ctx.coreMemory.export(body.format);
      }

      if (body.type === 'archival' || body.type === 'all') {
        result.archival = await ctx.archivalMemory.export(body.format);
      }

      sendResponse(res, 200, result);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/import',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{
        type: 'core' | 'archival';
        format: 'json' | 'csv';
        data: string;
      }>(req);

      let imported = 0;

      if (body.type === 'core') {
        imported = await ctx.coreMemory.import(body.data, body.format);
      } else if (body.type === 'archival') {
        imported = await ctx.archivalMemory.import(body.data, body.format);
      }

      sendResponse(res, 200, { imported });
    }
  },
];

export const handleNotificationRoutes = [
  {
    method: 'GET' as const,
    path: '/api/notifications',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const notifications = await ctx.db.getUnreadNotifications();
      sendResponse(res, 200, notifications);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/notifications/:id/read',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      await ctx.db.markNotificationRead(params.id);
      sendResponse(res, 200, { success: true });
    }
  },
  {
    method: 'POST' as const,
    path: '/api/notifications/:id/promote',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const r = await ctx.db.promoteInsightToGraph(params.id);
      if (!r) {
        sendError(res, 404, 'insight not found or already processed');
      } else {
        sendResponse(res, 200, r);
      }
    }
  }
];

// 问大脑会话历史（可续聊的思考记录）。静态 /api/discussions 必须先于 :id 动态路径。
export const handleDiscussionRoutes = [
  {
    method: 'GET' as const,
    path: '/api/discussions',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const items = await ctx.db.listDiscussions(50);
      sendResponse(res, 200, items);
    }
  },
  {
    method: 'POST' as const,
    path: '/api/discussions',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ id?: string; title?: string; turns?: any[] }>(req);
      if (!body.title || !Array.isArray(body.turns)) {
        return sendError(res, 400, 'title 和 turns 必填');
      }
      const r = await ctx.db.upsertDiscussion({ id: body.id, title: body.title, turns: body.turns });
      sendResponse(res, 200, r);
    }
  },
  {
    method: 'GET' as const,
    path: '/api/discussions/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const d = await ctx.db.getDiscussion(params.id);
      if (!d) return sendError(res, 404, 'Discussion not found');
      sendResponse(res, 200, d);
    }
  },
  {
    method: 'DELETE' as const,
    path: '/api/discussions/:id',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      await ctx.db.deleteDiscussion(params.id);
      sendResponse(res, 200, { success: true });
    }
  },
];

export { handleSettingsRoutes } from './settings.js';
export { handleAdminRoutes } from './admin.js';
export { handleIngestRoutes } from './ingest.js';
export { handleMcpRoutes } from './mcp.js';
