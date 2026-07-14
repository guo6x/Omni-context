# Memory Pipeline Audit

## Archive coverage

All 35 final Full Omni results were matched to their exact archived Development databases. Each selected database contained 10/10 final visible source IDs.

Across 110 required-fact traces, the first known loss stages were:

- Extraction: 5 facts.
- Final context after a logged matching entity candidate: 21 facts.
- Unknown within the memory pipeline: 48 facts.
- No loss: 36 facts.

The conservative fact-level attribution candidates were:

- Extraction failure: 5.
- Retrieval failure: 21.
- Memory pipeline unresolved: 48.
- No material issue: 36.

## Evidence limitation

The database proves extracted Assertions/Entities/Relationships and embedding metadata. `mcp_usage_log` proves the query and matched entity candidates. Final context proves what Answer received. It does not archive the complete Assertion candidate list, raw vector distances, RRF ranks, or reranker output.

Accordingly, facts absent from final context are classified as `retrieval_failure` only when a matching logged entity candidate survives into the recorded candidate set. Otherwise the audit uses `memory_pipeline_unresolved`. No missing candidate stage is inferred from the final context alone.

Machine evidence: `evidence/memory-pipeline-trace.json` and `evidence/first-loss-stage-summary.json`.
