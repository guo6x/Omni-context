const GENERIC_TAGS = new Set([
  'uploaded-file',
  'imported',
  'auto_extracted',
  'llm-extracted',
  'import:chatgpt',
]);

const DECISION_TYPE_BOOST: Record<string, number> = {
  decision: 4,
  project: 3,
  task: 2,
  question: 2,
  goal: 2,
  concept: 1,
  preference: 1,
};

function normalize(text: unknown): string {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query);
  const terms = new Set<string>();

  for (const token of normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []) {
    terms.add(token);
  }

  for (const chunk of normalized.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    if (chunk.length <= 6) terms.add(chunk);
    for (let size = 2; size <= Math.min(4, chunk.length); size++) {
      for (let i = 0; i <= chunk.length - size; i++) {
        terms.add(chunk.slice(i, i + size));
      }
    }
  }

  return [...terms].filter((term) => term.length >= 2);
}

function distinctiveIdentifiers(query: string): string[] {
  return (normalize(query).match(/[a-z0-9][a-z0-9._-]{2,}/g) || [])
    .filter((term) => !['the', 'and', 'for', 'with', 'from', 'this', 'that'].includes(term));
}

export interface RankMemoryOptions {
  decisionMode?: boolean;
  historicalMode?: boolean;
  now?: Date;
  config?: RetrievalConfig;
}

function scoreCandidate(query: string, candidate: any, options: RankMemoryOptions): number {
  const decisionMode = options.decisionMode === true;
  const config = options.config ?? DEFAULT_RETRIEVAL_CONFIG;
  const name = normalize(candidate?.name);
  const description = normalize(candidate?.description);
  const tags = Array.isArray(candidate?.tags) ? candidate.tags.map(normalize) : [];
  const text = `${name} ${description} ${tags.join(' ')}`;
  const terms = queryTerms(query);
  let score = 0;
  let matches = 0;

  for (const term of terms) {
    if (name === term) {
      score += 12;
      matches++;
    } else if (name.includes(term)) {
      score += 6;
      matches++;
    } else if (tags.some((tag: string) => tag.includes(term))) {
      score += 4;
      matches++;
    } else if (description.includes(term)) {
      score += 2;
      matches++;
    }
  }

  if (decisionMode) score += DECISION_TYPE_BOOST[candidate?.type] || 0;
  if (candidate?.similarity && Number.isFinite(candidate.similarity)) {
    score += Math.max(0, Number(candidate.similarity)) * 3;
  }

  const genericTagCount = tags.filter((tag: string) => GENERIC_TAGS.has(tag)).length;
  if (genericTagCount > 0 && matches === 0) score -= genericTagCount * 3;
  if (candidate?.type === 'principle' && matches === 0) score -= 4;

  if (!options.historicalMode) {
    const now = options.now ?? new Date();
    const validUntil = candidate?.valid_until ? Date.parse(String(candidate.valid_until)) : Number.NaN;
    if (Number.isFinite(validUntil) && validUntil <= now.getTime()) score -= config.stalePenalty;
    if (candidate?.invalidated_at || candidate?.is_invalidated === true) score -= config.invalidatedPenalty;
  }
  if (candidate?.conflict_status === 'pending') score -= config.pendingConflictPenalty;

  return score;
}

export function rankMemoryCandidates(
  query: string,
  candidates: any[],
  options: RankMemoryOptions = {},
): any[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidate(query, candidate, options),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ candidate }) => candidate);
}

export async function collectGraphCandidates(
  db: Pick<import('./db/sqlite.js').Database, 'getGraphNeighborhood'>,
  rankedSeeds: Array<{ id: string }>,
  config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG,
  includeHistorical = false,
): Promise<{
  nodes: import('./shared-types.js').Entity[];
  edges: import('./shared-types.js').Relationship[];
}> {
  const nodes = new Map<string, import('./shared-types.js').Entity>();
  const edges = new Map<string, import('./shared-types.js').Relationship>();
  for (const seed of rankedSeeds.slice(0, config.graphSeedCount)) {
    const neighborhood = await db.getGraphNeighborhood(seed.id, config.graphDepth, includeHistorical);
    for (const node of neighborhood.nodes) nodes.set(node.id, node);
    for (const edge of neighborhood.edges) edges.set(edge.id, edge);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function memoryCandidateScore(
  query: string,
  candidate: any,
  options: RankMemoryOptions = {},
): number {
  return scoreCandidate(query, candidate, options);
}

export function selectRelevantPrinciples(
  query: string,
  principles: any[],
  limit: number,
): any[] {
  const identifiers = distinctiveIdentifiers(query);
  const ranked = principles
    .map((principle, index) => ({
      principle,
      index,
      score: scoreCandidate(query, principle, { decisionMode: true }),
      text: normalize(`${principle?.name || ''} ${(principle?.tags || []).join(' ')} ${principle?.description || ''}`),
    }))
    .filter(({ text }) => identifiers.length === 0 || identifiers.some((term) => text.includes(term)))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return ranked.slice(0, limit).map(({ principle }) => principle);
}

export function selectGeneralCorePrinciples(principles: any[], limit: number): any[] {
  return principles
    .map((principle, index) => {
      const tags = Array.isArray(principle?.tags) ? principle.tags.map(normalize) : [];
      const genericPenalty = tags.filter((tag: string) => GENERIC_TAGS.has(tag)).length * 5;
      const provenance = principle?.metadata?.provenance?.source;
      const userBoost = !provenance || provenance === 'user' ? 4 : 0;
      const accessBoost = Math.min(Number(principle?.access_count || 0), 20) / 10;
      return { principle, index, score: userBoost + accessBoost - genericPenalty };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ principle }) => principle);
}

export function capGraphContext(graph: any, maxNodes: number, maxEdges: number): any {
  if (!graph || !Array.isArray(graph.nodes)) return graph || {};
  const nodes = graph.nodes.slice(0, maxNodes);
  const nodeIds = new Set(nodes.map((node: any) => node.id));
  const edges = (Array.isArray(graph.edges) ? graph.edges : [])
    .filter((edge: any) => {
      const source = edge.source_id ?? edge.source;
      const target = edge.target_id ?? edge.target;
      return nodeIds.has(source) && nodeIds.has(target);
    })
    .slice(0, maxEdges);

  return { ...graph, nodes, edges };
}
import { DEFAULT_RETRIEVAL_CONFIG, type RetrievalConfig } from './retrieval/config.js';
