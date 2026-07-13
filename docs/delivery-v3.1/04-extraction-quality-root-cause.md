# 04 — Extraction Collapse Diagnosis and Repair

Status: **FIXED**

Implementation commits: `b0c061932d95a8c35611b9d5b0b8e358eb82a69f`, `98eaa780e0800e7040bd6e42d5108571cebf1445`, `ae72a1a72ef1b46dd770a2fea5d25ab3cc88dbd4`

Scope: production extraction path and official LoCoMo Conversation 1 only. Conversations 2–10 were not loaded, run, viewed, analyzed, or counted.

## Root-cause proof

The original code defects were incorrect ingestion timestamps, silent regex fallback, whole-response schema rejection, subject mismatch skips, misleading pre-write counts, and missing resolver/database diagnostics. After those were repaired, a real provider run exposed three additional causes that mocks could not reveal:

1. DeepSeek legitimately emitted `null` for optional temporal fields, while the strict schema rejected the whole response.
2. The model emitted vague optional time text such as `recently`; rejecting the complete response discarded otherwise grounded entities and facts.
3. A 30-second extraction timeout was too short for several real dialogue responses.

The first real diagnostic run, `2026-07-13T16-11-13-331Z-fb26be1f`, completed only 3/19 sessions and failed 16 explicitly. Its partial successes already produced 72 entities and 36 relationships, proving that the old 19-session → 1-entity symptom was caused by the failure path rather than legitimate sparse content. Raw failed-run diagnostics are retained in `evidence/extraction-collapse/official-failed-run-diagnostics.jsonl`.

## Production repair

- Evaluation requests fail closed on disabled, HTTP, parse, truncation, timeout, and transport failures.
- Optional nullable temporal fields are accepted, then omitted; resolvable time fields must be ISO 8601.
- Vague optional time fields are dropped with hashed diagnostics instead of discarding all structured output.
- The extraction timeout defaults to 120 seconds and remains explicitly configurable.
- The prompt is dialogue-specific, carries the parsed session reference time, requires named speakers and source spans, and uses strict JSON output.
- Unknown domain labels are safely normalized to `concept` / `relates_to`; structural and evidence validation remains strict.
- Each session persists provider status, response hash, parsed/produced counts, resolver decisions, write counts, and database deltas.

## Formal Conversation 1 acceptance

- Run ID: `2026-07-13T16-54-49-815Z-1b9d6c9a`.
- Sessions: 19/19 completed; extraction failures: 0.
- Provider extraction calls: 30 HTTP 200, 30 parsed, 0 timeout, 0 invalid response, 0 temporal-field drop.
- Final database: 396 entities, 181 relationships, 423 assertions, 182 principles.
- Entity types: concept 82, event 55, goal 7, memory 1, person 59, principle 182, project 5, tool 5.
- Manual review: sessions 1, 5, 10, 15, and 19; 15/15 sampled assertions trace to a verbatim source span; 0 empty or hallucinated samples.

The review records one non-blocking quality risk: many provider predicates normalize to `relates_to`, and 182 principles indicate that extraction remains semantically coarse. These results are not hidden or used as a target for threshold tuning.

Evidence: `evidence/benchmark-conv1/extraction-diagnostics.jsonl`, `evidence/benchmark-conv1/extraction-manual-review.json`, `evidence/benchmark-conv1/database-summary.json`, `evidence/benchmark-conv1/server.log`.
