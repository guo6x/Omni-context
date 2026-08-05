import { Database } from '../db/sqlite.js';
import { GraphRAGExtractor } from '../graphrag/extractor.js';
import { ArchivalMemory } from '../memory/archival-memory.js';
import { EmbeddingService } from '../embedding/service.js';
import { MemoryDecayScheduler } from '../memory/decay-scheduler.js';
import { AgentLoop } from '../agent/agent-loop.js';
import { z } from 'zod';
import { BusinessError, formatResourceResult } from './errors.js';
import { resolveEntities } from '../graphrag/entity-resolver.js';
import { resolveConflicts } from '../graphrag/conflict-resolver.js';
import { v4 as uuidv4 } from 'uuid';
import type { EntityType, RelationshipType, Entity, Assertion } from '../shared-types.js';
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
  AnalyzeDecisionResultSchema,
  DiscussDecisionSchema,
  GetDecisionLineageSchema,
  RecordDecisionOutcomeSchema,
  GetCoreContextSchema,
  DeleteEntitySchema,
  SetCoreSchema,
  MergeEntitiesSchema,
  tools as mcpToolDefs,
} from '../mcp-tools.js';
import { buildDecisionMetadata, getRecursiveDecisionLineage, recordDecisionOutcome } from '../decision/decision-store.js';
import { parseTimeWindow } from '../utils/time-window.js';
import {
  capGraphContext,
  memoryCandidateScore,
  rankMemoryCandidates,
  selectGeneralCorePrinciples,
  selectRelevantPrinciples,
} from '../mcp-retrieval.js';
import { createAuditedAiFetch } from '../security/audited-ai-fetch.js';
import { assertEvaluationEmbeddingReady, loadRetrievalConfig, retrievalConfigHash } from '../retrieval/config.js';
import { parseTemporalQuery, temporalOptsFromQuery, filterAssertionsByTemporal, filterEntitiesByTemporal } from '../retrieval/temporal-layer.js';
import { reciprocalRankFuse, type FusedRetrievalCandidate, type RetrievalSourceTrace } from '../retrieval/fusion.js';
import {
  buildEvidenceGroupPassage,
  buildRerankerEvidenceSummary,
  detectEvidenceIntent,
  EVIDENCE_GROUP_VERSION,
  EVIDENCE_SELECTOR_VERSION,
  groupFusedEvidence,
  isolateRawEventChannels,
  queryAwareTemporalOptions,
  RERANKER_SUMMARY_VERSION,
  selectEvidenceSet,
  type EvidenceGroup,
} from '../retrieval/evidence-selector.js';
import { writeRetrievalTrace } from '../retrieval/trace.js';

const CORE_PRINCIPLE_CAP = 3;
const mcpLlmFetch = createAuditedAiFetch({ purpose: 'api.decision-intelligence', kind: 'llm' });
const MCP_EMBEDDING_TIMEOUT_MS = Number(process.env.MCP_EMBEDDING_TIMEOUT_MS || 2500);
const MCP_RERANK_TIMEOUT_MS = Number(process.env.MCP_RERANK_TIMEOUT_MS || 2500);
const RETRIEVAL_CONFIG = loadRetrievalConfig();

export interface DispatchCtx {
  db: Database;
  extractor: GraphRAGExtractor;
  embeddingService: EmbeddingService;
  archivalMemory: ArchivalMemory;
  decayScheduler?: MemoryDecayScheduler;
  agentLoop?: AgentLoop | null;
}

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

function rethrowEvaluationEmbeddingFailure(error: unknown): void {
  if (error instanceof Error && error.message.startsWith('EVALUATION_EMBEDDING_UNAVAILABLE')) {
    throw error;
  }
}

// ── shared: LLM 重排 ──
// 弱 embedding（尤其中文）召回的候选相似度挤在一起、噪声多。先宽召回，再用 LLM 按真实相关度
// 重排挑出 topN。LLM 不可用/超时则优雅降级为原序截断，绝不阻塞检索。
async function rerankByLlm(
  ctx: DispatchCtx,
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
    .map((c, i) => {
      const structured = typeof c.rerankerSummary === 'string' ? c.rerankerSummary : '';
      return structured
        ? `[${i}] ${structured.slice(0, 600)}`
        : `[${i}] (${c.type}) ${c.name}: ${(c.description || '').slice(0, 120)}`;
    })
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
  ctx: DispatchCtx,
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
  type: 'entity' | 'assertion';
  subjectId?: string;
  predicate?: string;
  originalPredicate?: string;
  objectId?: string;
  literalValue?: string;
  fact?: string;
  passage?: string;
  subjectName?: string;
  objectName?: string;
  eventTime?: string;
  confidence: number;
  source_span: string | null;
  temporal_status: 'current' | 'historical' | 'invalidated';
  valid_from: string | null;
  valid_until: string | null;
  invalidated_at: string | null;
  provenance: Record<string, unknown> | null;
  retrieval_sources?: RetrievalSourceTrace[];
  fused_rank?: number;
  fused_score?: number;
}

