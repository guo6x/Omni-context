# Known Limitations

1. Kimi K2.6 does not permit client-controlled temperature; corrected requests omit the field, so repeatability is not temperature-zero determinism.
2. Kimi returned nine malformed structured outputs in 26 corrected calls; the final three consecutive failures forced a hard stop.
3. Full Omni is complete, but No Memory is partial and Retrieval-Only is absent; three-mode and pairwise conclusions are unavailable.
4. Full Omni Cross-Agent Provenance and Invalidated Fact Rejection both scored 0.
5. Secondary Agent Review is absent by design because final Development scoring was not reached.
6. Synthetic Smoke is orchestration evidence, not an official LoCoMo or product-quality result.
7. Physical deletion and memory compression remain not implemented and are excluded from aggregate scoring.
