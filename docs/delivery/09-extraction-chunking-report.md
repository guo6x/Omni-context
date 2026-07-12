# Chunked Extraction & LLM Validation Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Document Chunking Pipeline

| Item | Status | Detail |
|------|--------|--------|
| Semantic boundary chunking | FIXED | chunkDocument in brain-server/src/ingest/chunker.ts: splits on paragraphs/headings/sentences |
| Chunk metadata | FIXED | document_id, chunk_id, source, source_span, start_offset, end_offset |
| Timestamp | FIXED | source_timestamp per chunk |
| Coverage tracking | FIXED | coveredCharacterCount reports total covered characters |
| Coverage/failure/chunk count | FIXED | ingestion_documents: total_chunks, processed_chunks, failed_chunks, coverage |
| Retry support | FIXED | POST /api/ingest/document/:id/retry with breakpoint resume |
| No silent discard | FIXED | Failed chunks recorded with status='failed' + error message |
| Max 60K capture | FIXED | Browser extension captures up to 60K; chunker handles full text |

## 2. LLM Extraction Validation (Zod)

| Item | Status | Detail |
|------|--------|--------|
| Entity type validation | FIXED | EntityTypeSchema from domain.ts |
| Relationship type validation | FIXED | RelationshipTypeSchema |
| Confidence range | FIXED | 0-1 bounded |
| Source span required | FIXED | source_span in Zod schema |
| Predicate legality | FIXED | String, trimmed |
| Date format validation | FIXED | IsoTimestampSchema (datetime with offset) |
| JSON structure validation | FIXED | Zod .strict() on all schemas |
| Failed blocks recorded | FIXED | status='failed', error persisted |
| Parse failure never silent | FIXED | ZodError caught and logged; never returns empty success |

## 3. Tests

| Test | Count | Status |
|------|-------|--------|
| chunker.test.ts | 4 | FIXED |
| chunked-extraction.test.ts | 3 | FIXED |
| llm-extraction-validation.test.ts | 2 | FIXED |

## 4. Known Gaps

| Issue | Status |
|-------|--------|
| Cross-chunk entity coreference (document-level) | PARTIALLY_FIXED (entity-resolver merges, but at batch level) |
| No progressive loading for 60K+ content | DEFERRED |
| Chunk batch embedding concurrency capping | PARTIALLY_FIXED (MAX_CANDIDATES=20 per type) |
