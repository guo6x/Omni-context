# LongMemEval preregistration v2

This preregistration supersedes `longmemeval-v1.json`. The v1 formal run was blocked before any dataset access because the sealed runner required a `createEngine` adapter that did not yet exist. No formal dataset was downloaded, no Provider was called, and no Gold was accessed before this v2 was created.

The frozen engine adapter is `external-eval/engines/omni-frozen-v3.1.mjs` at commit `e98ab1039091481c2b3e1bb34dfec07acaa3532c` (file SHA-256 `eacb6e2c7997d913715d682d9f0c2a234f3ac1d18639ca0de3b2db9a9d6ec309`). It exports `createEngine({productCommit, isolatedDatabase, dynamicPort})` returning `{ingest, query, stop}`. The engine wraps the frozen brain-server HTTP API and `CognitiveProvider` without modifying any product code.

All v1 experimental parameters are preserved: product commit `17dc1d0...`, build hash `af487d...`, answer model `deepseek-v4-flash`, temperature 0, max_tokens 1200, thinking disabled, top-k 10, prompt SHA-256 `4eb58be8...`, concurrency 1, max retries 2. The old data adapter base commit `066b63c...` is retained as `data_adapter_base_commit`; the new `adapter_commit` and `engine_adapter_commit` both point to the frozen engine adapter commit.

The answer path is `session ingestion → rebuild embeddings → unified_memory_search Top-10 → map evidence to answer-v2 memory_context → CognitiveProvider.answer() → structured.answer`. The `graph_answer` endpoint (temperature 0.4) is explicitly prohibited; the formal path uses temperature 0.

Status: **NOT AUTHORIZED / NOT RUN**. This preregistration does not by itself authorize a formal run. A custodian authorization file matching all hashes is still required.
