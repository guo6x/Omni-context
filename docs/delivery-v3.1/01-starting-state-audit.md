# Omni-Context v3.1 starting-state audit

Status: `PARTIAL`

Audit date: 2026-07-13 (Asia/Shanghai)

## Source baseline

- Repository: `https://github.com/guo6x/Omni-context`
- Remote baseline branch: `origin/pre-evaluation-hardening-v3`
- Remote baseline HEAD after `git fetch --prune` and `git pull --ff-only`: `cdb3490da499054696799964395cfeeec5b74837`
- Working branch created from that exact commit: `pre-evaluation-hardening-v3.1`
- `main` was not modified or merged.
- Starting worktree was clean.

## Evaluation-data boundary

- Only official LoCoMo Conversation 1 is authorized in this hardening round.
- The Conversation 1 audit reader stops as soon as the first top-level JSON object closes.
- Conversation 2-10 content was not run, viewed, analyzed, or counted.
- The official Conversation 1 contains exactly 19 sessions and 199 questions.

## Confirmed starting blockers

| Task | Starting status | Confirmed baseline gap |
|---|---|---|
| 1. LoCoMo datetime parser | `BLOCKED` | Parser delegated ambiguous strings to `new Date(string)`, returned null silently, and sorted by session number. |
| 2. Per-conversation runtime | `BLOCKED` | Runner accepted an already-running shared Brain Server and had no per-conversation DB/process lifecycle. |
| 3. Extraction quality | `BLOCKED` | Runner only accumulated endpoint counts and did not preserve the requested per-session extraction diagnostics. |
| 4. Complete Conversation 1 | `BLOCKED` | Existing evidence did not prove all 199 official questions completed. |
| 5. Resume and retry | `BLOCKED` | Retry aggregation remained zero and resume depended on external shared DB state. |
| 6. Structured citations | `BLOCKED` | Answer model returned plain text; retrieval IDs were saved independently of answer claims. |
| 7. Evidence Precision | `BLOCKED` | Judge received only `evidence_count`; citation existence/support was not deterministically assembled. |
| 8. Stale Memory Leakage | `BLOCKED` | Judge did not receive assertion validity intervals and guessed this metric. |
| 9. Judge calibration | `BLOCKED` | Existing calibration samples exercised the old all-metrics judge schema, not the required ownership split. |
| 10. Held-out authorization | `BLOCKED` | Split guard accepted a string, but runner did not pass it or validate a freeze manifest. |
| 11. AgentLoop timeout | `BLOCKED` | Timeout path could release `isCycleRunning` before the old cycle's `finally`. |
| 12. Merge revert | `BLOCKED` | Audit stored redirect counts, not the original endpoints/FTS/vector state needed for restoration. |
| 13. Current HEAD CI | `BLOCKED` | Existing report referenced an older 8/9 run, not current HEAD 9/9. |
| 14. Client/hardware E2E | `BLOCKED` | Prior artifacts did not prove installed Windows, paired browser capture/revocation, and ESP32 accepted paths. |
| 15. Freeze Candidate | `BLOCKED` | Multiple P0 blockers remained, so Freeze Candidate creation was forbidden. |

## Environment and storage policy

All new project artifacts, benchmark runs, databases, logs, build outputs, and any downloaded dependencies must be placed on D: or E:. No new environment or large download is to be placed on C:. This audit used the existing repository and official dataset on D:.

## Evidence

- Date/parser and official Conversation 1 metadata: `docs/delivery-v3.1/evidence/datetime-parser/official-conversation1-parse.json`
- Full benchmark test output after the first production fix: `docs/delivery-v3.1/evidence/datetime-parser/benchmark-tests.log`

