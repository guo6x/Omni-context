export interface RetrievalConfig {
  candidatePoolMultiplier: number;
  candidatePoolMinimum: number;
  graphSeedCount: number;
  graphDepth: number;
  graphNodeLimitMultiplier: number;
  graphEdgeLimitMultiplier: number;
  minimumLexicalScore: number;
  stalePenalty: number;
  invalidatedPenalty: number;
  pendingConflictPenalty: number;
  abstentionThreshold: number;
}

export const DEFAULT_RETRIEVAL_CONFIG: Readonly<RetrievalConfig> = Object.freeze({
  candidatePoolMultiplier: 4,
  candidatePoolMinimum: 16,
  graphSeedCount: 3,
  graphDepth: 2,
  graphNodeLimitMultiplier: 3,
  graphEdgeLimitMultiplier: 5,
  minimumLexicalScore: 0,
  stalePenalty: 6,
  invalidatedPenalty: 20,
  pendingConflictPenalty: 4,
  abstentionThreshold: 0.2,
});

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

export function loadRetrievalConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RetrievalConfig {
  return {
    candidatePoolMultiplier: boundedNumber(env.OMNI_RETRIEVAL_POOL_MULTIPLIER, 4, 1, 20),
    candidatePoolMinimum: Math.floor(boundedNumber(env.OMNI_RETRIEVAL_POOL_MINIMUM, 16, 1, 500)),
    graphSeedCount: Math.floor(boundedNumber(env.OMNI_RETRIEVAL_GRAPH_SEEDS, 3, 1, 20)),
    graphDepth: Math.floor(boundedNumber(env.OMNI_RETRIEVAL_GRAPH_DEPTH, 2, 1, 4)),
    graphNodeLimitMultiplier: boundedNumber(env.OMNI_RETRIEVAL_GRAPH_NODE_MULTIPLIER, 3, 1, 20),
    graphEdgeLimitMultiplier: boundedNumber(env.OMNI_RETRIEVAL_GRAPH_EDGE_MULTIPLIER, 5, 1, 40),
    minimumLexicalScore: boundedNumber(env.OMNI_RETRIEVAL_MIN_SCORE, 0, -20, 50),
    stalePenalty: boundedNumber(env.OMNI_RETRIEVAL_STALE_PENALTY, 6, 0, 50),
    invalidatedPenalty: boundedNumber(env.OMNI_RETRIEVAL_INVALIDATED_PENALTY, 20, 0, 100),
    pendingConflictPenalty: boundedNumber(env.OMNI_RETRIEVAL_CONFLICT_PENALTY, 4, 0, 50),
    abstentionThreshold: boundedNumber(env.OMNI_RETRIEVAL_ABSTENTION_THRESHOLD, 0.2, 0, 1),
  };
}

export function assertEvaluationEmbeddingReady(
  status: 'local' | 'api' | 'hash-fallback' | 'pending',
  evaluationMode = process.env.OMNI_EVALUATION_MODE === '1',
): void {
  if (evaluationMode && status === 'hash-fallback') {
    throw new Error('EVALUATION_EMBEDDING_UNAVAILABLE: hash fallback is forbidden in evaluation mode');
  }
}
