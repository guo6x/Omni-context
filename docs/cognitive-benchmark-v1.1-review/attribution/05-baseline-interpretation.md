# Baseline Interpretation

Retrieval-Only scored `0.588249559083`, exceeding Full Omni `0.509600529101` by `0.078649029982`.

Retrieval-Only directly exposes up to four original Event texts. Full Omni passes information through extraction, graph representation, embedding, retrieval, context assembly, and Answer generation. Exact values and provenance can be lost at any of those stages. That mechanism-level difference explains the overall advantage without weakening the baseline.

Difficulty scores were:

| Difficulty | Full Omni | Retrieval-Only |
| --- | ---: | ---: |
| Easy | 0.573456 | 0.708763 |
| Medium | 0.447966 | 0.620403 |
| Hard | 0.505159 | 0.435582 |

Full Omni was stronger on the fixed Hard subset, while Retrieval-Only was stronger on Easy and Medium subsets.

All Retrieval-Only visible sources are original Event IDs and all completed No-Memory contexts are empty. Baseline leakage: none. Gold leakage: none. The score difference is a Baseline Design Effect plus product information loss, not evidence of unfair hidden access.
