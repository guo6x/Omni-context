# Known Limitations

1. The task-mandated Kimi temperature is incompatible with the current provider-side model constraint. Changing to 0.6 requires an explicit benchmark-contract decision.
2. Kimi JSON Schema support, rubric stability, successful usage mapping, and real latency remain unverified.
3. Development scores and 20-item Secondary Agent Review are absent by design after the preflight stop.
4. Cross-Agent Provenance and Invalidated Fact Rejection are verified by unit tests only, not Development outcomes.
5. Synthetic Smoke is orchestration evidence, not an official LoCoMo or product-quality result.
6. Physical deletion and memory compression remain not implemented and are excluded from aggregate scoring.
