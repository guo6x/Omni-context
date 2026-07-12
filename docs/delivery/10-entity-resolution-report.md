# Entity Resolution Policy Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Type-Specific Merge Strategy

| Category | Types | Policy | Status |
|----------|-------|--------|--------|
| Aggressive auto-merge | tool, architecture_pattern, concept (synonyms) | Vector similarity > threshold | FIXED |
| Conservative | person, decision, preference, goal, event, task, question, project | Only normalized-name match + compatible time/source | FIXED |

## 2. Conservative Rules

| Rule | Status | Detail |
|------|--------|--------|
| Auto-merge requires normalized name match | FIXED | normalizeName in entity-resolver.ts |
| Vector similarity only generates candidates | FIXED | Candidates go to entity_merge_candidates table |
| Decisions never auto-merged | FIXED | decision type excluded from aggressive merge |
| Preferences never auto-merged | FIXED | preference type excluded |
| Goals never auto-merged | FIXED | goal type excluded |
| Events never auto-merged | FIXED | event type excluded |
| Review queue | FIXED | entity_resolution_review_queue migration + entity_merge_candidates table |
| Merge reversibility | FIXED | merge_entities tool is soft (merged_into metadata, reversible) |
| Merge audit trail | FIXED | entity_merge_audit table: merge_reason, similarity, operator, timestamp |
| Field-level merge (not shallow overwrite) | FIXED | Provenance and temporal history preserved at field level |

## 3. Scale Optimization

| Item | Status | Detail |
|------|--------|--------|
| No O(N) full-type load | FIXED | MAX_CANDIDATES=20 per type; KNN index first |
| Name index recall first | FIXED | Normalized name match before vector |
| Batch embedding concurrency capping | FIXED | MAX_CANDIDATES limits per-batch embedding calls |
| Candidate cap | FIXED | 20 candidates per type per batch |

## 4. Tests

| Test | Count |
|------|-------|
| entity-resolution-policy.test.ts | 6 |

## 5. Known Gaps

| Issue | Status |
|-------|--------|
| No ML-based coreference resolution | DEFERRED (v2) |
| Merge queue requires manual review (no auto-accept) | NOT_APPLICABLE (by design) |
