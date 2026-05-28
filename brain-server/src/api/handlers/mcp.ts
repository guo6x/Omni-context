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
  SaveDecisionSchema,
  AnalyzeDecisionSchema,
  DiscussDecisionSchema,
  GetDecisionLineageSchema,
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

// ── shared: retrieve decision context ──

interface DecisionContextData {
  situation: string;
  principles: any[];
  relevantMemories: any[];
  conflicts: any[];
}

async function retrieveDecisionContext(
  ctx: RequestContext,
  situation: string,
  limit: number,
): Promise<DecisionContextData> {
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

  // access tracking
  const accIds = [
    ...relevantMemories.map((m: any) => m.id),
    ...principles.map((p: any) => p.id),
  ].filter(Boolean);
  if (accIds.length > 0) {
    ctx.db.bumpAccessCounts(accIds).catch(() => {});
  }

  return { situation, principles, relevantMemories, conflicts: conflictPairs };
}

// ── shared: call LLM for decision analysis ──

async function callLlmDecision(
  ctx: RequestContext,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const llmConfig = ctx.extractor.getLlmConfig();
  if (!llmConfig.apiUrl) {
    throw new Error('LLM_NOT_CONFIGURED');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${llmConfig.apiUrl}/chat/completions`, {
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

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    // try to extract JSON from code blocks
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    return jsonMatch ? jsonMatch[1].trim() : content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ── agentic: let the LLM search the graph itself for missing context ──
// 给 LLM 一个 search_memory 工具，让它多轮自主检索补齐情境缺失的信息。
// 模型不支持 tool-calling 时优雅降级（返回空，退回单次检索的基础上下文）。
async function agenticEnrichMemories(
  ctx: RequestContext,
  situation: string,
  baseMemories: any[],
  maxIter = 3,
): Promise<any[]> {
  const llmConfig = ctx.extractor.getLlmConfig();
  if (!llmConfig.apiUrl) return [];

  const runSearch = async (query: string, limit = 5): Promise<any[]> => {
    const text = await ctx.db.searchEntities(query, limit);
    let vec: any[] = [];
    try {
      const emb = await ctx.embeddingService.embed(query);
      vec = await ctx.db.vectorSearch(emb.embedding, limit);
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
        const resp = await fetch(`${llmConfig.apiUrl}/chat/completions`, {
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

// ── shared: build analysis prompt ──

function buildAnalysisPrompt(situation: string, context: DecisionContextData): string {
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

            // 类型过滤下推到 SQL（searchEntities 第三参），避免全量拉取该类型再 JS 过滤
            const entities = await ctx.db.searchEntities(query, limit, type);

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

            const ctxData = await retrieveDecisionContext(ctx, situation, limit);

            let graphContext: any = {};
            const seed = ctxData.relevantMemories[0];
            if (seed) {
              try {
                graphContext = await ctx.db.getGraphNeighborhood(seed.id, 2);
              } catch {
                // ignore
              }
            }

            result = {
              situation,
              principles: ctxData.principles.map(toCompactEntity),
              relevantMemories: ctxData.relevantMemories.map(toCompactEntity),
              conflicts: ctxData.conflicts,
              graphContext: graphContext && graphContext.nodes ? {
                ...graphContext,
                nodes: graphContext.nodes.map(toCompactEntity)
              } : graphContext,
            };
            break;
          }
          case 'analyze_decision': {
            const parsed = AnalyzeDecisionSchema.parse(args);
            const { situation } = parsed;

            // Step 1: retrieve context from knowledge graph
            const ctxData = await retrieveDecisionContext(ctx, situation, 5);

            // Step 1b: agentic — let the LLM search for any context it still needs
            try {
              const extra = await agenticEnrichMemories(ctx, situation, ctxData.relevantMemories);
              const known = new Set(ctxData.relevantMemories.map((m: any) => m.id));
              for (const e of extra) {
                if (!known.has(e.id)) { known.add(e.id); ctxData.relevantMemories.push(e); }
              }
            } catch {
              // additive enrichment; ignore failures
            }

            // Build citations list
            const rawCitations = [
              ...ctxData.principles.map((p: any) => ({ id: p.id, name: p.name, type: p.type, description: p.description })),
              ...ctxData.relevantMemories
                .filter((m: any) => m.type !== 'principle')
                .map((m: any) => ({ id: m.id, name: m.name, type: m.type, description: m.description })),
            ];

            // Step 2: call LLM for structured analysis
            let analysisJson: any;
            try {
              const promptText = buildAnalysisPrompt(situation, ctxData);
              const llmResponse = await callLlmDecision(
                ctx,
                '你是一个决策分析助手。你基于用户的知识图谱数据，帮助分析决策情境。只输出有效的 JSON。使用中文回复。',
                promptText,
              );
              analysisJson = JSON.parse(llmResponse);
            } catch (e: any) {
              if (e.message === 'LLM_NOT_CONFIGURED') {
                sendError(res, 400, 'LLM_NOT_CONFIGURED: LLM provider not configured');
                return;
              }
              console.error('[analyze_decision] LLM analysis failed:', e);
              // fallback: return structured empty result with citations only
              analysisJson = {
                summary: '',
                pros: [],
                cons: [],
                recommendation: '',
              };
            }

            result = {
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
            };
            break;
          }
          case 'discuss_decision': {
            const parsed = DiscussDecisionSchema.parse(args);
            const { situation, messages } = parsed;

            const llmConfig = ctx.extractor.getLlmConfig();
            if (!llmConfig.apiUrl) {
              sendError(res, 400, 'LLM_NOT_CONFIGURED');
              return;
            }

            const systemPrompt = `你是一个决策讨论助手。用户正在讨论一个决策："""${situation}"""
你在帮助用户深入思考、质疑假设、补充视角。回复要简洁、直接、有帮助。使用中文。`;

            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 60000);

              const response = await fetch(`${llmConfig.apiUrl}/chat/completions`, {
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

              result = { reply: data.choices?.[0]?.message?.content || '(no response)' };
            } catch (e: any) {
              console.error('[discuss_decision] Failed:', e);
              result = { reply: '抱歉，讨论服务暂时不可用。' };
            }
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
            const { situation, conclusion, cited_entity_ids, confidence, alternatives } = parsed;

            // Build full description: situation + decision
            const confidenceLabel = { high: '高', medium: '中', low: '低' }[confidence];
            const altSection = alternatives ? `\n\n替代方案：${alternatives}` : '';
            const fullDescription = `情境：${situation}\n\n决策：${conclusion}\n\n置信度：${confidenceLabel}${altSection}`;
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
              tags: ['decision', `confidence-${confidence}`],
              embedding,
              metadata: {
                situation,
                conclusion,
                confidence,
                alternatives,
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
              // Bump importance of cited entities (反哺：被引用的实体获得权重提升)
              try {
                ctx.db.bumpAccessCounts(cited_entity_ids).catch(() => {});
              } catch {
                // best effort
              }
            }

            // Link to previous related decisions (lineage)
            try {
              const prevDecisions = await ctx.db.searchEntities(situation, 3);
              const prevDecisionIds = prevDecisions
                .filter((e: any) => e.type === 'decision' && e.id !== decisionEntity.id)
                .map((e: any) => e.id);
              for (const prevId of prevDecisionIds.slice(0, 3)) {
                try {
                  await ctx.db.addRelationship({
                    source_id: decisionEntity.id,
                    target_id: prevId,
                    type: 'relates_to',
                    description: '决策链：后续决策关联了此前的相关决策',
                    weight: 0.8,
                  });
                } catch {
                  // duplicate is fine
                }
              }
            } catch (e) {
              console.warn('[save_decision] lineage linking failed:', e);
            }

            // Write to archival memory
            try {
              await ctx.archivalMemory.add(fullDescription, {
                summary: `决策: ${conclusion} (置信度: ${confidenceLabel})`,
                tags: ['decision', 'user-decision', `confidence-${confidence}`],
                embedding,
                importance: confidence === 'high' ? 8 : confidence === 'medium' ? 7 : 5,
              });
            } catch (e) {
              console.warn('[save_decision] 写入 archival memory 失败:', e);
            }

            result = decisionEntity;
            break;
          }
          case 'get_decision_lineage': {
            const parsed = GetDecisionLineageSchema.parse(args);
            const { decision_id } = parsed;

            // Get the decision entity
            const decision = await ctx.db.getEntity(decision_id);
            if (!decision || decision.type !== 'decision') {
              sendError(res, 404, 'Decision not found');
              return;
            }

            const current: any = {
              id: decision.id,
              name: decision.name,
              conclusion: decision.metadata?.conclusion || decision.description || '',
              situation: decision.metadata?.situation || '',
              timestamp: decision.created_at,
              confidence: decision.metadata?.confidence || 'medium',
            };

            // Get relationships from this decision
            const rels = await ctx.db.getRelationshipsForEntity(decision_id);

            // Sources: entities referenced by this decision
            const sources: any[] = [];
            const chain: any[] = [];
            const seenChainIds = new Set<string>();
            seenChainIds.add(decision_id);

            for (const rel of rels) {
              const otherId = rel.source_id === decision_id ? rel.target_id : rel.source_id;
              const other = await ctx.db.getEntity(otherId);
              if (!other) continue;

              if (rel.type === 'decision_referenced') {
                sources.push({
                  entityId: other.id,
                  entityName: other.name,
                  entityType: other.type,
                  relationship: 'decision_referenced',
                });
              } else if (rel.type === 'relates_to' && other.type === 'decision' && !seenChainIds.has(other.id)) {
                seenChainIds.add(other.id);
                chain.push({
                  id: other.id,
                  name: other.name,
                  conclusion: other.metadata?.conclusion || other.description || '',
                  situation: other.metadata?.situation || '',
                  timestamp: other.created_at,
                  confidence: other.metadata?.confidence || 'medium',
                });
              }
            }

            result = { current, sources, chain };
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
