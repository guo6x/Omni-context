import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { resolveEntities } from '../../graphrag/entity-resolver.js';
import { resolveConflicts } from '../../graphrag/conflict-resolver.js';
import { v4 as uuidv4 } from 'uuid';
import type { EntityType, RelationshipType, Entity, Assertion } from '../../shared-types.js';
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
  GetCoreContextSchema,
  DeleteEntitySchema,
  SetCoreSchema,
  MergeEntitiesSchema,
  tools as mcpToolDefs,
} from '../../mcp-tools.js';
import { parseTimeWindow } from '../../utils/time-window.js';
import {
  capGraphContext,
  memoryCandidateScore,
  rankMemoryCandidates,
  selectGeneralCorePrinciples,
  selectRelevantPrinciples,
} from '../../mcp-retrieval.js';
import { createAuditedAiFetch } from '../../security/audited-ai-fetch.js';
import { assertEvaluationEmbeddingReady, loadRetrievalConfig } from '../../retrieval/config.js';

const CORE_PRINCIPLE_CAP = 3;
const mcpLlmFetch = createAuditedAiFetch({ purpose: 'api.decision-intelligence', kind: 'llm' });
const MCP_EMBEDDING_TIMEOUT_MS = Number(process.env.MCP_EMBEDDING_TIMEOUT_MS || 2500);
const MCP_RERANK_TIMEOUT_MS = Number(process.env.MCP_RERANK_TIMEOUT_MS || 2500);
const RETRIEVAL_CONFIG = loadRetrievalConfig();

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

function getClientLabel(req: http.IncomingMessage): string {
  const explicit = req.headers['x-omni-client'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 80);
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string' && ua.trim()) return ua.trim().slice(0, 80);
  return 'mcp-client';
}

