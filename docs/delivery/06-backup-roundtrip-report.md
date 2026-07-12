# Backup & Portability Report

**Date:** 2026-07-12
**Branch:** pre-evaluation-hardening-v1

---

## 1. Export Coverage

| Table | Status | Detail |
|-------|--------|--------|
| entities | FIXED | Full dump with embeddings as base64 |
| relationships | FIXED | All temporal/decay fields |
| assertions | FIXED | Full assertion table |
| core_memory | FIXED | key/value/category/summary |
| archival_memory | FIXED | Embeddings as base64 |
| notifications | FIXED | Full dump |
| discussions | FIXED | All turns |
| app_meta | FIXED | Filtered (sensitive keys excluded) |
| device_configurations | FIXED | Non-sensitive only; credentials_exported=false |
| ingestion_documents | FIXED | document + chunk tables |
| ingestion_chunks | FIXED | source_span, offsets, timestamps |
| entity_merge_candidates | FIXED | Review queue |
| entity_merge_audit | FIXED | Merge history |
| assertion_conflict_audit | FIXED | Conflict audit trail |
| behavior_events | FIXED | Typed consumption/action events |
| proactive_insights | FIXED | Insight metadata + feedback |
| embedding_metadata | FIXED | Model/mode info |
| created_indexes_manifest | FIXED | sqlite_master index listing |
| Sensitive token exclusion | FIXED | SENSITIVE_META_KEY filter |

## 2. Merge Semantics

| Scenario | Status | Detail |
|----------|--------|--------|
| Same ID conflict | FIXED | Local ID wins; tombstone on import applied |
| Same semantic different ID | FIXED | normalizedEntityKey remap (type|name|description) |
| Same name, different content | FIXED | historical_version_of edge preserves both versions |
| Tombstone (deleted) | FIXED | Soft-closes valid_until; metadata.tombstone_imported_at set |
| Relationship endpoint remap | FIXED | entityIdRemap applied to source_id/target_id |
| Semantic relationship dedup | FIXED | source_id|target_id|type|valid_from key |
| Semantic assertion dedup | FIXED | subject_id|predicate|object_id|literal_value|valid_from key |

## 3. Round-Trip Testing

| Test | Status |
|------|--------|
| api.smoke.test.ts: full backup payload shape | FIXED |
| api.smoke.test.ts: export->replace->restore cross-check | FIXED |
| api.smoke.test.ts: merge semantic IDs + tombstones + remap | FIXED |
| conflict-transactions.test.ts: migration upgrade without loss | FIXED |

## 4. Remaining Gaps

| Issue | Status |
|-------|--------|
| No automated round-trip comparison script | DEFERRED |
| No merge conflict resolution for core_memory key conflicts | PARTIALLY_FIXED (INSERT OR IGNORE) |
| No tombstone GC (deleted records accumulate) | DEFERRED (v2) |