interface ReadableAssertionCandidate {
  id: string;
  assertion: Assertion;
  subjectName: string;
  objectName?: string;
  passage: string;
  distance?: number;
  similarity?: number;
}

interface GroundingEnvelope {
  status: 'grounded' | 'insufficient_evidence';
  answerClassification: 'inference' | 'unknown';
  evidenceCoverage: 'partial' | 'none';
  confidence: number;
  evidence: GroundingEvidence[];
}

async function buildGroundingEnvelope(
  ctx: DispatchCtx,
  sources: Array<{ id?: string; similarity?: number }>,
  semanticAssertions: Array<FusedRetrievalCandidate<ReadableAssertionCandidate>> = [],
): Promise<GroundingEnvelope> {
  const entitySources = sources.filter((source) => typeof source?.id === 'string');
  if (!entitySources.length && !semanticAssertions.length) {
    return {
      status: 'insufficient_evidence',
      answerClassification: 'unknown',
      evidenceCoverage: 'none',
      confidence: 0,
      evidence: [],
    };
  }

  // Subject attachment remains a bounded compatibility fallback. The primary
  // path is assertion-level semantic/FTS retrieval supplied above.
  const assertionGroups = semanticAssertions.length ? [] : await Promise.all(
    entitySources.slice(0, 4).map((source) => ctx.db.getAssertions({ subjectId: source.id, limit: 2 })),
  );
  const assertions = assertionGroups.flat().slice(0, 8);
  const now = Date.now();
  const isPast = (value?: string) => value ? Date.parse(value) <= now : false;
  const entityEvidence: GroundingEvidence[] = entitySources.slice(0, 12).map((source) => ({
    id: source.id!,
    type: 'entity',
    confidence: Number.isFinite(source.similarity) ? Math.max(0, Math.min(1, Number(source.similarity))) : 0.6,
    source_span: null,
    temporal_status: 'current',
    valid_from: null,
    valid_until: null,
    invalidated_at: null,
    provenance: null,
  }));
  const fallbackAssertionEvidence: GroundingEvidence[] = assertions.map((assertion: Assertion) => ({
    id: assertion.id,
    type: 'assertion',
    subjectId: assertion.subject_id,
    predicate: assertion.predicate,
    originalPredicate: assertion.original_predicate || assertion.predicate,
    objectId: assertion.object_id,
    literalValue: assertion.literal_value,
    confidence: assertion.confidence,
    source_span: assertion.source_span ?? null,
    temporal_status: isPast(assertion.invalidated_at) || isPast(assertion.valid_until) ? 'historical' : 'current',
    valid_from: assertion.valid_from ?? null,
    valid_until: assertion.valid_until ?? null,
    invalidated_at: assertion.invalidated_at ?? null,
    provenance: assertion.provenance ?? null,
    retrieval_sources: [{ source: 'subject_attachment', rawRank: 1, rawDistance: null, normalizedScore: assertion.confidence, weight: RETRIEVAL_CONFIG.subjectAttachmentWeight }],
  }));
  const assertionEvidence: GroundingEvidence[] = semanticAssertions.slice(0, 30).map((candidate) => {
    const { assertion, subjectName, objectName, passage } = candidate.value;
    const temporalStatus = assertion.invalidated_at
      ? 'invalidated'
      : (isPast(assertion.valid_until) ? 'historical' : 'current');
    const fact = passage.split(/\r?\n/, 1)[0].replace(/^passage:\s*/i, '');
    return {
      id: assertion.id,
      type: 'assertion',
      subjectId: assertion.subject_id,
      predicate: assertion.predicate,
      originalPredicate: assertion.original_predicate || assertion.predicate,
      objectId: assertion.object_id,
      literalValue: assertion.literal_value,
      fact,
      passage,
      subjectName,
      objectName,
      eventTime: assertion.event_time,
      confidence: assertion.confidence,
      source_span: assertion.source_span ?? null,
      temporal_status: temporalStatus,
      valid_from: assertion.valid_from ?? null,
      valid_until: assertion.valid_until ?? null,
      invalidated_at: assertion.invalidated_at ?? null,
      provenance: assertion.provenance ?? null,
      retrieval_sources: candidate.sources,
      fused_rank: candidate.fusedRank,
      fused_score: Number(candidate.fusedScore.toFixed(8)),
    };
  });
  // Assertions carry claim-level provenance and are the formal evidence unit.
  // Entity fallback is permitted only when the retrieved entities have no assertions.
  const evidence = assertionEvidence.length > 0
    ? assertionEvidence
    : (fallbackAssertionEvidence.length > 0 ? fallbackAssertionEvidence : entityEvidence);
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
  ctx: DispatchCtx,
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
  ctx: DispatchCtx,
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
      ctx.embeddingService.embedQuery(situation),
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

  // 时间感知过滤：根据 situation 中的时间词（"现在"/"当时"/"去年"等），
  // 剔除已失效事实或按具体日期过滤，确保 reranker 只看到时间上有效的候选。
  const decTemporalOpts = temporalOptsFromQuery(situation);
  const decTemporallyFiltered = filterEntitiesByTemporal(candidates, decTemporalOpts);

  // 宽召回后用 LLM 重排挑出真正相关的 top-limit（救弱 embedding 的中文召回）
  const relevantMemories = (await rerankByLlm(ctx, situation, decTemporallyFiltered, limit, { decisionMode: true }))
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
  ctx: DispatchCtx,
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
  ctx: DispatchCtx,
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
        ctx.embeddingService.embedQuery(query),
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


export class McpBusinessDispatcher {
  private ctx: DispatchCtx;

  constructor(deps: {
    db: Database;
    extractor: GraphRAGExtractor;
    embeddingService: EmbeddingService;
    archivalMemory?: ArchivalMemory;
    decayScheduler?: MemoryDecayScheduler;
    agentLoop?: AgentLoop | null;
  }) {
    this.ctx = {
      db: deps.db,
      extractor: deps.extractor,
      embeddingService: deps.embeddingService,
      archivalMemory: deps.archivalMemory ?? new ArchivalMemory(deps.db),
      decayScheduler: deps.decayScheduler,
      agentLoop: deps.agentLoop,
    };
  }

  async listTools() {
    return {
      tools: mcpToolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  }

  /**
   * Business dispatch: same input -> same business result on every transport.
   * Returns PLAIN business data; protocol adapters wrap it into their payloads.
   */
  async callTool(name: string, args: any): Promise<any> {
    const ctx = this.ctx;
    try {
      let result: any;
        switch (name) {
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
              throw new BusinessError('NOT_FOUND', `实体未找到: ${parsed.id}`);
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
              throw new BusinessError('NOT_FOUND', `源实体未找到: ${parsed.sourceId}`);
            }
            if (!target) {
              throw new BusinessError('NOT_FOUND', `目标实体未找到: ${parsed.targetId}`);
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

            for (const a of extractResult.assertions || []) {
              const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
              const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
              try {
                await ctx.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
              } catch (err) {
                console.warn('[MCP extract_from_capture] assertion write failed:', err);
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
                ctx.embeddingService.embedQuery(parsed.query),
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
            const umsTemporalOpts = queryAwareTemporalOptions(parsed.query, temporalOptsFromQuery(parsed.query));
            const umsTemporalQuery = parseTemporalQuery(parsed.query);
            const umsEvidenceIntent = detectEvidenceIntent(parsed.query);
            const umsTemporalMode = umsTemporalOpts.includeHistorical && !umsTemporalOpts.asOf
              ? 'historical'
              : umsTemporalQuery.mode;
            const resultsData: any = {
              textResults: [], vectorResults: [], assertionTextResults: [],
              assertionVectorResults: [], rawEventResults: [], graphContext: [], subjectAttachments: [],
            };
            resultsData.textResults = await ctx.db.searchEntities(parsed.query, umsPool);
            resultsData.assertionTextResults = await ctx.db.searchResolvedAssertions(parsed.query, umsPool);
            resultsData.rawEventResults = await ctx.db.searchRawEventAssertions(parsed.query, umsPool);

            try {
              const embResult = await withTimeout(
                ctx.embeddingService.embedQuery(parsed.query),
                MCP_EMBEDDING_TIMEOUT_MS,
                'embedding timeout',
              );
              assertEvaluationEmbeddingReady(ctx.embeddingService.getStatus());
              [resultsData.vectorResults, resultsData.assertionVectorResults] = await Promise.all([
                ctx.db.vectorSearch(embResult.embedding, umsPool),
                ctx.db.assertionVectorSearch(embResult.embedding, umsPool, umsTemporalOpts),
              ]);
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

            // 时间感知过滤：根据查询中的时间词，剔除已失效事实（"现在"/"当时"/"去年"等）
            const umsTemporallyFiltered = filterEntitiesByTemporal(unified, umsTemporalOpts);

            // Existing reranker still ranks entity navigation candidates. The
            // mixed assertion/entity pool below is also shown to it before the
            // final context is selected.
            const rankedEntities = (await rerankByLlm(ctx, parsed.query, umsTemporallyFiltered, limit * 2))
              .filter((item: any) => memoryCandidateScore(parsed.query, item, { config: RETRIEVAL_CONFIG }) > RETRIEVAL_CONFIG.minimumLexicalScore);

            const assertionTextResults = filterAssertionsByTemporal(
              resultsData.assertionTextResults.map((item: ReadableAssertionCandidate) => item.assertion),
              umsTemporalOpts,
            ).map((assertion: any) => resultsData.assertionTextResults.find((item: ReadableAssertionCandidate) => item.id === assertion.id));
            const attachmentGroups = await Promise.all(rankedEntities.slice(0, 4).map(async (entity: any) => {
              const attached = filterAssertionsByTemporal(
                await ctx.db.getAssertions({
                  subjectId: entity.id,
                  includeHistorical: umsTemporalOpts.includeHistorical,
                  limit: umsTemporalOpts.includeHistorical ? 8 : 2,
                }),
                umsTemporalOpts,
              ).filter((assertion) => assertion.provenance?.evidence_kind !== 'raw_event')
                .slice(0, umsTemporalOpts.includeHistorical ? 6 : 2);
              return Promise.all(attached.map((assertion) => ctx.db.getResolvedAssertion(assertion.id)));
            }));
            resultsData.subjectAttachments = attachmentGroups.flat().filter(Boolean);

            const channelIsolation = isolateRawEventChannels<ReadableAssertionCandidate | any>([
              {
                source: 'entity_vector', weight: RETRIEVAL_CONFIG.entityVectorWeight,
                items: resultsData.vectorResults.map((item: any) => ({ id: item.id, kind: 'entity' as const, value: item, score: item.similarity })),
              },
              {
                source: 'assertion_vector', weight: RETRIEVAL_CONFIG.assertionVectorWeight,
                items: resultsData.assertionVectorResults.map((item: ReadableAssertionCandidate) => ({ id: item.id, kind: 'assertion' as const, value: item, distance: item.distance, score: item.similarity })),
              },
              {
                source: 'entity_fts', weight: RETRIEVAL_CONFIG.entityFtsWeight,
                items: resultsData.textResults.map((item: any) => ({ id: item.id, kind: 'entity' as const, value: item })),
              },
              {
                source: 'assertion_fts', weight: RETRIEVAL_CONFIG.assertionFtsWeight,
                items: assertionTextResults.map((item: ReadableAssertionCandidate) => ({ id: item.id, kind: 'assertion' as const, value: item })),
              },
              {
                source: 'graph', weight: RETRIEVAL_CONFIG.graphWeight,
                items: (resultsData.graphContext?.nodes || []).map((item: any) => ({ id: item.id, kind: 'entity' as const, value: item })),
              },
              {
                source: 'subject_attachment', weight: RETRIEVAL_CONFIG.subjectAttachmentWeight,
                items: resultsData.subjectAttachments.map((item: ReadableAssertionCandidate) => ({ id: item.id, kind: 'assertion' as const, value: item })),
              },
              {
                source: 'raw_event_fallback', weight: RETRIEVAL_CONFIG.rawEventFallbackWeight,
                items: resultsData.rawEventResults.map((item: ReadableAssertionCandidate, index: number) => ({
                  id: item.id, kind: 'assertion' as const, value: item,
                  score: resultsData.rawEventResults.length <= 1
                    ? 1
                    : 1 - index / resultsData.rawEventResults.length,
                })),
              },
            ]);
            const isolatedItems = (source: string) => channelIsolation.lists.find((list) => list.source === source)?.items || [];
            const fused = reciprocalRankFuse<ReadableAssertionCandidate | any>(
              channelIsolation.lists,
              { rrfK: RETRIEVAL_CONFIG.rrfK },
            );
            const evidenceGroups = groupFusedEvidence(fused, { rrfK: RETRIEVAL_CONFIG.rrfK });
            const mixedForReranker = evidenceGroups.slice(0, umsPool).map((group) => {
              const rerankerSummary = buildRerankerEvidenceSummary(group);
              return {
                id: group.groupId,
                name: rerankerSummary.split(/\r?\n/, 1)[0],
                type: 'evidence_group',
                description: rerankerSummary,
                rerankerSummary,
                similarity: group.retrievalSources[0]?.normalizedScore,
              };
            });
            const rerankedMixed = await rerankByLlm(ctx, parsed.query, mixedForReranker, Math.min(umsPool, limit * 4));
            const rerankOrder = new Map(rerankedMixed.map((item: any, index: number) => [
              item.id, index,
            ]));
            const rankedGroups = [...evidenceGroups].sort((a, b) => {
              const aOrder = rerankOrder.get(a.groupId);
              const bOrder = rerankOrder.get(b.groupId);
              if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
              return a.rrfRank - b.rrfRank;
            }).map((group, index) => ({ ...group, rerankerRank: index + 1 }));
            const assertionGroups = rankedGroups.filter((group) => group.normalizedAssertions.length > 0 || group.rawEvents.length > 0);
            const selection = selectEvidenceSet({
              query: parsed.query,
              rankedGroups: assertionGroups,
              limit,
              temporalMode: umsTemporalMode,
              includeInvalidated: includeInvalidated || umsEvidenceIntent.conflict,
            });
            const selectedIds = new Set(selection.selected.map((group) => group.groupId));
            const finalContextGroups = [
              ...selection.selected,
              ...assertionGroups.filter((group) => !selectedIds.has(group.groupId)),
            ].slice(0, limit * 2);
            const selectionReasons = new Map(selection.trace.map((item) => [item.groupId, item]));
            const toAssertionCandidate = (
              group: EvidenceGroup<ReadableAssertionCandidate | any>,
            ): FusedRetrievalCandidate<ReadableAssertionCandidate> => {
              const primary = (group.normalizedAssertions[0] || group.rawEvents[0]) as FusedRetrievalCandidate<ReadableAssertionCandidate>;
              const assertionMembers = [...group.normalizedAssertions, ...group.rawEvents];
              const evidenceId = assertionMembers.length > 1 ? group.groupId : primary.id;
              return {
                id: evidenceId,
                kind: 'assertion',
                value: {
                  ...primary.value,
                  assertion: {
                    ...primary.value.assertion,
                    id: evidenceId,
                    provenance: {
                      ...(primary.value.assertion.provenance || {}),
                      evidence_group_id: group.groupId,
                      evidence_group_member_ids: assertionMembers.map((member) => member.id),
                    },
                  },
                  passage: buildEvidenceGroupPassage(group),
                },
                sources: group.retrievalSources,
                fusedScore: group.combinedFusedScore,
                fusedRank: group.rrfRank,
              };
            };
            const finalAssertions = selection.selected.map(toAssertionCandidate);
            const finalContextAssertions = finalContextGroups.map(toAssertionCandidate);
            const ranked = rankedEntities.slice(0, limit * 2);

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

            const candidatePoolSnapshot = rankedGroups.slice(0, umsPool).map((group, index) => ({
              id: group.normalizedAssertions.length + group.rawEvents.length > 1 ? group.groupId : group.primaryId,
              group_id: group.groupId,
              type: 'evidence_group',
              evidence_kind: group.normalizedAssertions.length && group.rawEvents.length
                ? 'hybrid'
                : (group.rawEvents.length ? 'raw_event' : (group.normalizedAssertions.length ? 'normalized_assertion' : 'entity')),
              passage: buildEvidenceGroupPassage(group),
              sources: group.retrievalSources,
              source_event_ids: group.sourceEventIds,
              source_agents: group.sourceAgents,
              states: group.states,
              state_keys: group.stateKeys,
              reranker_summary: buildRerankerEvidenceSummary(group),
              fused_score: Number(group.combinedFusedScore.toFixed(8)),
              fused_rank: group.rrfRank,
              reranker_rank: group.rerankerRank,
              final_rank: index + 1,
            }));
            const finalContextSnapshot = finalContextAssertions.map((candidate, index) => {
              const group = finalContextGroups[index];
              const selectionEntry = selectionReasons.get(group.groupId);
              return {
              evidence_id: candidate.id,
              group_id: group.groupId,
              passage: candidate.value.passage,
              sources: candidate.sources,
              source_event_ids: group.sourceEventIds,
              source_agents: group.sourceAgents,
              states: group.states,
              state_keys: group.stateKeys,
              fused_rank: candidate.fusedRank,
              reranker_rank: group.rerankerRank,
              final_rank: index + 1,
              selected_for_answer: index < limit,
              selection_reason: selectionEntry?.reason || 'final20_rank_fill',
              };
            });
            const traceResult = await writeRetrievalTrace({
              query: parsed.query,
              temporalMode: umsTemporalMode,
              stages: {
                entity_fts: resultsData.textResults.map((item: any, index: number) => ({ id: item.id, rank: index + 1 })),
                entity_vector: resultsData.vectorResults.map((item: any, index: number) => ({ id: item.id, rank: index + 1, score: item.similarity })),
                assertion_fts: isolatedItems('assertion_fts').map((item, index) => ({ id: item.id, rank: index + 1 })),
                assertion_vector: isolatedItems('assertion_vector').map((item, index) => ({
                  id: item.id, rank: index + 1, distance: item.distance, score: item.score,
                })),
                raw_event_vector: isolatedItems('raw_event_vector').map((item, index) => ({
                  id: item.id, rank: index + 1, distance: item.distance, score: item.score,
                })),
                raw_event_fallback: isolatedItems('raw_event_fallback').map((item, index) => ({ id: item.id, rank: index + 1 })),
                raw_event_channel_eligibility: channelIsolation.audit.map((item, index) => ({
                  id: item.candidateId,
                  rank: index + 1,
                  evidence_kind: item.evidenceKind,
                  eligible_channels: item.eligibleChannels,
                  excluded_channels: item.excludedChannels,
                })),
                graph: (resultsData.graphContext?.nodes || []).map((item: any, index: number) => ({ id: item.id, rank: index + 1 })),
                subject_attachment: isolatedItems('subject_attachment').map((item, index) => ({ id: item.id, rank: index + 1 })),
                evidence_group_rrf: evidenceGroups.map((group) => ({
                  id: group.groupId, rank: group.rrfRank, score: group.combinedFusedScore,
                })),
                reranker: rankedGroups.map((group) => ({
                  id: group.groupId, rank: group.rerankerRank || group.rrfRank, score: group.combinedFusedScore,
                })),
                evidence_selector: selection.trace.map((item) => ({
                  id: item.groupId,
                  rank: item.finalRank || item.rerankerRank || item.rrfRank,
                  drop_reason: item.reason,
                  selected: item.selected,
                  final_rank: item.finalRank,
                })),
              },
              candidatePool: candidatePoolSnapshot,
              finalContext: finalContextSnapshot,
            });

            result = {
              results: ranked.map(toCompactEntity),
              evidence: (await buildGroundingEnvelope(ctx, ranked, finalAssertions)).evidence,
              candidatePool: candidatePoolSnapshot,
              finalContext: finalContextSnapshot,
              trace: traceResult,
              temporalQuery: {
                mode: umsTemporalMode,
                as_of: umsTemporalQuery.asOf || null,
              },
              graphContext,
              searchMethods: {
                text: resultsData.textResults.length,
                vector: resultsData.vectorResults.length,
                assertion_text: isolatedItems('assertion_fts').length,
                assertion_vector: isolatedItems('assertion_vector').length,
                raw_event_vector: isolatedItems('raw_event_vector').length,
                graph: resultsData.graphContext?.nodes?.length || 0,
                subject_attachment: isolatedItems('subject_attachment').length,
                raw_event_fallback: isolatedItems('raw_event_fallback').length,
              },
              fusionConfig: {
                method: 'evidence_group_weighted_rrf_with_coverage_selector_v2',
                evidence_group_version: EVIDENCE_GROUP_VERSION,
                reranker_summary_version: RERANKER_SUMMARY_VERSION,
                evidence_selector_version: EVIDENCE_SELECTOR_VERSION,
                answer_context_limit: limit,
                trace_context_limit: limit * 2,
                config_hash: retrievalConfigHash(RETRIEVAL_CONFIG),
                rrfK: RETRIEVAL_CONFIG.rrfK,
                weights: {
                  entity_vector: RETRIEVAL_CONFIG.entityVectorWeight,
                  assertion_vector: RETRIEVAL_CONFIG.assertionVectorWeight,
                  raw_event_vector: RETRIEVAL_CONFIG.assertionVectorWeight,
                  entity_fts: RETRIEVAL_CONFIG.entityFtsWeight,
                  assertion_fts: RETRIEVAL_CONFIG.assertionFtsWeight,
                  graph: RETRIEVAL_CONFIG.graphWeight,
                  subject_attachment: RETRIEVAL_CONFIG.subjectAttachmentWeight,
                  raw_event_fallback: RETRIEVAL_CONFIG.rawEventFallbackWeight,
                },
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

            // Valid evidence ID set: every claim's evidence_ids must reference one of these.
            const validEvidenceIds = new Set(rawCitations.map((c: any) => c.id));

            // Step 2: call LLM for structured analysis
            let llmResponse: string;
            try {
              const promptText = buildAnalysisPrompt(situation, ctxData);
              llmResponse = await callLlmDecision(
                ctx,
                '你是一个决策分析助手。你基于用户的知识图谱数据，帮助分析决策情境。只输出有效的 JSON。使用中文回复。',
                promptText,
              );
            } catch (e: any) {
              if (e.message === 'LLM_NOT_CONFIGURED') {
                throw new BusinessError('LLM_NOT_CONFIGURED', 'LLM_NOT_CONFIGURED: LLM provider not configured');
                return;
              }
              console.error('[analyze_decision] LLM analysis failed:', e);
              throw new BusinessError('LLM_ANALYSIS_FAILED', `LLM_ANALYSIS_FAILED: ${e?.message || 'LLM call failed'}`);
              return;
            }

            // Step 3: parse JSON — no fallback to plain string on failure
            let rawJson: unknown;
            try {
              rawJson = JSON.parse(llmResponse);
            } catch (e: any) {
              console.error('[analyze_decision] LLM output JSON parse failed:', e);
              throw new BusinessError('LLM_OUTPUT_INVALID_JSON', `LLM_OUTPUT_INVALID_JSON: ${e?.message || 'JSON parse failed'}`);
              return;
            }

            // Step 4: validate against Zod schema — schema failure returns error, no string fallback
            const parseResult = AnalyzeDecisionResultSchema.safeParse(rawJson);
            if (!parseResult.success) {
              console.error('[analyze_decision] LLM output schema validation failed:', parseResult.error);
              throw new BusinessError('LLM_OUTPUT_INVALID', `LLM_OUTPUT_INVALID: schema validation failed — ${parseResult.error.message}`);
              return;
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

            result = {
              summary,
              pros,
              cons,
              risks,
              recommendation,
              questions: analysis.questions.slice(0, 3),
              evidence,
              rawCitations: rawCitations.slice(0, 8),
            };
            break;
          }
          case 'discuss_decision': {
            const parsed = DiscussDecisionSchema.parse(args);
            const { situation, messages } = parsed;

            const llmConfig = ctx.extractor.getLlmConfig();
            if (!llmConfig.apiUrl) {
              throw new BusinessError('LLM_NOT_CONFIGURED', 'LLM_NOT_CONFIGURED');
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
              throw new BusinessError('LLM_NOT_CONFIGURED', 'LLM_NOT_CONFIGURED');
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
            if (!gaLlm.apiUrl) { throw new BusinessError('LLM_NOT_CONFIGURED', 'LLM_NOT_CONFIGURED'); return; }
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

            // 时间感知：根据问题中的时间词决定是否剔除已失效关系
            const gaTemporalOpts = temporalOptsFromQuery(gaQuestion);
            const gaNowIso = new Date().toISOString();

            // 命中节点之间的关系（构成高亮子图的边 + 喂给 LLM 做图谱原生推理）
            const gaEdges: Array<{ source: string; target: string; type: string }> = [];
            const gaSeenEdge = new Set<string>();
            for (const s of gaCapped) {
              const rels = await ctx.db.getRelationshipsForEntity(s.id);
              for (const r of rels) {
                if (gaIds.has(r.source_id) && gaIds.has(r.target_id)) {
                  // 时间感知过滤：current 模式下剔除已失效关系（valid_until 早于现在）
                  if (!gaTemporalOpts.includeHistorical) {
                    const ru = (r as any).valid_until;
                    if (ru && ru <= gaNowIso) continue;
                  }
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
              if (e?.message === 'LLM_NOT_CONFIGURED') { throw new BusinessError('LLM_NOT_CONFIGURED', 'LLM_NOT_CONFIGURED'); return; }
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

            for (const a of extractResult.assertions || []) {
              const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
              const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
              try {
                await ctx.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
              } catch (err) {
                console.warn('[MCP save_conclusion] assertion write failed:', err);
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
            const { situation, conclusion, cited_entity_ids, confidence, alternatives, previous_decision_id, supersedes_decision_id, lineage_relation } = parsed;

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
              metadata: buildDecisionMetadata(parsed),
              valid_from: parsed.valid_from,
              valid_until: parsed.valid_until,
            });

            // Create decision_referenced relationships to cited entities
            // Task 9: If per-evidence metadata is provided, use the role from
            // evidence[] to determine relationship type. Otherwise fall back
            // to the flat supporting/opposing/cited arrays.
            const evidenceRoleMap = new Map<string, 'supporting' | 'opposing' | 'neutral'>();
            for (const ev of parsed.evidence) {
              evidenceRoleMap.set(ev.entity_id, ev.role);
            }
            const evidenceLinks = [
              ...(cited_entity_ids || []).map((id) => ({
                id,
                type: evidenceRoleMap.get(id) === 'supporting' ? 'supported_by' as const
                  : evidenceRoleMap.get(id) === 'opposing' ? 'opposed_by' as const
                  : 'decision_referenced' as const,
              })),
              // Only add from supporting/opposing arrays if not already covered by evidence[]
              ...parsed.supporting_evidence_ids
                .filter((id) => !evidenceRoleMap.has(id))
                .map((id) => ({ id, type: 'supported_by' as const })),
              ...parsed.opposing_evidence_ids
                .filter((id) => !evidenceRoleMap.has(id))
                .map((id) => ({ id, type: 'opposed_by' as const })),
              ...parsed.principle_ids.map((id) => ({ id, type: 'supported_by' as const })),
            ];
            if (evidenceLinks.length > 0) {
              for (const link of evidenceLinks) {
                try {
                  await ctx.db.addRelationship({
                    source_id: decisionEntity.id,
                    target_id: link.id,
                    type: link.type,
                    description: `Decision evidence: ${link.type}`,
                    weight: 1.0,
                  });
                } catch (e) {
                  // duplicate relationship is expected
                }
              }
              // Bump importance of cited entities (反哺：被引用的实体获得权重提升)
              try {
                ctx.db.bumpAccessCounts([...new Set(evidenceLinks.map((link) => link.id))]).catch(() => {});
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
                  type: lineage_relation,
                  description: `Explicit decision lineage: ${lineage_relation}`,
                  weight: 1.0,
                });
              } catch {
                // duplicate is fine
              }
            }

            if (supersedes_decision_id && supersedes_decision_id !== decisionEntity.id) {
              await ctx.db.addRelationship({
                source_id: decisionEntity.id,
                target_id: supersedes_decision_id,
                type: 'supersedes',
                description: 'Explicitly supersedes previous decision',
                weight: 1,
              });
            }

            // Semantic similarity only creates review candidates; it never creates lineage edges.
            try {
              const prevDecisions = await ctx.db.searchEntities(situation, 3);
              const pendingLineageCandidates = prevDecisions
                .filter((e: any) => e.type === 'decision' && e.id !== decisionEntity.id)
                .slice(0, 3)
                .map((entity: any) => ({ id: entity.id, name: entity.name, status: 'pending_confirmation' }));
              if (pendingLineageCandidates.length > 0) {
                await ctx.db.updateEntity(decisionEntity.id, {
                  metadata: { ...decisionEntity.metadata, pending_lineage_candidates: pendingLineageCandidates },
                });
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

            result = await ctx.db.getEntity(decisionEntity.id);
            break;
          }
          case 'get_decision_lineage': {
            const parsed = GetDecisionLineageSchema.parse(args);
            const { decision_id } = parsed;

            const lineage = await getRecursiveDecisionLineage(ctx.db, decision_id);
            if (!lineage) {
              throw new BusinessError('NOT_FOUND', 'Decision not found');
              return;
            }
            result = lineage;
            break;
          }
          case 'record_decision_outcome': {
            const parsed = RecordDecisionOutcomeSchema.parse(args);
            const outcome = await recordDecisionOutcome(ctx.db, parsed);
            if (!outcome) {
              throw new BusinessError('NOT_FOUND', 'Decision not found');
            }
            result = outcome;
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
            throw new BusinessError('METHOD_NOT_FOUND', `未知工具: ${name}`);
        }
      return result;
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      if (error instanceof z.ZodError) {
        throw new BusinessError(
          'INVALID_PARAMS',
          `参数验证失败: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BusinessError('INTERNAL', `执行错误: ${errorMessage}`);
    }
  }

  async listResources(): Promise<{ resources: any[] }> {
    const ctx = this.ctx;
    const entityTypes = await ctx.db.all<{ type: string; count: number }>(
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


  async readResource(uri: string): Promise<any> {
    const ctx = this.ctx;
    if (!uri) {
      throw new BusinessError('INVALID_PARAMS', 'URI is required');
    }

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
      return {
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
    }

    if (uri === 'memory://core-principles') {
      const all = await ctx.db.getCorePrinciples();
      const items = selectGeneralCorePrinciples(all, 20).map(toCompactEntity);
      return {
        items,
        total: all.length,
        returned: items.length,
        truncated: items.length < all.length,
      };
    }

    if (uri === 'memory://stats') {
      return await ctx.db.getStats();
    }

    const entityTypeMatch = uri.match(/^memory:\/\/entities\/(.+)$/);
    if (entityTypeMatch) {
      const type = decodeURIComponent(entityTypeMatch[1]);
      const all = await ctx.db.getEntitiesByType(type);
      const items = rankMemoryCandidates(type, all).slice(0, 100).map(toCompactEntity);
      return {
        items,
        total: all.length,
        returned: items.length,
        truncated: items.length < all.length,
        note: 'Use search_entities or unified_memory_search for precise retrieval.',
      };
    }

    throw new BusinessError('NOT_FOUND', `未知资源: ${uri}`);
  }

}
