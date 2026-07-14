# Cognitive Benchmark v1.1 Hardening Summary

This branch starts at Benchmark v1 commit `71085c46ce5f832bd2048f4e7b77c2cdee8f0f66`. It implements Answer Schema v2, deterministic scoring v3, an independent Kimi judge adapter, structurally diverse scenario generation, real difficulty validation, leakage and duplicate audits, and resumable calibration evidence.

The Kimi adapter now omits the `temperature` field for `kimi-k2.6`, while retaining disabled thinking, non-streaming requests, a 600-token completion cap, and JSON Schema preference. The old three-HTTP-400 history is preserved separately. The corrected preflight completed 6/6 with valid schemas and stable quality ordering.

Full Omni completed 35/35. No Memory completed 16/21 before three consecutive Kimi structured-output schema failures triggered the mandatory stop. Retrieval-Only and final-score-based Secondary Agent Review were therefore not run. The benchmark is not ready for final review.

No production retrieval, embedding, RRF, temporal logic, or product prompt was changed. Formal 250 and Comparison 70 were not run or frozen. Kimi reproducibility relies on fixed model, prompt, schema, and inputs; Kimi K2.6 does not permit client-controlled temperature.
