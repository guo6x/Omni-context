# 02 — Task 1: Benchmark Runner Wired to Real Brain Server + LLM

**Commits**: `91ff897`, `9ee0e40`, `769446c`, `1f18c5c`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
The v2 benchmark runner was a non-functional scaffold: `brainServerFactory` threw `Error("Brain server factory not configured")`, `llmClient` was `null`, `dataset.mjs` required a `conversations` array that was incompatible with the official snap-research/locomo top-level array format, GraphRAG extraction was faked via direct `db.addEntity()` calls, and the judge returned `null`. Every external dependency was a placeholder, so `npm run benchmark:dev` could not run.

## Production Entry Point
`benchmark/src/cli.mjs` → invoked via `npm run benchmark:dev -- --dataset <locomo10.json>`

Three CLI modes: `dev`, `resume`, `retry-errors`. Required env vars: `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`. Optional: `JUDGE_MODEL`, `BRAIN_SERVER_URL`, `LOCAL_API_TOKEN`.

## Call Chain
1. User runs `npm run benchmark:dev -- --dataset data/locomo10.json`
2. `cli.mjs` validates env vars, loads config/prompts, creates real `BrainServerClient` + `LLMClient`
3. `runBenchmark()` (`runner/index.mjs`) starts:
   - `BrainServerClient.preflight()` → `GET /api/health`, `GET /api/embedding/status`, DB writability check
   - `ingestConversation()` → `POST /api/graph/extract` (real GraphRAG, not `db.addEntity`)
   - For each question: `BrainServerClient.unifiedMemorySearch()` → `POST /api/mcp/tool/unified_memory_search`
   - `LLMClient.answer()` → `POST {LLM_API_URL}/chat/completions`
   - `LLMClient.judge()` → `POST {LLM_API_URL}/chat/completions` with `response_format: json_object`
   - `appendQuestionRecord()` → `results.jsonl` (flushed per question via `handle.sync()`)
4. `processQuestion()` wraps answer + judge with exponential backoff retry (max 3 attempts, 2^n × 1000ms)
5. Manifest status: `completed` | `partial` | `interrupted`

## Modified Files
- `benchmark/src/dataset.mjs` — rewrote LoCoMo parser: supports official top-level array format, extracts `session_N` sessions with `session_N_date_time`, sorts sessions chronologically, maps category numbers to names (1=single_hop, 2=temporal, 3=multi_hop, 4=open_domain, 5=adversarial), identifies adversarial questions, generates stable question IDs (`conv{N}-q{index}`)
- `benchmark/src/brain-server-client.mjs` — new file: HTTP client for `/api/graph/extract`, `/api/mcp/tool/unified_memory_search`, `/api/mcp/tool/graph_answer` with preflight checks
- `benchmark/src/llm-client.mjs` — new file: OpenAI-compatible client for answer generation and judge evaluation (`response_format: json_object` for judge)
- `benchmark/src/runner/index.mjs` — replaced direct `db.addEntity()` with `brainServerClient.extract()`; replaced null `llmClient` with required `LLMClient` parameter; judge failure marks question as error (not completed); added `processQuestion()` with retry, `resumeBenchmark()`, `retryErrors()`, SIGINT/SIGTERM safe shutdown via `requestShutdown()`
- `benchmark/src/run-store.mjs` — added `errorQuestionIds`, `allRecordedQuestionIds`, `verifyResumeConfig`, `findRunDir`, `updateManifest`
- `benchmark/src/cli.mjs` — rewrote to create real clients, validate env vars, support `--dataset`, `--brain-server-url`, `--runs`, `--run-id` flags; added `resume` and `retry-errors` modes
- `benchmark/src/judge/schema.mjs` — `binary_accuracy` now strictly `z.union([z.literal(0), z.literal(1)])`; added `wilsonCI()` and `computeStatistics()` (per-metric means + CI, composite + CI, answerable/adversarial subsets, category micro/macro, conversation micro/macro, error rate, fallback count); `validateAllMetricsPresent` checks binary_accuracy is 0 or 1
- `benchmark/prompts/judge-v2.txt` — removed 0.5 from binary_accuracy; clarified temporal_score, abstention_accuracy, evidence_precision, stale_memory_leakage rubrics
- `benchmark/src/recompute-metrics.mjs` — updated to use `computeStatistics`
- `benchmark/package.json` — added `benchmark:resume` and `benchmark:retry-errors` npm scripts

## Tests
- Normal path: `dataset.test.mjs` — official format parsing, session extraction, category mapping, adversarial detection, stable question IDs (17 tests)
- Normal path: `runner.test.mjs` — runner infrastructure with official-format fixture
- Normal path: `resume-retry.test.mjs` — resume skips completed questions + config hash verification; retry-errors re-runs only error questions; JSONL flush per question (14 tests)
- Normal path: `judge-calibration.test.mjs` — 30+ hand-crafted calibration samples, binary boundary (0, 1, 0.5 rejected, 0.3 rejected, 0.7 rejected), partial correctness, abstention, temporal, evidence, stale leakage, schema rejection (missing/extra/out-of-range/empty rationale), computeStatistics (empty, per-metric CI, subsets, categories, conversations, errors) (50 tests)
- Failure path: `metric-rubric.test.mjs` — strict mode rejects extra fields
- Failure path: judge failure marks question as `error` (not `completed`); config mismatch rejects resume
- Run: `cd benchmark && node --test tests/dataset.test.mjs tests/runner.test.mjs tests/resume-retry.test.mjs tests/judge-calibration.test.mjs tests/metric-rubric.test.mjs tests/harness.test.mjs`

## Remaining Risk
- Benchmark has not been run end-to-end against a live Brain Server (pending Task 15 E2E verification).
- `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` must be configured externally; CLI exits early if missing.
- Heldout split requires `dataset_manifest.json` `heldout_conversations` field.
