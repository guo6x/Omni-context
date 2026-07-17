# Retrieval pipeline

The product combines temporal parsing, text/vector/assertion/graph candidate channels, reciprocal-rank fusion, readable evidence grouping, the existing LLM reranker, Evidence Selector v2, and a bounded Answer Top-10. Source traces preserve channel, rank, and evidence IDs. The final fix changed selection and fusion behavior, not the embedding model or benchmark data.
