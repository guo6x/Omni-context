# Reranker summary

`buildRerankerEvidenceSummary` emits a bounded, structure-first summary containing ID, type, fact, exact value, state, state key, transition, rejected conflicts, source agents, confidence, event time, and a shortened raw quote. Output is capped at 600 characters and contains no benchmark Gold field.

The version is `reranker-evidence-summary-v1`.
