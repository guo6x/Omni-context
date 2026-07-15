# Evaluation environment fix and rerun

Product retrieval, Evidence Selector, Extraction, Answer, Judge, scoring, and Benchmark logic were unchanged. The only production metadata change was E5 Large `serializationVersion` from `entity-passage-v2+assertion-passage-v1` to `entity-passage-v2+assertion-passage-v3`; its deterministic fingerprint is `468b13e0c041d3fa8d872d61fb13bdd0b4935c3a02917748c12d264fe2bd706b`.

The standalone preflight used `EMBEDDING_LOCAL_MODEL_PATH=D:\OmniContext-models-v3.2` and resolved exactly one model-ID suffix. It verified the pinned SHA-256, loaded locally, and produced a finite nonzero 1024-dimensional query embedding.

The previous 0/7 run remains under its original names and D-drive directory. The fresh run under `D:\OmniContext-candidate-v3.1\targeted-7-profile-fix-e022c9c` completed five scenarios. The sixth scenario exhausted the unchanged retry policy after one structured-response truncation and Kimi 429 overload; the seventh did not start. Per the gate, execution stopped without Resume, Development 35, ablations, or tag creation.
