export type RetrievalSource =
  | 'entity_vector'
  | 'assertion_vector'
  | 'FTS'
  | 'graph'
  | 'subject_attachment';

export type CandidateKind = 'entity' | 'assertion';

export interface RetrievalSourceTrace {
  source: RetrievalSource;
  rawRank: number;
  rawDistance: number | null;
  normalizedScore: number;
  weight: number;
}

export interface FusionItem<T> {
  id: string;
  kind: CandidateKind;
  value: T;
  distance?: number;
  score?: number;
}

export interface FusionList<T> {
  source: RetrievalSource;
  weight: number;
  items: FusionItem<T>[];
}

export interface FusedRetrievalCandidate<T> {
  id: string;
  kind: CandidateKind;
  value: T;
  sources: RetrievalSourceTrace[];
  fusedScore: number;
  fusedRank: number;
}

export interface FusionConfig {
  rrfK: number;
}

function normalizedScore(item: FusionItem<unknown>, rank: number, count: number): number {
  if (Number.isFinite(item.score)) return Math.max(0, Math.min(1, Number(item.score)));
  if (Number.isFinite(item.distance)) return 1 / (1 + Math.max(0, Number(item.distance)));
  if (count <= 1) return 1;
  return 1 - (rank - 1) / count;
}

/** Weighted Reciprocal Rank Fusion with a complete, deterministic audit trail. */
export function reciprocalRankFuse<T>(
  lists: FusionList<T>[],
  config: FusionConfig,
): FusedRetrievalCandidate<T>[] {
  if (!Number.isFinite(config.rrfK) || config.rrfK <= 0) throw new Error('rrfK must be positive');
  const fused = new Map<string, Omit<FusedRetrievalCandidate<T>, 'fusedRank'>>();
  for (const list of lists) {
    if (!Number.isFinite(list.weight) || list.weight < 0) throw new Error(`Invalid fusion weight: ${list.source}`);
    const seen = new Set<string>();
    list.items.forEach((item, index) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const rawRank = index + 1;
      const trace: RetrievalSourceTrace = {
        source: list.source,
        rawRank,
        rawDistance: Number.isFinite(item.distance) ? Number(item.distance) : null,
        normalizedScore: normalizedScore(item, rawRank, list.items.length),
        weight: list.weight,
      };
      const contribution = list.weight / (config.rrfK + rawRank);
      const existing = fused.get(key);
      if (existing) {
        existing.fusedScore += contribution;
        existing.sources.push(trace);
      } else {
        fused.set(key, {
          id: item.id,
          kind: item.kind,
          value: item.value,
          sources: [trace],
          fusedScore: contribution,
        });
      }
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .map((candidate, index) => ({ ...candidate, fusedRank: index + 1 }));
}

