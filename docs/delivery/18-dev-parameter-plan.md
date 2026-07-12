# Development Parameter Optimization Plan

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Parameter Space

| Parameter | Default | Range | Env Var |
|-----------|---------|-------|---------|
| topK | 10 | 5-30 | OMNI_RETRIEVAL_POOL_MINIMUM (derived) |
| candidatePoolMultiplier | 4 | 1-20 | OMNI_RETRIEVAL_POOL_MULTIPLIER |
| candidatePoolMinimum | 16 | 1-500 | OMNI_RETRIEVAL_POOL_MINIMUM |
| graphSeedCount | 3 | 1-20 | OMNI_RETRIEVAL_GRAPH_SEEDS |
| graphDepth | 2 | 1-4 | OMNI_RETRIEVAL_GRAPH_DEPTH |
| graphNodeLimitMultiplier | 3 | 1-20 | OMNI_RETRIEVAL_GRAPH_NODE_MULTIPLIER |
| graphEdgeLimitMultiplier | 5 | 1-40 | OMNI_RETRIEVAL_GRAPH_EDGE_MULTIPLIER |
| stalePenalty | 6 | 0-50 | OMNI_RETRIEVAL_STALE_PENALTY |
| invalidatedPenalty | 20 | 0-100 | OMNI_RETRIEVAL_INVALIDATED_PENALTY |
| pendingConflictPenalty | 4 | 0-50 | OMNI_RETRIEVAL_CONFLICT_PENALTY |
| abstentionThreshold | 0.2 | 0-1 | OMNI_RETRIEVAL_ABSTENTION_THRESHOLD |
| rerankerCandidates | 25 | 10-100 | (rerankByLlm param) |
| entityMergeThreshold | type-specific | N/A | MAX_CANDIDATES=20 |
| proactiveCooldown | 7d/1d | N/A | (hardcoded in AgentLoop) |

## 2. Optimization Objectives

| Objective | Weight | Description |
|-----------|--------|-------------|
| Correctness | HIGH | binary_accuracy + factual_score |
| Temporal validity | HIGH | temporal_score - stale_memory_leakage |
| Contextual relevance | MEDIUM | contextual_score |
| Abstention quality | HIGH | abstention_accuracy |
| Evidence traceability | MEDIUM | evidence_precision |
| Latency | LOW | Mean response time |
| Token/API cost | LOW | Total LLM calls per query |
| Proactive FPR | MEDIUM | 1 - (useful / total_insights) |

## 3. Search Strategy

**Phase 1: Coarse grid (4 configs)**
- Default / High-recall (pool=8, seeds=5) / Low-latency (pool=2, seeds=1) / Conservative (stale=8, abstain=0.3)

**Phase 2: Fine grid around best (8 configs)**
- Tune top 3 most sensitive parameters around Phase 1 winner

**Phase 3: Boundary stress (4 configs)**
- Extreme stale penalty, minimum pool, maximum graph depth

**Total: ~16 configs on development set only**

## 4. Constraints

| Rule | Detail |
|------|--------|
| Development-only | Conversation 1 exclusively |
| Held-out sealed | Never used for tuning |
| No hardcoded answers | Parameters only; no dataset-specific logic |
| Multi-objective | Omni Composite Score is ONE input; never the sole target |

## 5. Status

**PARTIALLY_FIXED** - Parameters are configurable via env vars; config/default.json defines search space. Actual grid search and result analysis deferred to post-freeze.
