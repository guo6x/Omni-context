# Fixed answer sample

The question set was frozen before execution in `benchmark/config/fixed-answer-sample-v2.json`: 10 single-hop, 10 temporal, all 13 multi-hop, 10 open-domain, and 10 adversarial questions (53 total).

| Metric | Candidate v1 | Candidate v2 |
|---|---:|---:|
| Binary Accuracy | 0.5283 | 0.5660 |
| Answerable Accuracy | 0.4651 | 0.5349 |
| Evidence Precision | 0.5173 | 0.8585 |
| Gold evidence in context | 0.4340 | 0.6038 |
| Accuracy when gold evidence present | 0.4783 | 0.5938 |
| Single-hop | 0.4000 | 0.4000 |
| Temporal | 0.5000 | 0.7000 |
| Multi-hop | 0.3846 | 0.4615 |
| Open-domain | 0.6000 | 0.6000 |
| Adversarial | 0.8000 | 0.7000 |

Candidate v2 completed 53/53 with errors=0 and fallback=0. Latency: retrieval P50/P95 2604/2687 ms; answer 1680/3016 ms; total 7306/10568 ms. Observed Brain Server working set was about 1.13 GB.

The first sample attempt was invalidated and retained because background AgentLoop/MemoryDecay wrote to the database. Evaluation mode now disables those writers. Accepted machine evidence: `D:\OmniContext-evaluation-v3.2\fixed-sample\run-v2-002`.