function extractQuerySummary(args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const fields = ['query', 'situation', 'question', 'summary', 'name', 'text'];
  for (const field of fields) {
    const value = args[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 500);
    }
  }
  return undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function collectMatchedEntities(value: any, out: Array<{ id: string; name?: string; type?: string }> = []): Array<{ id: string; name?: string; type?: string }> {
  if (!value || out.length >= 12) return out;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMatchedEntities(item, out);
      if (out.length >= 12) break;
    }
    return out;
  }
  if (typeof value !== 'object') return out;

  const id = typeof value.id === 'string' ? value.id : typeof value.entityId === 'string' ? value.entityId : undefined;
  const name = typeof value.name === 'string' ? value.name : typeof value.entityName === 'string' ? value.entityName : undefined;
  const type = typeof value.type === 'string' ? value.type : typeof value.entityType === 'string' ? value.entityType : undefined;
  if (id && (name || type || value.description)) {
    if (!out.some((e) => e.id === id)) out.push({ id, name, type });
  }

  for (const key of ['results', 'sources', 'rawCitations', 'relevantMemories', 'principles', 'nodes', 'graphContext', 'entity']) {
    if (value[key] !== undefined) {
      collectMatchedEntities(value[key], out);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function rethrowEvaluationEmbeddingFailure(error: unknown): void {
  if (error instanceof Error && error.message.startsWith('EVALUATION_EMBEDDING_UNAVAILABLE')) {
    throw error;
  }
}

// ── shared: LLM 重排 ──
// 弱 embedding（尤其中文）召回的候选相似度挤在一起、噪声多。先宽召回，再用 LLM 按真实相关度
// 重排挑出 topN。LLM 不可用/超时则优雅降级为原序截断，绝不阻塞检索。
async function rerankByLlm(
  ctx: RequestContext,
  query: string,
  candidates: any[],
  topN: number,
  options: { decisionMode?: boolean; historicalMode?: boolean } = {},
): Promise<any[]> {
  const deterministic = rankMemoryCandidates(query, candidates, { ...options, config: RETRIEVAL_CONFIG });
  if (deterministic.length <= topN) return deterministic;
  const llm = ctx.extractor.getLlmConfig();
  if (!llm.apiUrl) return deterministic.slice(0, topN);

  const list = deterministic
    .map((c, i) => `[${i}] (${c.type}) ${c.name}: ${(c.description || '').slice(0, 120)}`)
    .join('\n');
  const sys = `你是知识图谱检索的重排器。根据用户查询，从候选记忆里挑出真正相关的，按相关度从高到低给出编号；不相关的不要选。只输出 JSON：{"ranking":[编号,...]}，最多 ${topN} 个。`;
  const user = `查询：${query}\n\n候选：\n${list}`;

  try {
    const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MCP_RERANK_TIMEOUT_MS);
    let raw = '';
    try {
      const r = await mcpLlmFetch(`${llm.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}) },
        body: JSON.stringify({
          model: llm.model,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
          max_tokens: 200,
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!r.ok) throw new Error(`rerank ${r.status}`);
      const d = (await r.json()) as { choices: Array<{ message: { content: string } }> };
      raw = d.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timer); }

    const m = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const parsed = JSON.parse(m ? m[1].trim() : raw.trim());
    const order: number[] = Array.isArray(parsed.ranking) ? parsed.ranking : [];
    const picked: any[] = [];
    const used = new Set<number>();
    for (const n of order) {
      const i = Number(n);
      if (Number.isInteger(i) && i >= 0 && i < deterministic.length && !used.has(i)) {
        used.add(i);
        picked.push(deterministic[i]);
        if (picked.length >= topN) break;
      }
    }
    if (!picked.length) return deterministic.slice(0, topN);
    // LLM 选不满 topN 时，用原序候选补齐
    for (const c of deterministic) {
      if (picked.length >= topN) break;
      if (!used.has(deterministic.indexOf(c))) picked.push(c);
    }
    return picked.slice(0, topN);
  } catch {
    return deterministic.slice(0, topN);
  }
}

interface AggregatedGraphContext {
  nodes: any[];
  edges: any[];
  seedIds: string[];
}

async function retrieveGraphContext(
  ctx: RequestContext,
  seeds: any[],
  limit: number,
  includeInvalidated = false,
): Promise<AggregatedGraphContext> {
  const nodeLimit = Math.max(limit * RETRIEVAL_CONFIG.graphNodeLimitMultiplier, 8);
  const edgeLimit = Math.max(limit * RETRIEVAL_CONFIG.graphEdgeLimitMultiplier, 12);
  const seedIds = [...new Set<string>(seeds.map((seed) => seed?.id).filter(Boolean))]
    .slice(0, RETRIEVAL_CONFIG.graphSeedCount);
  const nodes = new Map<string, any>();
  const edges = new Map<string, any>();

  for (const seedId of seedIds) {
    try {
      const graph = capGraphContext(
        await ctx.db.getGraphNeighborhood(seedId, RETRIEVAL_CONFIG.graphDepth, includeInvalidated),
        nodeLimit,
        edgeLimit,
      );
      for (const node of graph?.nodes || []) {
        if (node?.id && !nodes.has(node.id)) nodes.set(node.id, node);
      }
      for (const edge of graph?.edges || []) {
        const source = edge.source_id ?? edge.source;
        const target = edge.target_id ?? edge.target;
        const key = `${source}|${target}|${edge.type || ''}|${edge.id || ''}`;
        if (source && target && !edges.has(key)) edges.set(key, edge);
      }
    } catch {
      // A broken seed must not discard graph context from the remaining seeds.
    }
  }

  return {
    nodes: [...nodes.values()].slice(0, nodeLimit),
    edges: [...edges.values()].slice(0, edgeLimit),
    seedIds,
  };
}

interface GroundingEvidence {
  id: string;
  kind: 'entity' | 'assertion';
  subjectId?: string;
  predicate?: string;
  objectId?: string;
  literalValue?: string;
  confidence: number;
}

interface GroundingEnvelope {
  status: 'grounded' | 'insufficient_evidence';
  answerClassification: 'inference' | 'unknown';
  evidenceCoverage: 'partial' | 'none';
  confidence: number;
  evidence: GroundingEvidence[];
}

async function buildGroundingEnvelope(
  ctx: RequestContext,
  sources: Array<{ id?: string; similarity?: number }>,
): Promise<GroundingEnvelope> {
  const entitySources = sources.filter((source) => typeof source?.id === 'string');
  if (!entitySources.length) {
    return {
      status: 'insufficient_evidence',
      answerClassification: 'unknown',
      evidenceCoverage: 'none',
      confidence: 0,
      evidence: [],
    };
  }

  const assertionGroups = await Promise.all(
    entitySources.slice(0, 10).map((source) => ctx.db.getAssertions({ subjectId: source.id, limit: 8 })),
  );
  const assertions = assertionGroups.flat().slice(0, 30);
  const entityEvidence: GroundingEvidence[] = entitySources.slice(0, 12).map((source) => ({
    id: source.id!,
    kind: 'entity',
    confidence: Number.isFinite(source.similarity) ? Math.max(0, Math.min(1, Number(source.similarity))) : 0.6,
  }));
  const assertionEvidence: GroundingEvidence[] = assertions.map((assertion: Assertion) => ({
    id: assertion.id,
    kind: 'assertion',
    subjectId: assertion.subject_id,
    predicate: assertion.predicate,
    objectId: assertion.object_id,
    literalValue: assertion.literal_value,
    confidence: assertion.confidence,
  }));
  const evidence = [...assertionEvidence, ...entityEvidence];
  const confidence = evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length;

  return {
    status: 'grounded',
    answerClassification: 'inference',
    evidenceCoverage: 'partial',
    confidence: Number(confidence.toFixed(3)),
    evidence,
  };
}

// ── Focus-Stack 适配：话题沉淀 ──
// 多轮"问大脑/决策"聊出结论后，自动把该话题压缩成一条长期记忆。按"首问"去重：
// 同一话题越聊越深就更新同一条，不重复堆。打 auto_sediment 标记，可追溯/可过滤。
async function sedimentThread(
  ctx: RequestContext,
  firstQuestion: string,
  conclusion: string,
  citedIds: string[],
): Promise<void> {
  try {
    const title = (firstQuestion || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!title || !conclusion) return;
    const existing = await ctx.db.searchEntities(title, 5, 'memory' as any);
    const dup = existing.find((e: any) => e.type === 'memory' && (e.name || '').trim() === title);
    if (dup) {
      await ctx.db.updateEntity(dup.id, { description: conclusion });
      ctx.db.bumpAccessCounts([dup.id]).catch(() => {});
      return;
    }
    let embedding: number[] | undefined;
    try { embedding = (await ctx.embeddingService.embed(`${title}: ${conclusion}`)).embedding; } catch { /* 无向量也存 */ }
    const ent = await ctx.db.addEntity({
      name: title,
      type: 'memory' as any,
      description: conclusion,
      metadata: { provenance: { source: 'auto_sediment', tool: 'graph_answer', at: new Date().toISOString() } },
      embedding,
    });
    // 连到引用过的记忆，让沉淀进图谱（最多 3 条）
    for (const cid of (citedIds || []).slice(0, 3)) {
      if (cid && cid !== ent.id) {
        try { await ctx.db.addRelationship({ source_id: ent.id, target_id: cid, type: 'references' as any, description: '自动沉淀引用', weight: 1 }); } catch { /* 边失败不阻塞 */ }
      }
    }
  } catch { /* 沉淀失败绝不影响回答 */ }
}

// ── shared: retrieve decision context ──

interface DecisionContextData {
  situation: string;
  principles: any[];
  relevantMemories: any[];
  conflicts: any[];
  graphContext: AggregatedGraphContext;
}

async function retrieveDecisionContext(
  ctx: RequestContext,
  situation: string,
  limit: number,
): Promise<DecisionContextData> {
  const pool = Math.max(
    limit * RETRIEVAL_CONFIG.candidatePoolMultiplier,
    RETRIEVAL_CONFIG.candidatePoolMinimum,
  );
  const textResults = await ctx.db.searchEntities(situation, pool);
  let vectorResults: any[] = [];
  try {
    const embResult = await withTimeout(
      ctx.embeddingService.embed(situation),
      MCP_EMBEDDING_TIMEOUT_MS,
      'embedding timeout',
    );
    assertEvaluationEmbeddingReady(ctx.embeddingService.getStatus());
    vectorResults = await ctx.db.vectorSearch(embResult.embedding, pool);
  } catch (error) {
    rethrowEvaluationEmbeddingFailure(error);
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
  // 时间词召回：查询含"昨天/上周/这个月"等时，把该时间窗内的实体并入候选
  const tw = parseTimeWindow(situation);
  if (tw) {
    try {
      const timed = await ctx.db.getEntitiesByTimeWindow(tw.start, tw.end, pool);
      for (const item of timed) {
        if (item?.id && !seen.has(item.id)) { seen.add(item.id); candidates.push(item); }
      }
    } catch { /* ignore */ }
  }

  const graphSeeds = rankMemoryCandidates(situation, candidates, {
    decisionMode: true,
    config: RETRIEVAL_CONFIG,
  });
  const graphContext = await retrieveGraphContext(ctx, graphSeeds, limit);
  for (const item of graphContext.nodes) {
    if (item?.id && !seen.has(item.id)) {
      seen.add(item.id);
      candidates.push(item);
    }
  }

  // 宽召回后用 LLM 重排挑出真正相关的 top-limit（救弱 embedding 的中文召回）
  const relevantMemories = (await rerankByLlm(ctx, situation, candidates, limit, { decisionMode: true }))
    .filter((item) => memoryCandidateScore(situation, item, {
      decisionMode: true,
      config: RETRIEVAL_CONFIG,
    }) > RETRIEVAL_CONFIG.minimumLexicalScore);

  const corePrincipleCandidates = await ctx.db.getCorePrinciples();
  // 核心原则是用户的长期约束，但不能绕过相关性判断全量进入回答。
  // LLM 不可用时 rerankByLlm 会退化为原序截断，至少保证噪声被硬性封顶。
  const relevantCorePrinciples = selectRelevantPrinciples(
    situation,
    corePrincipleCandidates,
    CORE_PRINCIPLE_CAP,
  );
  const seenPrincipleIds = new Set(relevantCorePrinciples.map((p: any) => p.id));
  const searchPrinciples = relevantMemories.filter(
    (m) => m.type === 'principle' && !seenPrincipleIds.has(m.id)
  );
  const principles = [...relevantCorePrinciples, ...searchPrinciples];

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

  return { situation, principles, relevantMemories, conflicts: conflictPairs, graphContext };
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
      const emb = await withTimeout(
        ctx.embeddingService.embed(query),
        MCP_EMBEDDING_TIMEOUT_MS,
        'embedding timeout',
      );
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

// ── MCP streamable-HTTP 传输：让客户端直接连 http://localhost:3001/mcp(带 token)，
//    不用启 stdio 代理、不用写各家配置文件。复用现有工具执行(回环到 /api/mcp/tool)。──

const MCP_HTTP_INSTRUCTIONS = `You are connected to Omni-Context, the user's long-term memory and decision support system.

Before answering any substantive question:
1. Call \`unified_memory_search\` with key terms from the user's question to check whether they've discussed this topic before.
2. If the user is choosing between options or making a decision, call \`get_decision_context\` with their situation as the \`situation\` argument.
3. Cite matched memories by name in your answer so the user can verify.
4. At the end of a substantive conversation that produced a conclusion, call \`save_conclusion\` to persist the key takeaway.

These tools are read-cheap; over-call rather than under-call.`;

function rpcResult(id: any, result: any) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function rpcError(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// 进程内回环调用现有 REST 工具端点，复用全部工具执行逻辑（含鉴权）
async function callToolViaLoopback(name: string, args: any): Promise<any> {
  const port = process.env.PORT || '3001';
  // 连服务器实际监听的地址：HOST 指定了具体 LAN IP 时用它，否则回环
  const host = process.env.HOST && process.env.HOST !== '0.0.0.0' ? process.env.HOST : '127.0.0.1';
  const token = (process.env.LOCAL_API_TOKEN || '').trim();
  const resp = await fetch(`http://${host}:${port}/api/mcp/tool/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ arguments: args || {} }),
  });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const j = (await resp.json()) as any; if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return await resp.json();
}

async function handleMcpRpcMessage(msg: any): Promise<any | null> {
  const id = msg?.id;
  const method = msg?.method;
  const params = msg?.params || {};
  if (typeof method !== 'string') return null;
  if (method.startsWith('notifications/')) return null; // 通知不回响应

  try {
    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'omni-context', version: '2.0.0' },
        instructions: MCP_HTTP_INSTRUCTIONS,
      });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: mcpToolDefs.map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    }
    if (method === 'tools/call') {
      const name = params.name;
      if (!mcpToolDefs.some((t: any) => t.name === name)) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const data = await callToolViaLoopback(name, params.arguments || {});
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e: any) {
        // 工具执行失败用 isError 内容返回，让 AI 看到错误而非协议级失败
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${e?.message || String(e)}` }], isError: true });
      }
    }
    return rpcError(id, -32601, `Method not found: ${method}`);
  } catch (e: any) {
    return rpcError(id, -32603, e?.message || String(e));
  }
}

