# Offline retrieval ablation

Input was the preserved Candidate v1 Conversation 1 database only: 382 active entities, 423 assertions, 150 answerable evidence-bearing questions. Extraction, graph, questions, time rules, reference evidence and fixed Top-K were unchanged. Answer and Judge were not called.

| Arm | Description | Recall@10 | Final Context Recall | Candidate Recall | MRR@10 | NDCG@10 |
|---|---|---:|---:|---:|---:|---:|
| A | v1 small, no prefix, entity-only | 0.6333 | 0.3933 | 0.7400 | 0.4639 | 0.5111 |
| B | small + E5 prefix, entity-only | 0.6600 | 0.4400 | 0.7800 | 0.4816 | 0.5442 |
| C | large + prefix, entity-only | 0.6800 | 0.4667 | 0.7867 | 0.4917 | 0.5493 |
| D | large + assertion-only, legacy passage | 0.0933 | 0.1200 | 0.1733 | 0.0513 | 0.0630 |
| E | large parallel, legacy assertion passage | 0.0933 | 0.1200 | 0.1733 | 0.0513 | 0.0630 |
| F | large parallel + readable serialization | 0.6267 | 0.6800 | 0.7267 | 0.4454 | 0.5198 |

F retrieval latency was P50 27.86 ms / P95 37.21 ms. Its Final Context Recall improved by +0.2200 against the preserved-v1 conservative recomputation (0.4600) and +0.197 against the task proxy (0.483), exceeding the +0.08 gate. Recall@10 itself did not improve by +0.10; the OR acceptance gate passed through Final Context Recall. Temporal Final Context Recall reached 0.8378 and single-hop 0.6563.

Machine evidence: `D:\OmniContext-evaluation-v3.2\ablation\results-final`.
