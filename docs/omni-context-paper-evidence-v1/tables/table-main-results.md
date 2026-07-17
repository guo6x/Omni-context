# Main results

| Evaluation | Mode | Completed | Errors | Overall | Completion rate | Error rate |
|---|---|---:|---:|---:|---:|---:|
| Targeted-7 | Full Omni | 7/7 | 0 | 0.840868 | 1 | 0 |
| Development-35 | full_omni | 35/35 | 0 | 0.884842 | 1 | 0 |
| Development-35 | retrieval_only | 35/35 | 0 | 0.563853 | 1 | 0 |
| Development-35 | no_memory | 35/35 | 0 | 0.366713 | 1 | 0 |
| Formal-250 | Full Omni | 248/250 | 2 | 0.866546 | 0.992 | 0.008 |
| Comparison-70 | full_omni | 70/70 | 0 | 0.870698 | 1 | 0 |
| Comparison-70 | retrieval_only | 69/70 | 1 | 0.552346 | 0.985714 | 0.014286 |
| Comparison-70 | no_memory | 70/70 | 0 | 0.364683 | 1 | 0 |

Relative improvements use the baseline score as denominator. Development: Full minus Retrieval-only = 0.320989 (56.927781%); Full minus No Memory = 0.518129 (141.290055%). Comparison: Full minus Retrieval-only = 0.318352 (57.636337%); Full minus No Memory = 0.506015 (138.754754%). These are internal synthetic-curated benchmark differences, not universal claims.