export const handleMcpRoutes = [
  {
    method: 'POST' as const,
    path: '/mcp',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const body = await parseBody<any>(req);
      let payload: any;
      if (Array.isArray(body)) {
        const results = (await Promise.all(body.map(handleMcpRpcMessage))).filter((r) => r !== null);
        payload = results.length ? results : null;
      } else {
        payload = await handleMcpRpcMessage(body);
      }
      if (payload === null) {
        res.statusCode = 202; // 仅通知，无响应体
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    },
  },
  {
    method: 'GET' as const,
    path: '/mcp',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse) => {
      // 不做服务端主动推送(SSE)，请求-响应足够
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method Not Allowed; use POST for JSON-RPC' }));
    },
  },
  {
    method: 'POST' as const,
    path: '/api/mcp/tool/:name',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const toolName = params.name;
      const body = await parseBody<{ arguments: any }>(req);
      const args = body.arguments || {};
      const startedAt = Date.now();
      const client = getClientLabel(req);
      const query = extractQuerySummary(args);

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
            const parsed = GetCoreContextSchema.parse(args);
            const corePrinciples = await ctx.db.getCorePrinciples();
            const selected = parsed.query
              ? selectRelevantPrinciples(parsed.query, corePrinciples, parsed.limit)
              : selectGeneralCorePrinciples(corePrinciples, parsed.limit);
            result = {
              role: 'system',
              content: `[Omni-Context Core Principles]

${selected.map((p, i) => `${i + 1}. **${p.name}**${p.description ? `\n   ${p.description}` : ''}`).join('\n')}

仅在与当前任务相关时遵循以上原则；不要把无关原则强行套用。`,
              totalCorePrinciples: corePrinciples.length,
              returnedPrinciples: selected.length,
              truncated: selected.length < corePrinciples.length,
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
            // 写入合并去重：同名同类型已存在则强化（bump + 补全描述）而非重复新建，
            // 避免外部 AI 反复写入把图谱堆成杂物。仅精确同名同类型才合并，保守不误并。
            try {
              const near = await ctx.db.searchEntities(parsed.name, 5, parsed.type as EntityType);
              const dup = near.find((e: any) =>
                e.type === parsed.type &&
                (e.name || '').trim().toLowerCase() === parsed.name.trim().toLowerCase()
              );
              if (dup) {
                ctx.db.bumpAccessCounts([dup.id]).catch(() => {});
                if (parsed.description && (!dup.description || dup.description.length < parsed.description.length)) {
                  await ctx.db.updateEntity(dup.id, { description: parsed.description });
                }
                result = { ...toCompactEntity(dup), merged: true };
                break;
              }
            } catch { /* 查重失败不阻塞新建 */ }
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
              // provenance：记录此实体由外部 AI 经哪个 MCP 工具写入，便于用户识别非本人沉淀的记忆
              metadata: { ...(parsed.metadata || {}), provenance: { source: 'external_ai', tool: 'add_entity', at: new Date().toISOString() } },
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
              savedRelationships.push(...await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor));
            } catch (err) {
              console.error('[MCP extract_from_capture] Conflict resolution failed:', err);
              throw err;
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
          case 'merge_entities': {
            const p = MergeEntitiesSchema.parse(args);
            await ctx.db.softMergeEntities(p.keepId, p.dropId);
            result = { kept: p.keepId, merged: p.dropId };
            break;
          }
          case 'set_core_principle': {
            const p = SetCoreSchema.parse(args);
            await ctx.db.setCorePrinciple(p.id, p.isCore);
            result = await ctx.db.getEntity(p.id);
            break;
          }
          case 'delete_entity': {
            const p = DeleteEntitySchema.parse(args);
            await ctx.db.hardDeleteEntity(p.id);
            result = { deleted: p.id };
            break;
          }
          case 'get_stats': {
            result = await ctx.db.getStats();
            break;
          }
          case 'vector_search': {
            const parsed = VectorSearchSchema.parse(args);
            try {
              const embResult = await withTimeout(
                ctx.embeddingService.embed(parsed.query),
                MCP_EMBEDDING_TIMEOUT_MS,
                'embedding timeout',
              );
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

            const umsPool = Math.max(
              limit * RETRIEVAL_CONFIG.candidatePoolMultiplier,
              RETRIEVAL_CONFIG.candidatePoolMinimum,
            );
            const resultsData: any = { textResults: [], vectorResults: [], graphContext: [] };
            resultsData.textResults = await ctx.db.searchEntities(parsed.query, umsPool);

            try {
              const embResult = await withTimeout(
                ctx.embeddingService.embed(parsed.query),
                MCP_EMBEDDING_TIMEOUT_MS,
                'embedding timeout',
              );
              assertEvaluationEmbeddingReady(ctx.embeddingService.getStatus());
              resultsData.vectorResults = await ctx.db.vectorSearch(embResult.embedding, umsPool);
            } catch (error) {
              rethrowEvaluationEmbeddingFailure(error);
            }

            const seenIds = new Set<string>();
            const unified: any[] = [];
            for (const source of [resultsData.textResults, resultsData.vectorResults]) {
              for (const item of source) {
                if (!seenIds.has(item.id)) {
                  seenIds.add(item.id);
                  unified.push(item);
                }
              }
            }

            // 时间词召回：把该时间窗内的实体并入候选
            const utw = parseTimeWindow(parsed.query);
            if (utw) {
              try {
                const timed = await ctx.db.getEntitiesByTimeWindow(utw.start, utw.end, umsPool);
                for (const item of timed) { if (item?.id && !seenIds.has(item.id)) { seenIds.add(item.id); unified.push(item); } }
              } catch { /* ignore */ }
            }

            if (includeRels) {
              const graphSeeds = rankMemoryCandidates(parsed.query, unified, { config: RETRIEVAL_CONFIG });
              resultsData.graphContext = await retrieveGraphContext(
                ctx,
                graphSeeds,
                limit,
                includeInvalidated,
              );
              for (const item of resultsData.graphContext.nodes) {
                if (item?.id && !seenIds.has(item.id)) {
                  seenIds.add(item.id);
                  unified.push(item);
                }
              }
            }

            // 宽召回后 LLM 重排，挑出真正相关的（救弱 embedding 的中文召回）
            const ranked = (await rerankByLlm(ctx, parsed.query, unified, limit * 2))
              .filter((item: any) => memoryCandidateScore(parsed.query, item, { config: RETRIEVAL_CONFIG }) > RETRIEVAL_CONFIG.minimumLexicalScore);

            let graphContext = resultsData.graphContext;
            if (graphContext && graphContext.nodes) {
              graphContext.nodes = graphContext.nodes.map(toCompactEntity);
            }

            // 隐式 access tracking（仅 MCP 路径）—— 只强化真正返回的
            const umsAccIds = [
              ...ranked.map((e: any) => e.id),
              ...(resultsData.graphContext?.nodes || []).map((n: any) => n.id),
            ].filter(Boolean);
            if (umsAccIds.length > 0) {
              ctx.db.bumpAccessCounts(umsAccIds).catch(() => {});
            }

            result = {
              results: ranked.map(toCompactEntity),
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

            const graphContext = ctxData.graphContext;

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

            const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
            const retrievalQuery = `${situation}\n${latestUserMessage?.content || ''}`.trim();
            const discussionContext = await retrieveDecisionContext(ctx, retrievalQuery, 6);
            const discussionSources = [...discussionContext.relevantMemories, ...discussionContext.principles]
              .filter((item, index, all) => item?.id && all.findIndex((candidate) => candidate?.id === item.id) === index)
              .slice(0, 10)
              .map(toCompactEntity);
            const evidenceBlock = discussionSources.length
              ? discussionSources.map((source, index) => `[${index + 1}] (${source.type}) ${source.name}: ${source.description || ''}`).join('\n')
              : '（本轮没有检索到相关记忆）';
            const conflictBlock = discussionContext.conflicts.length
              ? discussionContext.conflicts.map((conflict) => `- ${conflict.a.name} 与 ${conflict.b.name}: ${conflict.description || '存在冲突'}`).join('\n')
              : '（未发现相关冲突）';

            const systemPrompt = `你是一个决策讨论助手。用户正在讨论一个决策："""${situation}"""
每一轮都必须根据下面重新检索的当前记忆回答，而不是只依赖历史对话。重要事实需用 [编号] 标明依据；证据不足时明确说不知道并提出要补充的信息。帮助用户深入思考、质疑假设、补充视角。回复简洁、直接，使用中文。

本轮证据：
${evidenceBlock}

已知冲突：
${conflictBlock}`;

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

              result = {
                reply: data.choices?.[0]?.message?.content || '(no response)',
                sources: discussionSources,
                conflicts: discussionContext.conflicts,
              };
            } catch (e: any) {
              console.error('[discuss_decision] Failed:', e);
              result = { reply: '抱歉，讨论服务暂时不可用。', sources: discussionSources };
            }
            break;
          }
          case 'ask_memory': {
            // App 内「问大脑」：每轮都基于用户最新问题真实检索图谱，再让 LLM 据此作答。
            // 与 discuss_decision 不同——后者只基于既定 situation 聊天，不自查图谱。
            const messages: Array<{ role: string; content: string }> = Array.isArray(args.messages)
              ? args.messages.filter((m: any) => m && typeof m.content === 'string')
              : [];
            const lastUser = [...messages].reverse().find((m) => m.role === 'user');
            const question = (lastUser?.content || (typeof args.query === 'string' ? args.query : '') || '').trim();

            const llmConfig = ctx.extractor.getLlmConfig();
            if (!llmConfig.apiUrl) {
              sendError(res, 400, 'LLM_NOT_CONFIGURED');
              return;
            }
            if (!question) {
              result = { reply: '', sources: [] };
              break;
            }

            // grounding：复用决策上下文检索（融合文本+向量+原则+冲突）
            // 相关记忆优先于原则，避免原则多时把相关记忆挤出 12 条上限（既丢来源也丢 grounding）
            const ctxData = await retrieveDecisionContext(ctx, question, 6);
            const seenSrc = new Set<string>();
            const sources: any[] = [];
            for (const m of [...ctxData.relevantMemories, ...ctxData.principles]) {
              if (m && m.id && !seenSrc.has(m.id)) {
                seenSrc.add(m.id);
                sources.push(toCompactEntity(m));
              }
            }
            const cappedSources = sources.slice(0, 12);
            const grounding = await buildGroundingEnvelope(ctx, cappedSources);
            if (grounding.status === 'insufficient_evidence') {
              result = {
                reply: '我的记忆里暂时没有足够证据回答这部分。',
                sources: [],
                grounding,
              };
              break;
            }
            const memoryBlockItems = cappedSources
              .map((m: any, i: number) => ({ item: m, index: i + 1 }))
              .filter(({ item }) => item.type !== 'principle');
            const principleBlockItems = cappedSources
              .map((m: any, i: number) => ({ item: m, index: i + 1 }))
              .filter(({ item }) => item.type === 'principle');
            const memoryBlock = memoryBlockItems.length
              ? memoryBlockItems
                  .map(({ item, index }) => `[${index}] (${item.type}) ${item.name}: ${item.description || ''}`)
                  .join('\n')
              : '（没有检索到相关记忆）';
            const principleBlock = principleBlockItems.length
              ? principleBlockItems
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
              result = {
                reply: data.choices?.[0]?.message?.content || '(no response)',
                sources: cappedSources,
                grounding,
              };
            } catch (e) {
              console.error('[ask_memory] Failed:', e);
              result = { reply: '抱歉，问答服务暂时不可用。', sources: cappedSources, grounding };
            }
            break;
          }
          case 'graph_answer': {
            // 图谱原生回答：结构化输出(结论 + 每条依据引用节点) + 命中子图的边，供右栏答案卡 + 图谱高亮
            const gaMessages: Array<{ role: string; content: string }> = Array.isArray(args.messages)
              ? args.messages.filter((m: any) => m && typeof m.content === 'string')
              : [];
            const gaLastUser = [...gaMessages].reverse().find((m) => m.role === 'user');
            const gaQuestion = (gaLastUser?.content || (typeof args.query === 'string' ? args.query : '') || '').trim();

            const gaLlm = ctx.extractor.getLlmConfig();
            if (!gaLlm.apiUrl) { sendError(res, 400, 'LLM_NOT_CONFIGURED'); return; }
            if (!gaQuestion) { result = { conclusion: '', reasons: [], sources: [], edges: [], citedEntityIds: [] }; break; }

            // 检索 + agentic 自主补检索
            const gaCtx = await retrieveDecisionContext(ctx, gaQuestion, 6);
            try {
              const extra = await agenticEnrichMemories(ctx, gaQuestion, gaCtx.relevantMemories);
              const known = new Set(gaCtx.relevantMemories.map((m: any) => m.id));
              for (const e of extra) { if (!known.has(e.id)) { known.add(e.id); gaCtx.relevantMemories.push(e); } }
            } catch { /* additive */ }

            // 来源：相关记忆优先，原则其次，去重后取前 10（编号即给 LLM 引用用）
            const gaSeen = new Set<string>();
            const gaSources: any[] = [];
            for (const m of [...gaCtx.relevantMemories, ...gaCtx.principles]) {
              if (m && m.id && !gaSeen.has(m.id)) { gaSeen.add(m.id); gaSources.push(toCompactEntity(m)); }
            }
            const gaCapped = gaSources.slice(0, 10);
            const gaGrounding = await buildGroundingEnvelope(ctx, gaCapped);
            if (gaGrounding.status === 'insufficient_evidence') {
              result = {
                conclusion: '我的记忆里暂时没有足够证据回答这部分。',
                reasons: [],
                questions: ['你希望我基于哪些事实、约束或历史记录来回答？'],
                isDecision: false,
                sources: [],
                edges: [],
                citedEntityIds: [],
                grounding: gaGrounding,
              };
              break;
            }
            const gaIds = new Set(gaCapped.map((s) => s.id));

            // 命中节点之间的关系（构成高亮子图的边 + 喂给 LLM 做图谱原生推理）
            const gaEdges: Array<{ source: string; target: string; type: string }> = [];
            const gaSeenEdge = new Set<string>();
            for (const s of gaCapped) {
              const rels = await ctx.db.getRelationshipsForEntity(s.id);
              for (const r of rels) {
                if (gaIds.has(r.source_id) && gaIds.has(r.target_id)) {
                  const k = `${r.source_id}|${r.target_id}|${r.type}`;
                  if (!gaSeenEdge.has(k)) { gaSeenEdge.add(k); gaEdges.push({ source: r.source_id, target: r.target_id, type: r.type }); }
                }
              }
            }

            const gaMemoryItems = gaCapped
              .map((m: any, i: number) => ({ item: m, index: i + 1 }))
              .filter(({ item }) => item.type !== 'principle');
            const gaPrincipleItems = gaCapped
              .map((m: any, i: number) => ({ item: m, index: i + 1 }))
              .filter(({ item }) => item.type === 'principle');
            const gaCtxBlock = gaMemoryItems.length
              ? gaMemoryItems.map(({ item, index }) => `[${index}] (${item.type}) ${item.name}: ${item.description || ''}`).join('\n')
              : '（没有检索到相关记忆）';
            const gaPrincipleBlock = gaPrincipleItems.length
              ? gaPrincipleItems.map(({ item, index }) => `[${index}] (${item.type}) ${item.name}: ${item.description || ''}`).join('\n')
              : '（没有相关核心原则）';
            const gaConnBlock = gaEdges.length
              ? gaEdges.map((e) => {
                  const sn = gaCapped.find((x) => x.id === e.source)?.name || '?';
                  const tn = gaCapped.find((x) => x.id === e.target)?.name || '?';
                  return `- ${sn} --[${e.type}]--> ${tn}`;
                }).join('\n')
              : '（无已知关系）';

            const gaSystem = `你是用户的「第二大脑」。基于下面从用户本地知识图谱检索到的记忆、少量核心原则、以及它们之间的关系来回答。
要求：
1. 先给一句话结论(conclusion)，直接、口语化；
2. 给 2-4 条依据(reasons)，每条尽量用 refs 数组引用上面记忆的编号；
3. 善用关系信息(冲突/取代/支持/源于)让推理有据，比如"X 和 Y 冲突过"；
4. 核心原则仅在确与本问题相关时参考或引用；无关原则必须忽略，不能为了引用而引用；
5. 若现有记忆不足以给出有深度的回答（尤其抉择类）：不要硬凑一个浅答案。conclusion 里如实说"要答好这个我得先了解一些情况"，并在 questions 里列出 3-6 个具体、全面的澄清问题——覆盖目标、约束、资源、时间、风险偏好、已有选项等关键维度，别泛泛而问；
6. 判断用户是不是在做一个抉择(该不该/选哪个/要不要/选型)，是则 is_decision=true：
   - reasons 用 ＋/－ 开头表达利弊权衡；
   - 即便能给倾向，也尽量在 questions 里补 2-4 个能让结论更准的关键问题（信息确实够了才可少或为空）。
只输出 JSON：{"conclusion":"...","reasons":[{"text":"...","refs":[1,2]}],"questions":["..."],"is_decision":false}
使用用户提问所用的语言。

相关记忆：
${gaCtxBlock}

核心原则（仅在确与本问题相关时参考/引用，否则忽略）：
${gaPrincipleBlock}

它们之间的关系：
${gaConnBlock}`;

            try {
              // 带对话历史调用，让追问有上下文；要求 JSON 输出
              const gaController = new AbortController();
              const gaTimeout = setTimeout(() => gaController.abort(), 60000);
              let raw = '';
              try {
                const llmRes = await mcpLlmFetch(`${gaLlm.apiUrl}/chat/completions`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(gaLlm.apiKey ? { Authorization: `Bearer ${gaLlm.apiKey}` } : {}) },
                  body: JSON.stringify({
                    model: gaLlm.model,
                    messages: [{ role: 'system', content: gaSystem }, ...(gaMessages.length ? gaMessages.slice(-8) : [{ role: 'user', content: gaQuestion }])],
                    max_tokens: 1200,
                    temperature: 0.4,
                    response_format: { type: 'json_object' },
                  }),
                  signal: gaController.signal,
                });
                if (!llmRes.ok) throw new Error(`LLM API error: ${llmRes.status}`);
                const d = (await llmRes.json()) as { choices: Array<{ message: { content: string } }> };
                raw = d.choices?.[0]?.message?.content || '';
              } finally { clearTimeout(gaTimeout); }
              const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
              const parsed = JSON.parse(jsonMatch ? jsonMatch[1].trim() : raw.trim());
              const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 5) : [];
              result = {
                conclusion: typeof parsed.conclusion === 'string' ? parsed.conclusion : '',
                reasons: reasons.map((r: any) => ({
                  text: String(r?.text || ''),
                  entityIds: Array.isArray(r?.refs)
                    ? r.refs.map((n: any) => gaCapped[Number(n) - 1]?.id).filter(Boolean)
                    : [],
                })).filter((r: any) => r.text),
                questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 6).filter((q: any) => typeof q === 'string' && q.trim()) : [],
                isDecision: !!parsed.is_decision,
                sources: gaCapped,
                edges: gaEdges,
                citedEntityIds: gaCapped.map((s) => s.id),
                grounding: gaGrounding,
              };
              // 多轮话题聊出结论 → 自动沉淀（按首问去重，越聊越深更新同一条）。不阻塞返回。
              const gaUserTurns = gaMessages.filter((m) => m.role === 'user');
              if (gaUserTurns.length >= 2 && typeof parsed.conclusion === 'string' && parsed.conclusion.trim()) {
                void sedimentThread(ctx, gaUserTurns[0].content, parsed.conclusion.trim(), gaCapped.map((s) => s.id));
              }
            } catch (e: any) {
              if (e?.message === 'LLM_NOT_CONFIGURED') { sendError(res, 400, 'LLM_NOT_CONFIGURED'); return; }
              console.error('[graph_answer] Failed:', e);
              result = { conclusion: '抱歉，回答服务暂时不可用。', reasons: [], sources: gaCapped, edges: gaEdges, citedEntityIds: gaCapped.map((s) => s.id), grounding: gaGrounding };
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
              // provenance：save_conclusion 是外部 AI 把对话结论写回图谱，标注来源
              const saved = await ctx.db.addEntity({
                ...entity,
                tags: [...new Set([...(entity.tags || []), ...(tags || [])])],
                metadata: { ...((entity as any).metadata || {}), provenance: { source: 'external_ai', tool: 'save_conclusion', at: new Date().toISOString() } },
              });
              savedEntityIds.push(saved.id);
            }

            for (const update of resolution.entitiesToUpdate) {
              await ctx.db.updateEntity(update.id, {
                description: update.description,
                tags: [...new Set([...(update.tags || []), ...(tags || [])])],
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
              throw err;
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
            const { situation, conclusion, cited_entity_ids, confidence, alternatives, previous_decision_id } = parsed;

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

            // 同一会话里显式承接上一个决策（决策链：A→B→C）
            if (previous_decision_id && previous_decision_id !== decisionEntity.id) {
              try {
                await ctx.db.addRelationship({
                  source_id: decisionEntity.id,
                  target_id: previous_decision_id,
                  type: 'relates_to',
                  description: '决策链：承接上一个决策',
                  weight: 1.0,
                });
              } catch {
                // duplicate is fine
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

        const matchedEntities = collectMatchedEntities(result);
        const behaviorEvents: import('../../behavior/events.js').BehaviorEventInput[] = [];
        if (['search_entities', 'vector_search', 'unified_memory_search', 'get_decision_context', 'ask_memory', 'graph_answer'].includes(toolName)) {
          behaviorEvents.push({ eventType: 'searched', topic: query, intent: 'informational' });
        }
        for (const entity of matchedEntities) {
          behaviorEvents.push({ eventType: 'retrieved', entityId: entity.id, topic: query, intent: 'informational' });
          if (['ask_memory', 'graph_answer', 'analyze_decision', 'discuss_decision'].includes(toolName)) {
            behaviorEvents.push({ eventType: 'cited', entityId: entity.id, topic: query, intent: 'informational' });
          }
        }
        if (['record_capture', 'extract_from_capture', 'save_conclusion'].includes(toolName)) {
          behaviorEvents.push({ eventType: 'captured', topic: query, intent: 'action' });
        }
        if (toolName === 'update_entity') {
          behaviorEvents.push({ eventType: 'edited', entityId: typeof args.id === 'string' ? args.id : undefined, intent: 'action' });
        }
        if (toolName === 'save_decision') {
          behaviorEvents.push({ eventType: 'decided', entityId: typeof result?.id === 'string' ? result.id : undefined, topic: query, intent: 'action' });
        }
        try {
          await ctx.db.recordBehaviorEvents(behaviorEvents);
        } catch (behaviorError) {
          console.warn(`[MCP behavior] failed to record ${toolName}:`, behaviorError);
        }

        ctx.db.addMcpUsageLog({
          toolName,
          client,
          query,
          matchedEntities,
          success: true,
          durationMs: Date.now() - startedAt,
        }).catch(() => {});
        sendResponse(res, 200, result);
      } catch (error) {
        console.error(`MCP tool execution error (${toolName}):`, error);
        ctx.db.addMcpUsageLog({
          toolName,
          client,
          query,
          matchedEntities: [],
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        }).catch(() => {});
        sendError(res, 500, error instanceof Error ? error.message : String(error));
      }
    }
  },
  {
    method: 'GET' as const,
    path: '/api/mcp/usage',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const limit = q.get('limit') ? Number(q.get('limit')) : 20;
      sendResponse(res, 200, await ctx.db.getRecentMcpUsage(limit));
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
          const entities = await ctx.db.all<any>(
            `SELECT id, name, type, description, tags, created_at, access_count
             FROM entities
             WHERE json_extract(metadata, '$.merged_into') IS NULL
             ORDER BY access_count DESC, updated_at DESC
             LIMIT 100`,
          );
          const relationships = await ctx.db.all(
            `SELECT id, source_id, target_id, type, description, weight
             FROM relationships
             WHERE valid_until IS NULL OR valid_until > datetime('now')
             ORDER BY weight DESC
             LIMIT 150`,
          );
          contents = {
            entities: entities.map((entity) => ({
              ...toCompactEntity({
                ...entity,
                tags: entity.tags ? JSON.parse(entity.tags) : undefined,
              }),
            })),
            relationships,
            truncated: true,
            note: 'Use unified_memory_search or get_graph_neighborhood for topic-specific retrieval.',
          };
        } else if (uri === 'memory://core-principles') {
          const all = await ctx.db.getCorePrinciples();
          const items = selectGeneralCorePrinciples(all, 20).map(toCompactEntity);
          contents = {
            items,
            total: all.length,
            returned: items.length,
            truncated: items.length < all.length,
          };
        } else if (uri === 'memory://stats') {
          contents = await ctx.db.getStats();
        } else {
          const entityTypeMatch = uri.match(/^memory:\/\/entities\/(.+)$/);
          if (entityTypeMatch) {
            const type = decodeURIComponent(entityTypeMatch[1]);
            const all = await ctx.db.getEntitiesByType(type);
            const items = rankMemoryCandidates(type, all).slice(0, 100).map(toCompactEntity);
            contents = {
              items,
              total: all.length,
              returned: items.length,
              truncated: items.length < all.length,
              note: 'Use search_entities or unified_memory_search for precise retrieval.',
            };
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
