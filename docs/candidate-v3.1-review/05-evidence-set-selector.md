# Evidence Set Selector

`selectEvidenceSet` keeps the Answer budget fixed at Top-10. It starts with the best-ranked core evidence, then selects complementary current/historical/invalidated state, transitions and conflicts, provenance diversity, and decision dimensions before filling remaining positions by reranker rank.

Intent recognition is generic English/Chinese query semantics only. Historical or invalidated evidence becomes eligible for temporal, evolution, or conflict queries while current-only queries retain strong stale-evidence protection. The version is `evidence-selector-v1`.
