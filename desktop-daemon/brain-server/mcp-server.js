#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
import initDatabase from './db/sqlite.js';
import { GraphRAGExtractor } from './graphrag/extractor.js';
import { EmbeddingService } from './embedding/service.js';
import { MemoryDecayScheduler } from './memory/decay-scheduler.js';
import { AgentLoop } from './agent/agent-loop.js';
import { createServer } from './api/routes.js';
import { z } from 'zod';
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
    constructor() {
        this.agentLoop = null;
        this.db = initDatabase({
            dbPath: process.env.DB_PATH || './data/omni-context.db',
            enableWAL: true,
            busyTimeout: 5000,
        });
        this.extractor = new GraphRAGExtractor();
        // [核心壁垒] Embedding 服务 — 支持本地/API 模式切换
        this.embeddingService = new EmbeddingService({
            mode: process.env.EMBEDDING_MODE || 'local',
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
        this.server = new Server({
            name: 'omni-context-brain-server',
            version: '2.0.0',
        }, {
            capabilities: {
                tools: {},
                resources: {},
            },
        });
        this.setupHandlers();
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => this.listTools());
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => this.callTool(request));
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => this.listResources());
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => this.readResource(request));
    }
    async listTools() {
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
                {
                    name: 'unified_memory_search',
                    description: '[统一记忆检索] 融合向量搜索 + 文本搜索 + 图谱遍历，一次性返回最相关的记忆',
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
                    name: 'get_decay_report',
                    description: '获取记忆衰减报告',
                    inputSchema: { type: 'object', properties: {} },
                },
            ],
        };
    }
    async callTool(request) {
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
                    const query = args.query;
                    const type = args.type;
                    const limit = args.limit || 10;
                    let entities;
                    if (type) {
                        entities = await this.db.getEntitiesByType(type);
                        entities = entities.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()) ||
                            e.description?.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
                    }
                    else {
                        entities = await this.db.searchEntities(query, limit);
                    }
                    return this.formatResponse(entities);
                }
                case 'add_entity': {
                    const parsed = AddEntitySchema.parse(args);
                    // [核心壁垒] 自动生成 embedding
                    let embedding;
                    try {
                        const embeddingText = `${parsed.name}: ${parsed.description || ''}`;
                        const result = await this.embeddingService.embed(embeddingText);
                        embedding = result.embedding;
                    }
                    catch (e) {
                        console.warn('[add_entity] Embedding 生成失败，实体将不包含向量:', e);
                    }
                    const entity = await this.db.addEntity({
                        name: parsed.name,
                        type: parsed.type,
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
                    const entity = await this.db.getEntity(args.id);
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
                        type: parsed.type,
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
                            }
                            catch {
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
                        }
                        catch (e) {
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
                    const type = args.type;
                    const limit = args.limit || 50;
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
                    const results = await this.db.vectorSearch(args.embedding, args.limit || 10);
                    return this.formatResponse(results);
                }
                case 'unified_memory_search': {
                    const query = args.query;
                    const limit = args.limit || 5;
                    const includeRels = args.includeRelationships !== false;
                    // [核心壁垒] 三层记忆融合检索
                    const results = { textResults: [], vectorResults: [], graphContext: [] };
                    // 层1：文本搜索（FTS5 → LIKE 回退）
                    results.textResults = await this.db.searchEntities(query, limit);
                    // 层2：向量搜索（需要先将 query 转为 embedding）
                    try {
                        const embResult = await this.embeddingService.embed(query);
                        results.vectorResults = await this.db.vectorSearch(embResult.embedding, limit);
                    }
                    catch (e) {
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
                    const seenIds = new Set();
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
                case 'get_decay_report': {
                    const report = this.decayScheduler.getLastReport();
                    return this.formatResponse(report || { message: '尚未执行衰减周期' });
                }
                default:
                    throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
            }
        }
        catch (error) {
            if (error instanceof McpError)
                throw error;
            if (error instanceof z.ZodError) {
                throw new McpError(ErrorCode.InvalidParams, `参数验证失败: ${error.errors.map((e) => e.message).join(', ')}`);
            }
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new McpError(ErrorCode.InternalError, `执行错误: ${errorMessage}`);
        }
    }
    async listResources() {
        const entityTypes = await this.db.all('SELECT type, COUNT(*) as count FROM entities GROUP BY type');
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
    async readResource(request) {
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
    formatResponse(data) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(data, null, 2),
                },
            ],
        };
    }
    formatResource(uri, data) {
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
    async start() {
        await this.db.runMigrations();
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Omni-Context Brain Server v2 (统一 GraphRAG 架构) 已启动');
        // [生态升级] 同时启动 HTTP API Server 供浏览器插件和移动端使用
        const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
        const HOST = process.env.HOST || '127.0.0.1';
        const httpServer = createServer(this.db);
        httpServer.listen(PORT, HOST, () => {
            console.error(`Omni-Context API Server 运行在 http://${HOST}:${PORT} (供外部生态接入)`);
        });
        // [Insights] 主动智能引擎 — 桌面端 InsightsInbox 依赖它产生通知
        const insightIntervalMs = process.env.INSIGHT_INTERVAL_MS
            ? Number(process.env.INSIGHT_INTERVAL_MS)
            : 10 * 60 * 1000;
        this.agentLoop = new AgentLoop(this.db);
        this.agentLoop.start(insightIntervalMs);
    }
    async stop() {
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
