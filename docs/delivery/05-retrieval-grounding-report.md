# Retrieval & Grounding Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Retrieval Pipeline Unification

| Item | Status | Detail |
|------|--------|--------|
| HTTP MCP retrieval | FIXED | api/handlers/mcp.ts uses unified config + multi-seed |
| Stdio MCP retrieval | FIXED | mcp-server.ts uses same _retrieveMemoryCandidates helper |
| Decision mode isolation | FIXED | decisionMode boost only applied when requested |
| General retrieval | FIXED | No decision type boost in general queries |

## 2. Candidate Pool & Fusion

| Item | Status | Detail |
|------|--------|--------|
| FTS recall | FIXED | searchEntities with configured pool multiplier |
| Vector recall | FIXED | vectorSearch with same pool size |
| Temporal recall | FIXED | parseTimeWindow + getEntitiesByTimeWindow |
| Graph recall | FIXED | Multi-seed (graphSeedCount=3) graph expansion |
| Graph nodes in candidate pool | FIXED | Nodes fused into candidateMap before ranking |
| Deduplication | FIXED | candidateMap keys by entity ID |

## 3. Ranking & Scoring

| Item | Status | Detail |
|------|--------|--------|
| Stale penalty | FIXED | valid_until < now -> subtract stalePenalty (6) |
| Invalidated penalty | FIXED | invalidated_at -> subtract invalidatedPenalty (20) |
| Conflict penalty | FIXED | conflict_status='pending' -> subtract pendingConflictPenalty (4) |
| Historical mode bypass | FIXED | penalties skipped in historicalMode |
| Lexical minimum | FIXED | minimumLexicalScore filter |
| Reranker (LLM) | FIXED | rerankByLlm after wide recall |
| Abstention threshold | FIXED | abstentionThreshold (0.2) for answerable judgment |

## 4. Evaluation Safety

| Item | Status | Detail |
|------|--------|--------|
| Hash fallback fail-fast | FIXED | assertEvaluationEmbeddingReady throws in eval mode |
| Embedding status check | FIXED | Status checked before vector search in eval mode |
| Configurable parameters | FIXED | 9 env vars (OMNI_RETRIEVAL_*) with bounds |

## 5. Configuration

| Parameter | Default | Env Var |
|-----------|---------|---------|
| candidatePoolMultiplier | 4 | OMNI_RETRIEVAL_POOL_MULTIPLIER |
| candidatePoolMinimum | 16 | OMNI_RETRIEVAL_POOL_MINIMUM |
| graphSeedCount | 3 | OMNI_RETRIEVAL_GRAPH_SEEDS |
| graphDepth | 2 | OMNI_RETRIEVAL_GRAPH_DEPTH |
| graphNodeLimitMultiplier | 3 | OMNI_RETRIEVAL_GRAPH_NODE_MULTIPLIER |
| graphEdgeLimitMultiplier | 5 | OMNI_RETRIEVAL_GRAPH_EDGE_MULTIPLIER |
| stalePenalty | 6 | OMNI_RETRIEVAL_STALE_PENALTY |
| invalidatedPenalty | 20 | OMNI_RETRIEVAL_INVALIDATED_PENALTY |
| pendingConflictPenalty | 4 | OMNI_RETRIEVAL_CONFLICT_PENALTY |
| abstentionThreshold | 0.2 | OMNI_RETRIEVAL_ABSTENTION_THRESHOLD |

## 6. Tests

| Test | Status |
|------|--------|
| retrieval-policy.test.ts: no decision boost in general | FIXED |
| retrieval-policy.test.ts: decision boost when requested | FIXED |
| retrieval-policy.test.ts: stale/invalidated penalties | FIXED |
| retrieval-policy.test.ts: env override bounds | FIXED |
| retrieval-policy.test.ts: hash fallback in eval mode | FIXED |
| retrieval-policy.test.ts: multi-seed graph fusion | FIXED |
