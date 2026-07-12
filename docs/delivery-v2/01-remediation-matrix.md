# Remediation Matrix - Pre-Evaluation Hardening Round 2

**Date:** 2026-07-12T15:58:35.707Z | **Branch:** pre-evaluation-hardening-v2 | **Commit:** 3edc177

## P0 Status Summary

| ID | Task | Status | Tests | Commit |
|---|------|--------|-------|--------|
| P0-1 | Benchmark runner | FIXED | 33 pass | 41b7a39 |
| P0-2 | Metric rubric | FIXED | 33 pass | 41b7a39 |
| P0-3 | Temporal retrieval | FIXED | 7 pass | 0608dff |
| P0-10 | Schema drift | FIXED | N/A | 1bd5d86 |
| P0-12 | AgentLoop lock | FIXED | 3 pass | 3edc177 |
| P0-13 | MCP scope mapping | FIXED | 3 pass | 3edc177 |
| P0-4 | Chat import pipeline | PARTIAL | Provenance tracking done | 3edc177 |
| P0-7 | Assertion fact layer | PARTIAL | Retrieval integration done | 0608dff |
| P0-5 | Chunk merging | BLOCKED | Requires extractor refactor | - |
| P0-6 | Relation overwriting | BLOCKED | Requires time comparator | - |
| P0-8 | Decision evidence binding | BLOCKED | Requires LLM/UI changes | - |
| P0-9 | Desktop UI lineage | BLOCKED | Requires frontend changes | - |
| P0-11 | Merge review queue | BLOCKED | Requires DB/UI changes | - |
| P0-14 | CI & key history | BLOCKED | Requires GitHub push | - |
| P0-15 | E2E verification | BLOCKED | Depends on above | - |

## Test Results

| Suite | Tests | Passed | Failed |
|-------|-------|--------|--------|
| benchmark | 33 | 33 | 0 |
| brain-server | 166 | 165 | 1 (CRLF) |
| browser-extension | 10 | 10 | 0 |
| scan-secrets | 3 | 3 | 0 |
| mobile verify | 1 | 1 | 0 |

**5 P0 FIXED, 2 PARTIAL, 8 BLOCKED. Freeze NOT yet ready.**
