# Validation 120 Contract Audit (goal18-output)

**Overall:** FAIL · **Samples:** 120 (15 task types × 8)

| Dimension | PASS | FAIL | AMBIGUOUS |
|---|---|---|---|
| authority_action | 119 | 1 | 0 |
| deleted_source_provenance | 112 | 8 | 0 |
| action_eligibility | 119 | 1 | 0 |
| approval_confirmation | 120 | 0 | 0 |
| lineage | 120 | 0 | 0 |
| evidence | 112 | 8 | 0 |
| constraints | 120 | 0 | 0 |
| clarification | 120 | 0 | 0 |
| referential_integrity | 120 | 0 | 0 |

## Failing samples

### decision-bench-v2-val-tt03-002
- **authority_action:** FAIL — authority L0 does not grant AI decision/action right; DECIDE gate requires "authority allows" (K:195; A decision_right L0=user; A can_decide=L0=false); acceptable_actions include executive action under L0 (complete full-credit set must be authority-compatible)
- **action_eligibility:** FAIL — DECIDE requires authority allows (K:195; L0/L1 decision_right=user)
### decision-bench-v2-val-tt15-000
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)
### decision-bench-v2-val-tt15-001
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)
### decision-bench-v2-val-tt15-002
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)
### decision-bench-v2-val-tt15-003
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)
### decision-bench-v2-val-tt15-004
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)
### decision-bench-v2-val-tt15-005
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)
### decision-bench-v2-val-tt15-006
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)
### decision-bench-v2-val-tt15-007
- **evidence:** FAIL — qualified ev001 sources deleted event e001 (RI-06)
- **deleted_source_provenance:** FAIL — qualified evidence ev001 references deleted source e001 (RI-06; prohibited source not current)

## Method

Every dimension is derived from the frozen runtime/gold contracts (K section 7/15, A authority model, P policy rules, G/B gold contract, scorer v1.1 semantics). No dimension is inferred from Gold alone or from HR1 answers.
