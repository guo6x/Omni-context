# Candidate v3 current pipeline trace

This reference records the product pipeline at the immutable Final Freeze v1 baseline (`872723b10ec4ae99b8272606a183155837104332`) before Candidate v3 changes. It is a static inspection only: no model was called and no benchmark dataset was modified.

## Pipeline

| Stage | Current implementation | Fields retained | Current loss or limitation |
| --- | --- | --- | --- |
| Raw input event | `benchmark/cognitive/src/provider.mjs::fullOmniContext` sends lines containing event ID, time, agent and text to `/api/graph/extract`. | Raw line contains all four values. | The product receives one text blob rather than typed events. |
| Extraction request | `brain-server/src/api/handlers/index.ts::handleGraphRoutes` passes text, timestamp, source and `session_id` as `documentId`. | Request timestamp, source and document ID. | Event IDs and agents remain embedded in text. |
| Extraction response and validation | `brain-server/src/graphrag/llm-pipeline.ts::LLMExtractionResultSchema` validates entities, facts and principles. | Fact subject, predicate, object, confidence, source span and temporal fields. | No explicit exact/normalized value, fact state, event ID, source agent, transition, supersession or invalidation fields. |
| Extraction mapping | `brain-server/src/graphrag/extractor.ts::GraphRAGExtractor.extract` maps facts to relationships and assertions. | Object becomes entity reference or literal; source span and temporal fields are copied. | Assertion provenance contains only extractor/model. Request document ID and raw event identity are not copied. |
| Database write | `brain-server/src/api/handlers/index.ts::handleGraphRoutes` resolves entity IDs then calls `Database.addAssertion`. | Assertion, relationship and entity rows are written. | No state-transition reconciliation and no direct raw-event backlink. |
| Assertion storage | `brain-server/src/db/sqlite.ts::Database.addAssertion` stores literal/object, confidence, source span, provenance and validity. | Temporal validity, version and prior-version ID are supported. | Current/historical/invalidated semantics are implicit and a correction does not automatically preserve a transition. |
| Embedding index | `Database.indexAssertion` calls `serializeAssertionPassage` then `EmbeddingService.embedPassage`. | Human-readable subject/relation/object/source and temporal validity. | Passage v1 has no explicit event ID, source agent, state key, transition or rejected-conflict structure. |
| Retrieval candidates | `/api/mcp/tool` `unified_memory_search` runs entity FTS/vector, assertion FTS/vector, graph expansion and bounded subject attachment. | Assertion and entity candidates with RRF source traces. | Raw events and transitions are not first-class or grouped fallback evidence. |
| RRF | `brain-server/src/retrieval/fusion.ts::reciprocalRankFuse`. | Raw rank, distance, normalized score, weight and fused rank. | Trace exists only in the response and is not archived by the product. |
| Reranker | `brain-server/src/api/handlers/mcp.ts::rerankByLlm`. | Candidate type, name and shortened description. | No explicit structured state/source fields; reranker output rank is not persisted as a separate stage. |
| Final visible context | `unified_memory_search` returns assertion passages in `finalContext`. | Evidence ID, passage, retrieval sources and ranks. | No grouped raw event, stable source-event list, source-agent list, transition object or evidence type. |
| Answer | `benchmark/cognitive/src/provider.mjs::fullOmniContext` maps the passage into Answer context without changing the benchmark prompt. | Evidence ID and passage; visible agent labels are recovered from text. | Missing product fields cannot be recovered reliably by the Answer layer. |

## First-loss findings

- Exact value can first be lost in the LLM fact schema: `object` is the only value field and may be generalized.
- State can first be lost in the LLM fact schema: only validity timestamps exist; explicit current, historical, invalidated and uncertain states do not.
- Source provenance can first be lost in the LLM fact schema: the input line contains an event ID and agent, but neither has a validated fact field.
- Raw Event ID is not stored as an Assertion field or provenance property at this baseline.
- A raw event can only be approximated through `source_span`; the original event cannot be deterministically loaded by ID.
- Candidate and RRF details are returned per request, but the product has no optional durable trace writer.
- The reranker input and output do not archive a complete source-to-final-context chain.

The machine-readable counterpart is `evidence/current-pipeline-trace.json`.
