# 05 — Conversation 1 complete run report

Status: **BLOCKED**

## Required formal run

The required target is a fresh, uninterrupted, official LoCoMo Conversation 1 run containing all 19 sessions and every QA item, using the real extraction model, semantic embeddings, answer model, and judge model.

No such run is claimed. The environment audit found no usable `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`/`ANSWER_MODEL`, judge configuration, or semantic embedding provider configuration. The harness fails closed when those prerequisites are absent or when hash fallback is detected.

## Exact official-run accounting

| Field | Value |
|---|---:|
| official expected questions | 199 |
| provider-backed completed questions | 0 |
| provider-backed error records | 0 |
| provider-backed retry records | 0 |
| missing official questions | 199 |
| duplicate completed question IDs | 0 |
| run ID | not created |
| entity / relationship / assertion totals | not produced |
| extraction failures | not produced |
| metrics / recomputed metrics | not produced |

The zero error count does not mean a successful run: no formal run exists, all 199 questions are missing, and manifest status is therefore unavailable rather than completed.

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
