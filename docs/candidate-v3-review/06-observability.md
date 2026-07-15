# Observability

When `OMNI_EVALUATION_TRACE_DIR` is explicitly set, unified retrieval writes a local JSONL trace containing a query SHA-256, temporal mode, per-stage IDs and rankings, candidate pool, source paths, fused ranks, final ranks, and drop reasons. Query text, passage text, source spans, API keys, and bearer tokens are excluded.

The final rerun produced 9 complete traces: 7 completed scenarios plus 2 retry attempts. All traces contain candidate and final-context records; 211 candidate source paths and 120 final source paths include `raw_event_fallback`.

Trace integrity is recorded in `evidence/trace-integrity.json`.
