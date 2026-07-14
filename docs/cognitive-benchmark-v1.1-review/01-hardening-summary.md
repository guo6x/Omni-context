# Cognitive Benchmark v1.1 Hardening Summary

This branch starts at Benchmark v1 commit `71085c46ce5f832bd2048f4e7b77c2cdee8f0f66`. It implements Answer Schema v2, deterministic scoring v3, an independent Kimi judge adapter, structurally diverse scenario generation, real difficulty validation, leakage and duplicate audits, and resumable calibration evidence.

The static gates and Synthetic Smoke v2 gates pass. The real Kimi preflight is blocked: the required `kimi-k2.6` endpoint rejected the mandated `temperature=0` with HTTP 400 and stated that only `0.6` is allowed. Three consecutive provider errors triggered the required hard stop. Development was therefore not started and the benchmark is not ready for final review.

No production retrieval, embedding, RRF, temporal logic, or product prompt was changed. Formal 250 and Comparison 70 were not run or frozen.
