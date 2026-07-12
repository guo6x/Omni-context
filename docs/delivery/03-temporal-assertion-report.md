# Temporal & Assertion Model Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Entity Temporal Fields

| Field | Status | Detail |
|-------|--------|--------|
| observed_at | FIXED | Entity schema (shared-types.ts) |
| recorded_at | FIXED | Entity schema |
| event_time | FIXED | Entity schema |
| valid_from | FIXED | Entity schema + DB migration |
| valid_until | FIXED | Entity schema + DB migration |
| temporal_confidence | FIXED | Entity schema |
| temporal_source | FIXED | Entity schema |
| timezone | FIXED | Entity schema |

## 2. Relationship Temporal Fields

| Field | Status | Detail |
|-------|--------|--------|
| valid_from | FIXED | add_temporal_graph_fields migration |
| valid_until | FIXED | add_temporal_graph_fields migration |
| invalidated_at | FIXED | add_invalidation_reason_to_relationships migration |
| invalidation_reason | FIXED | add_invalidation_reason_to_relationships migration |

## 3. Assertion Layer

| Item | Status | Detail |
|------|--------|--------|
| Assertion table | FIXED | add_temporal_assertions migration |
| Assertion interface | FIXED | shared-types.ts: subject_id, predicate, object_id, literal_value, confidence, source_span, provenance |
| Assertion temporal fields | FIXED | observed_at, recorded_at, event_time, valid_from, valid_until |
| Assertion invalidation | FIXED | invalidated_at, invalidation_reason |
| Current-state query | FIXED | WHERE valid_until IS NULL |
| Historical query | FIXED | includeHistorical=true parameter |
| Conflict on assertions | FIXED | assertion_conflict_audit table, supersede operations |
| Batch assertion dedup | FIXED | addRelationship generates relationship:* assertion row |

## 4. Version Relationships

| Type | Status | Detail |
|------|--------|--------|
| supersedes | FIXED | In relationship_types |
| superseded_by | FIXED | In relationship_types |
| revises | FIXED | In relationship_types |
| invalidates | FIXED | In relationship_types |
| historical_version_of | FIXED | In relationship_types |
| continues | FIXED | In relationship_types (decision lineage) |
| reverses | FIXED | In relationship_types |
| learned_from | FIXED | In relationship_types |
| outcome_of | FIXED | In relationship_types (decision feedback) |

## 5. Relative Time Parsing

| Item | Status | Detail |
|------|--------|--------|
| temporal-parser.ts | FIXED | brain-server/src/utils/temporal-parser.js |
| time-window.ts | FIXED | parseTimeWindow for retrieval |
| Benchmark-only claim | FIXED | Now in brain-server via unified_memory_search temporal recall |
| Unit tests | FIXED | temporal-parser.test.ts: 5 tests |

## 6. Temporal Assertion Tests

| Test | Status |
|------|--------|
| temporal-parser.test.ts | FIXED (5 tests) |
| temporal-assertions.test.ts | FIXED |
| conflict-transactions.test.ts | FIXED (3 tests including atomic rollback) |
