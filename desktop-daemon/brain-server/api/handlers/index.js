import { parseBody, sendResponse, sendError } from '../routes.js';
export const handleMemoryRoutes = [
    {
        method: 'GET',
        path: '/api/memory/core',
        handler: async (req, res, ctx) => {
            const items = await ctx.coreMemory.getAll();
            sendResponse(res, 200, items);
        }
    },
    // 注意: 静态路径 (stats / search / compress / category) 必须先于 ":key" 注册，
    // 否则 router 会按顺序匹配，导致这些固定路径被当作动态 key 走到 404。
    {
        method: 'GET',
        path: '/api/memory/core/stats',
        handler: async (req, res, ctx) => {
            const stats = await ctx.coreMemory.getStats();
            sendResponse(res, 200, stats);
        }
    },
    {
        method: 'POST',
        path: '/api/memory/core/search',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            const items = await ctx.coreMemory.search(body.query, {
                category: body.category,
                limit: body.limit,
            });
            sendResponse(res, 200, items);
        }
    },
    {
        method: 'POST',
        path: '/api/memory/core/compress',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            const result = await ctx.coreMemory.compress(body.category);
            sendResponse(res, 200, result);
        }
    },
    {
        method: 'GET',
        path: '/api/memory/core/category/:category',
        handler: async (req, res, ctx, params) => {
            const items = await ctx.coreMemory.getByCategory(params.category);
            sendResponse(res, 200, items);
        }
    },
    {
        method: 'GET',
        path: '/api/memory/core/:key',
        handler: async (req, res, ctx, params) => {
            const item = await ctx.coreMemory.get(params.key);
            if (!item) {
                return sendError(res, 404, 'Memory item not found');
            }
            sendResponse(res, 200, item);
        }
    },
    {
        method: 'POST',
        path: '/api/memory/core',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            if (!body.key) {
                return sendError(res, 400, 'Key is required');
            }
            await ctx.coreMemory.set(body.key, body.value, body.category);
            sendResponse(res, 201, { success: true, key: body.key });
        }
    },
    {
        method: 'DELETE',
        path: '/api/memory/core/:key',
        handler: async (req, res, ctx, params) => {
            await ctx.coreMemory.delete(params.key);
            sendResponse(res, 200, { success: true });
        }
    },
    {
        method: 'GET',
        path: '/api/memory/archival',
        handler: async (req, res, ctx) => {
            const items = await ctx.archivalMemory.getAll({ limit: 100 });
            sendResponse(res, 200, items);
        }
    },
    // 静态路径 (summary / search / compress) 必须先于 ":id" 动态路径
    {
        method: 'GET',
        path: '/api/memory/archival/summary',
        handler: async (req, res, ctx) => {
            const summary = await ctx.archivalMemory.summarize();
            sendResponse(res, 200, summary);
        }
    },
    {
        method: 'POST',
        path: '/api/memory/archival/search',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            const results = await ctx.archivalMemory.search(body.query, {
                tags: body.tags,
                limit: body.limit,
            });
            sendResponse(res, 200, results);
        }
    },
    {
        method: 'POST',
        path: '/api/memory/archival/compress',
        handler: async (req, res, ctx) => {
            const result = await ctx.archivalMemory.compress();
            sendResponse(res, 200, result);
        }
    },
    {
        method: 'GET',
        path: '/api/memory/archival/:id',
        handler: async (req, res, ctx, params) => {
            const item = await ctx.archivalMemory.get(params.id);
            if (!item) {
                return sendError(res, 404, 'Archival item not found');
            }
            sendResponse(res, 200, item);
        }
    },
    {
        method: 'POST',
        path: '/api/memory/archival',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
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
        method: 'PUT',
        path: '/api/memory/archival/:id',
        handler: async (req, res, ctx, params) => {
            const body = await parseBody(req);
            const item = await ctx.archivalMemory.update(params.id, body);
            if (!item) {
                return sendError(res, 404, 'Archival item not found');
            }
            sendResponse(res, 200, item);
        }
    },
    {
        method: 'DELETE',
        path: '/api/memory/archival/:id',
        handler: async (req, res, ctx, params) => {
            const deleted = await ctx.archivalMemory.delete(params.id);
            sendResponse(res, 200, { success: deleted });
        }
    },
];
export const handleEntityRoutes = [
    {
        method: 'GET',
        path: '/api/entities',
        handler: async (req, res, ctx) => {
            const entities = await ctx.db.getRecentEntities(100);
            sendResponse(res, 200, entities);
        }
    },
    {
        method: 'GET',
        path: '/api/entities/:id',
        handler: async (req, res, ctx, params) => {
            const entity = await ctx.db.getEntity(params.id);
            if (!entity) {
                return sendError(res, 404, 'Entity not found');
            }
            const relationships = await ctx.db.getRelationshipsForEntity(entity.id);
            sendResponse(res, 200, { entity, relationships });
        }
    },
    {
        method: 'POST',
        path: '/api/entities',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            if (!body.name || !body.type) {
                return sendError(res, 400, 'Name and type are required');
            }
            const entity = await ctx.db.addEntity({
                name: body.name,
                type: body.type,
                description: body.description,
                tags: body.tags,
            });
            sendResponse(res, 201, entity);
        }
    },
    {
        method: 'PUT',
        path: '/api/entities/:id',
        handler: async (req, res, ctx, params) => {
            const body = await parseBody(req);
            await ctx.db.updateEntity(params.id, body);
            const entity = await ctx.db.getEntity(params.id);
            sendResponse(res, 200, entity);
        }
    },
    {
        method: 'DELETE',
        path: '/api/entities/:id',
        handler: async (req, res, ctx, params) => {
            await ctx.db.deleteEntity(params.id);
            sendResponse(res, 200, { success: true });
        }
    },
    {
        method: 'GET',
        path: '/api/entities/type/:type',
        handler: async (req, res, ctx, params) => {
            const entities = await ctx.db.getEntitiesByType(params.type);
            sendResponse(res, 200, entities);
        }
    },
    {
        method: 'POST',
        path: '/api/entities/search',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            const entities = await ctx.db.searchEntities(body.query, body.limit);
            sendResponse(res, 200, entities);
        }
    },
    {
        method: 'POST',
        path: '/api/relationships',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            if (!body.sourceId || !body.targetId || !body.type) {
                return sendError(res, 400, 'Source ID, target ID, and type are required');
            }
            const relationship = await ctx.db.addRelationship({
                source_id: body.sourceId,
                target_id: body.targetId,
                type: body.type,
                description: body.description,
                weight: body.weight,
            });
            sendResponse(res, 201, relationship);
        }
    },
    {
        method: 'DELETE',
        path: '/api/relationships/:id',
        handler: async (req, res, ctx, params) => {
            await ctx.db.deleteRelationship(params.id);
            sendResponse(res, 200, { success: true });
        }
    },
];
export const handlePrincipleRoutes = [
    {
        method: 'GET',
        path: '/api/principles',
        handler: async (req, res, ctx) => {
            // 统一图谱：principles 现在是 type='principle' 的 entities
            const principles = await ctx.db.getEntitiesByType('principle');
            sendResponse(res, 200, principles);
        }
    },
    {
        method: 'POST',
        path: '/api/principles',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
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
        method: 'GET',
        path: '/api/principles/core',
        handler: async (req, res, ctx) => {
            const principles = await ctx.db.getCorePrinciples();
            sendResponse(res, 200, principles);
        }
    },
    {
        method: 'GET',
        path: '/api/principles/type/:type',
        handler: async (req, res, ctx, params) => {
            // 通过 tags 或 metadata.principleType 过滤
            const allPrinciples = await ctx.db.getEntitiesByType('principle');
            const filtered = allPrinciples.filter(p => p.tags?.includes(params.type) ||
                p.metadata?.principleType === params.type);
            sendResponse(res, 200, filtered);
        }
    },
    {
        method: 'GET',
        path: '/api/principles/:id',
        handler: async (req, res, ctx, params) => {
            const entity = await ctx.db.getEntity(params.id);
            if (!entity || entity.type !== 'principle') {
                return sendError(res, 404, 'Principle not found');
            }
            const relationships = await ctx.db.getRelationshipsForEntity(entity.id);
            sendResponse(res, 200, { ...entity, relationships });
        }
    },
    {
        method: 'DELETE',
        path: '/api/principles/:id',
        handler: async (req, res, ctx, params) => {
            await ctx.db.deleteEntity(params.id);
            sendResponse(res, 200, { success: true });
        }
    },
    {
        method: 'POST',
        path: '/api/principles/:id/evidence',
        handler: async (req, res, ctx, params) => {
            const body = await parseBody(req);
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
        method: 'POST',
        path: '/api/graph/extract',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
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
            });
            for (const entity of result.entities) {
                await ctx.db.addEntity(entity);
            }
            for (const relationship of result.relationships) {
                await ctx.db.addRelationship(relationship);
            }
            for (const principle of result.principles) {
                await ctx.db.addEntity({
                    name: principle.title,
                    type: 'principle',
                    description: principle.content,
                    tags: ['auto_extracted', principle.type],
                    metadata: {
                        isCore: principle.isCore,
                        version: principle.version || 1,
                        principleType: principle.type,
                    },
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
        method: 'GET',
        path: '/api/graph/context',
        handler: async (req, res, ctx) => {
            const context = await buildGraphContext(ctx, {});
            sendResponse(res, 200, context);
        }
    },
    {
        method: 'POST',
        path: '/api/graph/context',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            const context = await buildGraphContext(ctx, body);
            sendResponse(res, 200, context);
        }
    },
];
async function buildGraphContext(ctx, body) {
    let entities = [];
    let relationships = [];
    if (!body.entityId && !body.query) {
        entities = await ctx.db.getRecentEntities(80);
        const visibleEntityIds = new Set(entities.map((entity) => entity.id));
        relationships = (await ctx.db.getRelationships(200))
            .filter((relationship) => visibleEntityIds.has(relationship.source_id) && visibleEntityIds.has(relationship.target_id))
            .slice(0, 120);
        return {
            entities,
            relationships,
            depth: body.depth || 2,
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
                if (related)
                    entities.push(related);
            }
        }
    }
    if (body.query) {
        const searchResults = await ctx.db.searchEntities(body.query, 10);
        entities.push(...searchResults);
    }
    const uniqueEntities = Array.from(new Map(entities.map(e => [e.id, e])).values());
    const visibleEntityIds = new Set(uniqueEntities.map((entity) => entity.id));
    relationships = relationships.filter((relationship) => visibleEntityIds.has(relationship.source_id) && visibleEntityIds.has(relationship.target_id));
    return {
        entities: uniqueEntities,
        relationships: relationships.slice(0, 40),
        depth: body.depth || 2,
    };
}
export const handleStatsRoutes = [
    {
        method: 'GET',
        path: '/api/stats',
        handler: async (req, res, ctx) => {
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
        method: 'POST',
        path: '/api/export',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            const result = {};
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
        method: 'POST',
        path: '/api/import',
        handler: async (req, res, ctx) => {
            const body = await parseBody(req);
            let imported = 0;
            if (body.type === 'core') {
                imported = await ctx.coreMemory.import(body.data, body.format);
            }
            else if (body.type === 'archival') {
                imported = await ctx.archivalMemory.import(body.data, body.format);
            }
            sendResponse(res, 200, { imported });
        }
    },
];
export const handleNotificationRoutes = [
    {
        method: 'GET',
        path: '/api/notifications',
        handler: async (req, res, ctx) => {
            const notifications = await ctx.db.getUnreadNotifications();
            sendResponse(res, 200, notifications);
        }
    },
    {
        method: 'POST',
        path: '/api/notifications/:id/read',
        handler: async (req, res, ctx, params) => {
            await ctx.db.markNotificationRead(params.id);
            sendResponse(res, 200, { success: true });
        }
    }
];
export { handleAdminRoutes } from './admin.js';
export { handleIngestRoutes } from './ingest.js';
