# Hybrid retrieval

Unified retrieval now fuses independent entity-vector, assertion-vector, FTS, graph, subject-attachment, and bounded raw-event candidate lists with weighted reciprocal-rank fusion. Each candidate retains source, raw rank, distance, normalized score, weight, and fused rank.

The fixed pool and answer Top-K were not increased. In the final Targeted rerun, Development-value matching found 27/30 values in the 40-item candidate pools, 11/30 in the traced Final-20, and 3/30 in the Answer Top-10. The remaining blocker is therefore primarily fusion/final-context selection, not raw candidate availability.

See `evidence/attribution-review.json` and `evidence/pipeline-traces.json`.
