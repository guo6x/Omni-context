# Hybrid retrieval

The query path now executes independent Entity ANN and Assertion ANN searches, temporal filtering, FTS/keyword candidates, graph expansion, auditable weighted reciprocal-rank fusion, and the existing reranker. Assertions enter through their own semantic score; the removed behavior attached arbitrary recent assertions only from top entity subjects.

Every candidate records source (`entity_vector`, `assertion_vector`, `FTS`, `graph`, or `subject_attachment`), source rank, raw distance, normalized score, fusion contribution, and final rank. IDs deduplicate candidates across sources. Final evidence favors assertions; entities remain navigation/fallback evidence.

Fusion weights and top-K limits are fixed in the config hash. No cross-encoder was added and no unlimited Top-K was used.
