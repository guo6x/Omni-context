# 05 — Conversation 1 complete run report

Status: **BLOCKED**

## Required formal run

The required target is a fresh, uninterrupted, official LoCoMo Conversation 1 run containing all 19 sessions and every QA item, using the real extraction model, semantic embeddings, answer model, and judge model.

No such run is claimed. The environment audit found no usable `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`/`ANSWER_MODEL`, judge configuration, or semantic embedding provider configuration. The harness fails closed when those prerequisites are absent or when hash fallback is detected.

## What is verified

- The official Conversation 1 streaming audit reports 19 sessions and 199 questions without reading later conversations.
- Per-conversation runtime, ingestion diagnostics, checkpointing, structured answers, citation validation, and deterministic metrics are implemented and tested.
- Synthetic integration tests are not reported as formal LoCoMo quality results.

## Missing acceptance evidence

- complete run directory and manifest;
- 19/19 real extraction diagnostics with entity/assertion/relationship deltas;
- 199/199 result records with no missing or duplicate question IDs;
- real metric summary and category breakdown;
- provider/model identifiers and semantic embedding health from that run.

This blocker also prevents manual review of 10–20 official judge outputs. See `04-extraction-quality-root-cause.md` and `10-judge-calibration-report.md`.
