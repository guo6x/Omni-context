# Deterministic Scoring v3

`deterministic-scoring-v3` limits positive fact coverage to `answer`, `facts`, and `constraints_used`. Current and historical scores use only their matching structured states; temporal order requires a correctly directed transition; invalidated-fact rejection requires `rejected_facts`; provenance uses visible `facts.source_agents` only.

Unsupported source references increase the unsupported rate. Unimplemented physical deletion and memory compression remain `null` and are excluded from the main aggregate. Judge-provided redundant insight rate is no longer hard-coded.

All 10 requested regression classes are covered by the passing test suite.
