# Attribution Method

## Scope

This review is a pre-freeze audit of the synthetic/curated Cognitive Benchmark v1.1 Development evidence. It is not a product optimization, a human review, an official LoCoMo review, or a Formal run.

The audit preserved the archived Development dataset, answers, Kimi judgments, scores, databases, and original Secondary Agent Review. It did not run Kimi, DeepSeek Answer, Extraction, Embedding, Unified Retrieval, Formal 250, Comparison 70, or LoCoMo Conversations 2–10.

## Evidence order

Each required fact was inspected in this order:

1. Original structured Scenario Event and event text.
2. Extracted Assertion, Entity, or Relationship in the exact archived `brain.db`.
3. Assertion or Entity embedding metadata and active index manifest.
4. Logged `unified_memory_search` entity candidates in `mcp_usage_log`.
5. Final visible context.
6. Structured answer.
7. Archived score and deterministic recomputation.

The selected database for every scenario matched all 10 final visible source IDs. The archive does not contain complete Assertion ANN, RRF, or reranker rankings. Those stages remain `unknown`; they are not reconstructed by rerunning retrieval.

## Review protocol

The original 20 `scenario_id + mode` pairs were retained. Reviewer inputs contain complete Scenario Events, Gold, structured fields, extraction summary, final context, answer, score, Kimi result, and the local pipeline trace. Old review verdicts were withheld during independent attribution.

The DeepSeek review stopped after 7 physical attempts because only 17 attempts remained for 19 incomplete samples. Continuing could not complete 20 reviews within the 24-attempt cap. One review completed; no additional calls were made after the projection gate fired.

## Decision rule

Dataset validity, product behavior, scoring validity, Judge behavior, and archive completeness are separate questions. A supported Gold does not make inconsistent structured provenance valid. A low product score does not imply a scoring defect.
