# Goal 20R-V3-R1 — Formal Validation Run Failure Record (FAIL CLOSED)

- Record: `goal20r-output/VALIDATION_V3_R1_RUN_FAILURE_RECORD.md`
- Freeze: `goal20-formal-execution-governance-v3/governance/GOAL20_INVALID_RUN_V3_R1_FREEZE.json`
- Status: **INVALID_NON_CONFIRMATORY** (executor FAILED marker)
- Blocker: **GOAL20_VALIDATION_V3_RUN_PROVIDER_FAILED** (genuine blocker; §20 final status)

## Run identity
- run_id: `2026-08-11T10-41-53-720Z-518b14f2`
- run_dir: `goal20-formal-execution-governance-v3/runs/goal20-formal-validation-v1/2026-08-11T10-41-53-720Z-518b14f2`
- epoch: v3 (Validation V3-R1); campaign: goal20-formal-validation-v1
- fixture sha `78e61a1522640aab7e8d0872faefc68553e41dc3abd73ba7073248124550f85e`; gold sha `e28d37f7075251b18479380132453b53f3141ce9a4289b32d427ded50bccf0c0`
- launch: gates ALL_GATES_PASS (13/13 formal mode); first tuple completed 2026-08-11T10:42:14Z; finalized 2026-08-11T15:37:39.401Z (295.8 min)

## Failure detail
- processed 720; completed 719; **provider_failed 1**; parse_failed 0; kernel_failed 0
- failed tuple: g20-711 | `decision-bench-v3-val-tt15-006` | arm **A3**
- 5 consecutive attempts, all `EMPTY_CONTENT` (12:55:53Z, 12:55:55Z, 12:55:58Z, 12:56:01Z, 12:56:04Z) -> frozen `empty_content_max_attempts = 5` exhausted -> recorded fatal in `errors.jsonl` -> executor ended run with FAILED marker
- retries.jsonl total: 16 records (15 EMPTY_CONTENT + 1 PARSE_FAILED); 8 tuples recovered after retry; 1 tuple exhausted
- 0 rows with finish_reason=length; max completion_tokens 22997 < 65536 ceiling -> **no output-cap truncation**
- model identity: deepseek-v4-flash on 479/479 accepted provider rows; MODEL_IDENTITY_MISMATCH = 0
- unique (sample_id, arm) = 720; duplicate = 0

## Cost
- ledger calls 495 (479 accepted provider attempts + 16 retries); kernel rows 240 (A4/A5 deterministic, no provider call)
- spent_cny = **4.662605** (DeepSeek budget ¥200; total cap ¥220 untouched; no overspend)

## Why this is fail-closed (no auto-remediation)
- V2.4 frozen execution protocol: EMPTY_CONTENT retry max 5; exhausted budget -> provider_failed; no automatic retry beyond the frozen budget.
- Prior owner amendments: no further retry-taxonomy amendment is automatically authorized; no ceiling/parameter tuning; a failed formal run must be reported for a new scientific decision.
- Therefore: **no scoring, no raw-output freeze, no second run, no reuse of the 719 completed tuples as formal evidence, no modification of the FAILED run.**

## Preservation
- Run directory byte-pinned in `GOAL20_INVALID_RUN_V3_R1_FREEZE.json` (744 files, per-file sha256 + bytes), including FAILED marker, raw-results.jsonl, budget-ledger.json, retries.jsonl, errors.jsonl, attempts/*.
- V3 freeze chain remains historical: VALIDATION_V3_FREEZE -> FORMAL_METHOD_FREEZE -> LAUNCH_FREEZE -> GOVERNANCE_FREEZE -> FORMAL_EXECUTION_READY (unchanged; READY was signed with 0 formal calls and remains the launch freeze record).
- Holdback: not accessed (sealed; custody untouched).

## Next step (owner decision required)
A replacement V3-R1 formal execution requires a new owner scientific decision (e.g., re-run with identical frozen protocol; the failing slot observed twice: V2.2 tuple 711/A3 EMPTY_CONTENT x3 and V3-R1 tuple 711/A3 EMPTY_CONTENT x5). No automatic relaunch is authorized.