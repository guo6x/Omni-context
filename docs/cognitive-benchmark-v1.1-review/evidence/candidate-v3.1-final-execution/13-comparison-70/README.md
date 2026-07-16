# Comparison 70

The 70 scenarios were selected before Formal and run with the frozen configuration in all three modes.

| Mode | Completed | Errors | Overall |
| --- | ---: | ---: | ---: |
| No Memory | 70/70 | 0 | 0.3646825396825397 |
| Retrieval-only | 69/70 | 1 | 0.5523456790123457 |
| Full Omni | 70/70 | 0 | 0.8706984126984126 |

The sole final error is `formal-v2-conflict_resolution-014:retrieval_only`: the Answer schema rejected an empty `fact.source_ids` after all configured attempts. The initial invocation also reached the Kimi physical-call limit during one Full Omni Decision item; a checkpoint resume recovered only that item and the two items that had not started.

Full raw evidence remains at `D:/OmniContext-candidate-v3.1-final-execution/evidence/13-comparison-70`; per-scenario databases and server logs remain at `D:/OmniContext-candidate-v3.1-final-execution/runs/13-comparison-70`.
