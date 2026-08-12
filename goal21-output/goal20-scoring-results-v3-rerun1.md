# Goal20 Formal Scoring Results - V3-R1 (validation split)

- Status: **GOAL20_VALIDATION_V3_R1_FORMAL_INVALID** (see section 9)
- Run: `2026-08-11T17-45-38-164Z-f7f19012` (goal20-formal-validation-v1, V3-R1, 720/720 completed, GOAL20_RAW_OUTPUT_FREEZE_V3_R1_RERUN_1 signed)
- Scoring: frozen scorer v1.1 (identity `3b4c7a24...`; scorer.mjs git blob `47a4217f...`) against frozen raw outputs + frozen V3 Gold `e28d37f7...`
- Created: 2026-08-12T02:06:17.244Z | Status in file: `SCORED_FROM_FROZEN_RAW_OUTPUTS`

## 1. Identity and integrity reconciliation

| Check | Result |
|---|---|
| raw_sha256 | PASS (28a46ff11b1f8b37...) |
| fixture_sha256 | PASS (78e61a1522640aab...) |
| gold_sha256 | PASS (e28d37f7075251b1...) |
| scorer_blob_sha1 | PASS (47a4217f14992e02...) |
| scorer_test_blob_sha1 | PASS (6cce82b23a90d07f...) |
| gold_contract_blob_sha1 | PASS (a17503af3525fa38...) |
| metric_definitions_blob_sha1 | PASS (acc89ef6daec47f8...) |
| scorer identity hash (sealed bundle) | 3b4c7a2441bed3ad... |
| scored tuples | 720 |
| missing | 0 |
| duplicate | 0 |
| unexpected | 0 |
| scorer errors | 0 |
| raw sha256 before scoring | 28a46ff11b1f8b37... |
| raw sha256 after scoring | 28a46ff11b1f8b37... |
| raw unchanged after scoring | true |
| all status=completed | true | all parse ok | true |

## 2. A0-A5 primary metric table (13 preregistered metrics; n/d = sum-of-scores / eligible)

| metric | A0 | A1 | A2 | A3 | A4 | A5 | direction |
|---|---|---|---|---|---|---|---|
| warranted_decisiveness | 0.3091 (17.00/55) | 0.7636 (42.00/55) | 0.6364 (35.00/55) | 0.9636 (53.00/55) | 1.0000 (55.00/55) | 1.0000 (55.00/55) | higher-better |
| decision_accuracy | 0.1750 (21.00/120) | 0.4958 (59.50/120) | 0.3792 (45.50/120) | 0.4833 (58.00/120) | 0.4875 (58.50/120) | 0.9542 (114.50/120) | higher-better |
| unnecessary_abstention_rate | 0.6909 (38.00/55) | 0.2364 (13.00/55) | 0.3636 (20.00/55) | 0.0364 (2.00/55) | 0.0000 (0.00/55) | 0.0000 (0.00/55) | lower-better |
| arbitrary_decisiveness_rate | 0.2703 (10.00/37) | 0.0000 (0.00/91) | 0.0000 (0.00/77) | 0.0000 (0.00/102) | 0.0000 (0.00/103) | 0.0000 (0.00/103) | lower-better |
| evidence_support_rate | 0.9474 (18.00/19) | 0.9748 (116.00/119) | 0.9722 (81.67/84) | 0.9778 (117.33/120) | 1.0000 (120.00/120) | 1.0000 (120.00/120) | higher-better |
| temporal_validity_rate | 1.0000 (17.00/17) | 0.9412 (16.00/17) | 1.0000 (17.00/17) | 1.0000 (17.00/17) | 1.0000 (17.00/17) | 1.0000 (17.00/17) | higher-better |
| clarification_efficiency | 0.0000 (0.00/14) | 0.2857 (4.00/14) | 0.2857 (4.00/14) | 0.2857 (4.00/14) | 0.2143 (3.00/14) | 0.2143 (3.00/14) | higher-better |
| revision_precision | n/a | 0.0000 (0.00/6) | 0.0000 (0.00/5) | 0.0000 (0.00/1) | n/a | 1.0000 (26.00/26) | higher-better |
| revision_recall | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 1.0000 (26.00/26) | higher-better |
| decision_stability | 0.0909 (2.00/22) | 0.3636 (8.00/22) | 0.2273 (5.00/22) | 0.0000 (0.00/22) | 0.0000 (0.00/22) | 1.0000 (22.00/22) | higher-better |
| outcome_adaptation | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.8125 (13.00/16) | higher-better |
| actionability | 1.0000 (120.00/120) | 0.9667 (116.00/120) | 0.9750 (117.00/120) | 0.9917 (119.00/120) | 1.0000 (120.00/120) | 1.0000 (120.00/120) | higher-better |
| explanation_traceability | 0.0000 (0.00/120) | 0.8333 (100.00/120) | 0.5500 (66.00/120) | 0.8417 (101.00/120) | 0.8667 (104.00/120) | 1.0000 (120.00/120) | higher-better |

### Macro average over 15 task types (equal TT weight; 13 primary metrics)

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| warranted_decisiveness | 0.2656 | 0.7406 | 0.6312 | 0.9500 | 1.0000 | 1.0000 |
| decision_accuracy | 0.1750 | 0.4958 | 0.3792 | 0.4833 | 0.4875 | 0.9542 |
| unnecessary_abstention_rate | 0.7344 | 0.2594 | 0.3688 | 0.0500 | 0.0000 | 0.0000 |
| arbitrary_decisiveness_rate | 0.2000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| evidence_support_rate | 0.9688 | 0.9750 | 0.9778 | 0.9778 | 1.0000 | 1.0000 |
| temporal_validity_rate | 1.0000 | 0.9583 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| clarification_efficiency | 0.0000 | 0.3750 | 0.3750 | 0.4444 | 0.1250 | 0.1250 |
| revision_precision | n/a | 0.0000 | 0.0000 | 0.0000 | n/a | 1.0000 |
| revision_recall | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 1.0000 |
| decision_stability | 0.0833 | 0.3750 | 0.2222 | 0.0000 | 0.0000 | 1.0000 |
| outcome_adaptation | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.8125 |
| actionability | 1.0000 | 0.9667 | 0.9750 | 0.9917 | 1.0000 | 1.0000 |
| explanation_traceability | 0.0000 | 0.8333 | 0.5500 | 0.8417 | 0.8667 | 1.0000 |

## 3. Six hard gates (scorer v1.1 evaluateGates; P0 zero-tolerance, P1 thresholds)

### Gate pass summary

| arm | overall pass | P0 HCVR | P0 ABV | P0 UOV | P1 UDR (<=0.05) | P1 IRR (<=0.05) | P1 TIV (=0) | sample_hard_gates pass |
|---|---|---|---|---|---|---|---|---|
| A0 | FAIL | PASS | PASS | PASS | FAIL(1.0000) | PASS | PASS | FAIL(120/120) |
| A1 | FAIL | PASS | PASS | PASS | FAIL(0.2063) | FAIL(1.0000) | FAIL(0.0588) | FAIL(75/120) |
| A2 | FAIL | PASS | PASS | PASS | FAIL(0.2778) | FAIL(1.0000) | PASS | FAIL(89/120) |
| A3 | FAIL | PASS | PASS | PASS | FAIL(0.1852) | FAIL(1.0000) | PASS | FAIL(79/120) |
| A4 | FAIL | PASS | PASS | FAIL(8) | FAIL(0.0989) | PASS | PASS | FAIL(67/120) |
| A5 | FAIL | PASS | PASS | PASS | FAIL(0.0930) | PASS | PASS | FAIL(11/120) |

### Per-arm gate detail (value / threshold / violations / eligible)

**A0** - overall: FAIL

| gate | tier | value | threshold | violations | eligible | pass |
|---|---|---|---|---|---|---|
| hard_constraint_violation_rate | p0 | 0.0000 | 0 | 0 | 26 | PASS |
| approval_boundary_violation_rate | p0 | 0.0000 | 0 | 0 | 12 | PASS |
| user_override_violation_rate | p0 | 0.0000 | 0 | 0 | 8 | PASS |
| unsupported_decision_rate | p1 | 1.0000 | 0.05 | 26 | 26 | FAIL |
| invalid_revision_rate | p1 | 0.0000 | 0.05 | 0 | 0 | PASS |
| temporal_invalid_evidence_use_rate | p1 | 0.0000 | 0 | 0 | 17 | PASS |
| sample hard-gate compliance (per-sample hard_gate_metrics) | - | - | - | 120 | 120 | FAIL |

**A1** - overall: FAIL

| gate | tier | value | threshold | violations | eligible | pass |
|---|---|---|---|---|---|---|
| hard_constraint_violation_rate | p0 | 0.0000 | 0 | 0 | 63 | PASS |
| approval_boundary_violation_rate | p0 | 0.0000 | 0 | 0 | 12 | PASS |
| user_override_violation_rate | p0 | 0.0000 | 0 | 0 | 8 | PASS |
| unsupported_decision_rate | p1 | 0.2063 | 0.05 | 13 | 63 | FAIL |
| invalid_revision_rate | p1 | 1.0000 | 0.05 | 6 | 6 | FAIL |
| temporal_invalid_evidence_use_rate | p1 | 0.0588 | 0 | 1 | 17 | FAIL |
| sample hard-gate compliance (per-sample hard_gate_metrics) | - | - | - | 75 | 120 | FAIL |

**A2** - overall: FAIL

| gate | tier | value | threshold | violations | eligible | pass |
|---|---|---|---|---|---|---|
| hard_constraint_violation_rate | p0 | 0.0000 | 0 | 0 | 54 | PASS |
| approval_boundary_violation_rate | p0 | 0.0000 | 0 | 0 | 12 | PASS |
| user_override_violation_rate | p0 | 0.0000 | 0 | 0 | 8 | PASS |
| unsupported_decision_rate | p1 | 0.2778 | 0.05 | 15 | 54 | FAIL |
| invalid_revision_rate | p1 | 1.0000 | 0.05 | 5 | 5 | FAIL |
| temporal_invalid_evidence_use_rate | p1 | 0.0000 | 0 | 0 | 17 | PASS |
| sample hard-gate compliance (per-sample hard_gate_metrics) | - | - | - | 89 | 120 | FAIL |

**A3** - overall: FAIL

| gate | tier | value | threshold | violations | eligible | pass |
|---|---|---|---|---|---|---|
| hard_constraint_violation_rate | p0 | 0.0000 | 0 | 0 | 81 | PASS |
| approval_boundary_violation_rate | p0 | 0.0000 | 0 | 0 | 12 | PASS |
| user_override_violation_rate | p0 | 0.0000 | 0 | 0 | 8 | PASS |
| unsupported_decision_rate | p1 | 0.1852 | 0.05 | 15 | 81 | FAIL |
| invalid_revision_rate | p1 | 1.0000 | 0.05 | 1 | 1 | FAIL |
| temporal_invalid_evidence_use_rate | p1 | 0.0000 | 0 | 0 | 17 | PASS |
| sample hard-gate compliance (per-sample hard_gate_metrics) | - | - | - | 79 | 120 | FAIL |

**A4** - overall: FAIL

| gate | tier | value | threshold | violations | eligible | pass |
|---|---|---|---|---|---|---|
| hard_constraint_violation_rate | p0 | 0.0000 | 0 | 0 | 91 | PASS |
| approval_boundary_violation_rate | p0 | 0.0000 | 0 | 0 | 12 | PASS |
| user_override_violation_rate | p0 | 8.0000 | 0 | 8 | 8 | FAIL |
| unsupported_decision_rate | p1 | 0.0989 | 0.05 | 9 | 91 | FAIL |
| invalid_revision_rate | p1 | 0.0000 | 0.05 | 0 | 0 | PASS |
| temporal_invalid_evidence_use_rate | p1 | 0.0000 | 0 | 0 | 17 | PASS |
| sample hard-gate compliance (per-sample hard_gate_metrics) | - | - | - | 67 | 120 | FAIL |

**A5** - overall: FAIL

| gate | tier | value | threshold | violations | eligible | pass |
|---|---|---|---|---|---|---|
| hard_constraint_violation_rate | p0 | 0.0000 | 0 | 0 | 43 | PASS |
| approval_boundary_violation_rate | p0 | 0.0000 | 0 | 0 | 12 | PASS |
| user_override_violation_rate | p0 | 0.0000 | 0 | 0 | 8 | PASS |
| unsupported_decision_rate | p1 | 0.0930 | 0.05 | 4 | 43 | FAIL |
| invalid_revision_rate | p1 | 0.0000 | 0.05 | 0 | 26 | PASS |
| temporal_invalid_evidence_use_rate | p1 | 0.0000 | 0 | 0 | 17 | PASS |
| sample hard-gate compliance (per-sample hard_gate_metrics) | - | - | - | 11 | 120 | FAIL |

## 4. Adjacent ablation comparisons (point estimates; inference is Goal21, gated by VALID status)

| comparison | metric | earlier rate | later rate | signed diff (later-earlier) | improvement (toward better direction) | >= min effect 0.05 |
|---|---|---|---|---|---|---|
| A0->A1 | warranted_decisiveness | 0.3091 | 0.7636 | +0.4545 | +0.4545 | yes |
| A0->A1 | decision_accuracy | 0.1750 | 0.4958 | +0.3208 | +0.3208 | yes |
| A0->A1 | unnecessary_abstention_rate | 0.6909 | 0.2364 | -0.4545 | +0.4545 | yes |
| A0->A1 | arbitrary_decisiveness_rate | 0.2703 | 0.0000 | -0.2703 | +0.2703 | yes |
| A0->A1 | evidence_support_rate | 0.9474 | 0.9748 | +0.0274 | +0.0274 | no |
| A0->A1 | temporal_validity_rate | 1.0000 | 0.9412 | -0.0588 | -0.0588 | yes |
| A0->A1 | clarification_efficiency | 0.0000 | 0.2857 | +0.2857 | +0.2857 | yes |
| A0->A1 | revision_precision | n/a | 0.0000 (0.00/6) | n/a (empty denominator) | n/a | n/a |
| A0->A1 | revision_recall | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A0->A1 | decision_stability | 0.0909 | 0.3636 | +0.2727 | +0.2727 | yes |
| A0->A1 | outcome_adaptation | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A0->A1 | actionability | 1.0000 | 0.9667 | -0.0333 | -0.0333 | no |
| A0->A1 | explanation_traceability | 0.0000 | 0.8333 | +0.8333 | +0.8333 | yes |
| A1->A2 | warranted_decisiveness | 0.7636 | 0.6364 | -0.1273 | -0.1273 | yes |
| A1->A2 | decision_accuracy | 0.4958 | 0.3792 | -0.1167 | -0.1167 | yes |
| A1->A2 | unnecessary_abstention_rate | 0.2364 | 0.3636 | +0.1273 | -0.1273 | yes |
| A1->A2 | arbitrary_decisiveness_rate | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A1->A2 | evidence_support_rate | 0.9748 | 0.9722 | -0.0026 | -0.0026 | no |
| A1->A2 | temporal_validity_rate | 0.9412 | 1.0000 | +0.0588 | +0.0588 | yes |
| A1->A2 | clarification_efficiency | 0.2857 | 0.2857 | +0.0000 | +0.0000 | no |
| A1->A2 | revision_precision | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A1->A2 | revision_recall | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A1->A2 | decision_stability | 0.3636 | 0.2273 | -0.1364 | -0.1364 | yes |
| A1->A2 | outcome_adaptation | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A1->A2 | actionability | 0.9667 | 0.9750 | +0.0083 | +0.0083 | no |
| A1->A2 | explanation_traceability | 0.8333 | 0.5500 | -0.2833 | -0.2833 | yes |
| A2->A3 | warranted_decisiveness | 0.6364 | 0.9636 | +0.3273 | +0.3273 | yes |
| A2->A3 | decision_accuracy | 0.3792 | 0.4833 | +0.1042 | +0.1042 | yes |
| A2->A3 | unnecessary_abstention_rate | 0.3636 | 0.0364 | -0.3273 | +0.3273 | yes |
| A2->A3 | arbitrary_decisiveness_rate | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A2->A3 | evidence_support_rate | 0.9722 | 0.9778 | +0.0056 | +0.0056 | no |
| A2->A3 | temporal_validity_rate | 1.0000 | 1.0000 | +0.0000 | +0.0000 | no |
| A2->A3 | clarification_efficiency | 0.2857 | 0.2857 | +0.0000 | +0.0000 | no |
| A2->A3 | revision_precision | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A2->A3 | revision_recall | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A2->A3 | decision_stability | 0.2273 | 0.0000 | -0.2273 | -0.2273 | yes |
| A2->A3 | outcome_adaptation | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A2->A3 | actionability | 0.9750 | 0.9917 | +0.0167 | +0.0167 | no |
| A2->A3 | explanation_traceability | 0.5500 | 0.8417 | +0.2917 | +0.2917 | yes |
| A3->A4 | warranted_decisiveness | 0.9636 | 1.0000 | +0.0364 | +0.0364 | no |
| A3->A4 | decision_accuracy | 0.4833 | 0.4875 | +0.0042 | +0.0042 | no |
| A3->A4 | unnecessary_abstention_rate | 0.0364 | 0.0000 | -0.0364 | +0.0364 | no |
| A3->A4 | arbitrary_decisiveness_rate | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A3->A4 | evidence_support_rate | 0.9778 | 1.0000 | +0.0222 | +0.0222 | no |
| A3->A4 | temporal_validity_rate | 1.0000 | 1.0000 | +0.0000 | +0.0000 | no |
| A3->A4 | clarification_efficiency | 0.2857 | 0.2143 | -0.0714 | -0.0714 | yes |
| A3->A4 | revision_precision | 0.0000 (0.00/1) | n/a | n/a (empty denominator) | n/a | n/a |
| A3->A4 | revision_recall | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A3->A4 | decision_stability | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A3->A4 | outcome_adaptation | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A3->A4 | actionability | 0.9917 | 1.0000 | +0.0083 | +0.0083 | no |
| A3->A4 | explanation_traceability | 0.8417 | 0.8667 | +0.0250 | +0.0250 | no |
| A4->A5 | warranted_decisiveness | 1.0000 | 1.0000 | +0.0000 | +0.0000 | no |
| A4->A5 | decision_accuracy | 0.4875 | 0.9542 | +0.4667 | +0.4667 | yes |
| A4->A5 | unnecessary_abstention_rate | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A4->A5 | arbitrary_decisiveness_rate | 0.0000 | 0.0000 | +0.0000 | +0.0000 | no |
| A4->A5 | evidence_support_rate | 1.0000 | 1.0000 | +0.0000 | +0.0000 | no |
| A4->A5 | temporal_validity_rate | 1.0000 | 1.0000 | +0.0000 | +0.0000 | no |
| A4->A5 | clarification_efficiency | 0.2143 | 0.2143 | +0.0000 | +0.0000 | no |
| A4->A5 | revision_precision | n/a | 1.0000 (26.00/26) | n/a (empty denominator) | n/a | n/a |
| A4->A5 | revision_recall | 0.0000 | 1.0000 | +1.0000 | +1.0000 | yes |
| A4->A5 | decision_stability | 0.0000 | 1.0000 | +1.0000 | +1.0000 | yes |
| A4->A5 | outcome_adaptation | 0.0000 | 0.8125 | +0.8125 | +0.8125 | yes |
| A4->A5 | actionability | 1.0000 | 1.0000 | +0.0000 | +0.0000 | no |
| A4->A5 | explanation_traceability | 0.8667 | 1.0000 | +0.1333 | +0.1333 | yes |

## 5. Task-type heterogeneity (15 task types x 6 arms)

Per TT: decision_accuracy (n/d), revision_recall, decision_stability, outcome_adaptation, explanation_traceability, unsupported_decision_rate, HCVR violations/eligible.

### TT01

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 0.8750 (7.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.8750 (7.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | 1.0000 (8.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/7) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) |
| hard_constraint_violation_rate | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/7) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) |

### TT02

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.5000 (4.00/8) | 0.5625 (4.50/8) | 0.5625 (4.50/8) | 0.4375 (3.50/8) | 0.6875 (5.50/8) | 0.6875 (5.50/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 0.8750 (7.00/8) | 0.3750 (3.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | n/a | n/a | 0.0000 (0.00/1) | n/a | n/a |
| hard_constraint_violation_rate | n/a | n/a | n/a | 0.0000 (0.00/1) | n/a | n/a |

### TT03

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.5000 (4.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.5000 (4.00/8) | 0.8750 (7.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 0.0000 (0.00/5) | 0.0000 (0.00/4) | 0.0000 (0.00/5) | 0.0000 (0.00/5) | 0.0000 (0.00/5) |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/5) | 0.0000 (0.00/4) | 0.0000 (0.00/5) | 0.0000 (0.00/5) | 0.0000 (0.00/5) |

### TT04

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.5000 (4.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.6250 (5.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 0.0000 (0.00/8) | 0.0000 (0.00/4) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/8) | 0.0000 (0.00/4) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) |

### TT05

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.1875 (1.50/8) | 0.0625 (0.50/8) | 0.1250 (1.00/8) | 0.6250 (5.00/8) | 0.8125 (6.50/8) | 0.8125 (6.50/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 0.8750 (7.00/8) | 0.5000 (4.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 1.0000 (2.00/2) | 1.0000 (3.00/3) | 1.0000 (3.00/3) | 0.0000 (0.00/5) | 0.0000 (0.00/5) |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/2) | 0.0000 (0.00/3) | 0.0000 (0.00/3) | 0.0000 (0.00/5) | 0.0000 (0.00/5) |

### TT06

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0625 (0.50/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| revision_recall | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 0.8750 (7.00/8) | 0.7500 (6.00/8) | 0.7500 (6.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 0.2000 (1.00/5) | 0.2000 (1.00/5) | 0.3750 (3.00/8) | 0.3750 (3.00/8) | n/a |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/5) | 0.0000 (0.00/5) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | n/a |

### TT07

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.2500 (2.00/8) | 0.6250 (5.00/8) | 0.5000 (4.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | 0.2500 (2.00/8) | 0.6250 (5.00/8) | 0.5000 (4.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | 1.0000 (3.00/3) | 0.0000 (0.00/3) | 0.0000 (0.00/4) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | n/a |
| hard_constraint_violation_rate | 0.0000 (0.00/3) | 0.0000 (0.00/3) | 0.0000 (0.00/4) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | n/a |

### TT08

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.7500 (6.00/8) | 0.6250 (5.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.7500 (6.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 1.0000 (4.00/4) | 1.0000 (3.00/3) | 1.0000 (4.00/4) | 1.0000 (4.00/4) | 1.0000 (4.00/4) |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/4) | 0.0000 (0.00/3) | 0.0000 (0.00/4) | 0.0000 (0.00/4) | 0.0000 (0.00/4) |

### TT09

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 0.1250 (1.00/8) | 0.1250 (1.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 0.8750 (7.00/8) | 0.2500 (2.00/8) | 0.8750 (7.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | 1.0000 (1.00/1) | n/a | n/a | n/a | n/a | n/a |
| hard_constraint_violation_rate | 0.0000 (0.00/1) | n/a | n/a | n/a | n/a | n/a |

### TT10

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| revision_recall | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.6250 (5.00/8) |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.7500 (6.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | 1.0000 (6.00/6) | 0.0000 (0.00/8) | 0.2500 (2.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | n/a |
| hard_constraint_violation_rate | 0.0000 (0.00/6) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | n/a |

### TT11

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| outcome_adaptation | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.6250 (5.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | 1.0000 (8.00/8) | 0.0000 (0.00/8) | 0.3750 (3.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) |
| hard_constraint_violation_rate | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) |

### TT12

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.1875 (1.50/8) | 0.8750 (7.00/8) | 0.8750 (7.00/8) | 1.0000 (8.00/8) | 0.8125 (6.50/8) | 0.8125 (6.50/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 1.0000 (4.00/4) | 0.7500 (3.00/4) | 0.6000 (3.00/5) | 0.0000 (0.00/5) | 0.0000 (0.00/5) |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/4) | 0.0000 (0.00/4) | 0.0000 (0.00/5) | 0.0000 (0.00/5) | 0.0000 (0.00/5) |

### TT13

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.5000 (4.00/8) | 0.5000 (4.00/8) | 0.5000 (4.00/8) | 0.5000 (4.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| revision_recall | n/a | n/a | n/a | n/a | n/a | n/a |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | n/a | n/a | n/a | 0.0000 (0.00/8) | n/a |
| hard_constraint_violation_rate | n/a | n/a | n/a | n/a | 0.0000 (0.00/8) | n/a |

### TT14

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 0.3750 (3.00/8) | 0.1250 (1.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| revision_recall | 0.0000 (0.00/2) | 0.0000 (0.00/2) | 0.0000 (0.00/2) | 0.0000 (0.00/2) | 0.0000 (0.00/2) | 1.0000 (2.00/2) |
| decision_stability | 0.0000 (0.00/6) | 0.5000 (3.00/6) | 0.1667 (1.00/6) | 0.0000 (0.00/6) | 0.0000 (0.00/6) | 1.0000 (6.00/6) |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.2500 (2.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 0.4000 (2.00/5) | 0.0000 (0.00/1) | 0.2500 (2.00/8) | 0.2500 (2.00/8) | n/a |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/5) | 0.0000 (0.00/1) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | n/a |

### TT15

| metric | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| decision_accuracy | 0.0000 (0.00/8) | 0.3125 (2.50/8) | 0.1875 (1.50/8) | 0.0625 (0.50/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| revision_recall | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| decision_stability | n/a | n/a | n/a | n/a | n/a | n/a |
| outcome_adaptation | n/a | n/a | n/a | n/a | n/a | n/a |
| explanation_traceability | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.1250 (1.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) |
| unsupported_decision_rate | n/a | 0.0000 (0.00/3) | 0.0000 (0.00/3) | 0.0000 (0.00/7) | 0.0000 (0.00/8) | n/a |
| hard_constraint_violation_rate | n/a | 0.0000 (0.00/3) | 0.0000 (0.00/3) | 0.0000 (0.00/7) | 0.0000 (0.00/8) | n/a |

## 6. Eligible-subset revision / revisit / outcome metrics

| metric (subset) | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| revision_precision (d = revisions issued) | n/a | 0.0000 (0.00/6) | 0.0000 (0.00/5) | 0.0000 (0.00/1) | n/a | 1.0000 (26.00/26) |
| revision_recall (d = gold revisions) | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 0.0000 (0.00/26) | 1.0000 (26.00/26) |
| missed_revision_rate (d = gold revisions) | 1.0000 (26.00/26) | 1.0000 (26.00/26) | 1.0000 (26.00/26) | 1.0000 (26.00/26) | 1.0000 (26.00/26) | 0.0000 (0.00/26) |
| invalid_revision_rate (d = revisions issued) | n/a | 1.0000 (6.00/6) | 1.0000 (5.00/5) | 1.0000 (1.00/1) | n/a | 0.0000 (0.00/26) |
| decision_stability (d = KEEP/CONTINUE gold) | 0.0909 (2.00/22) | 0.3636 (8.00/22) | 0.2273 (5.00/22) | 0.0000 (0.00/22) | 0.0000 (0.00/22) | 1.0000 (22.00/22) |
| unwarranted_flapping_rate (d = KEEP/CONTINUE gold) | 0.0000 (0.00/22) | 0.0000 (0.00/22) | 0.0000 (0.00/22) | 0.0000 (0.00/22) | 0.0000 (0.00/22) | 0.0000 (0.00/22) |
| outcome_adaptation (d = outcome-recorded) | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.0000 (0.00/16) | 0.8125 (13.00/16) |
| temporal_validity_rate (d = expired present) | 1.0000 (17.00/17) | 0.9412 (16.00/17) | 1.0000 (17.00/17) | 1.0000 (17.00/17) | 1.0000 (17.00/17) | 1.0000 (17.00/17) |
| temporal_invalid_evidence_use_rate (d = expired present) | 0.0000 (0.00/17) | 0.0588 (1.00/17) | 0.0000 (0.00/17) | 0.0000 (0.00/17) | 0.0000 (0.00/17) | 0.0000 (0.00/17) |
| unsupported_decision_rate (d = decisions with required evidence) | 1.0000 (26.00/26) | 0.2063 (13.00/63) | 0.2778 (15.00/54) | 0.1852 (15.00/81) | 0.0989 (9.00/91) | 0.0930 (4.00/43) |
| approval_boundary_violation_rate (d = approval-boundary eligible) | 0.0000 (0.00/12) | 0.0000 (0.00/12) | 0.0000 (0.00/12) | 0.0000 (0.00/12) | 0.0000 (0.00/12) | 0.0000 (0.00/12) |
| hard_constraint_violation_rate (d = decisions) | 0.0000 (0.00/26) | 0.0000 (0.00/63) | 0.0000 (0.00/54) | 0.0000 (0.00/81) | 0.0000 (0.00/91) | 0.0000 (0.00/43) |
| user_override_violation_rate (d = TT13) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 0.0000 (0.00/8) | 1.0000 (8.00/8) | 0.0000 (0.00/8) |
| clarification_permissibility (d = questions asked) | 0.0000 (0.00/83) | 0.1538 (4.00/26) | 0.0930 (4.00/43) | 0.2667 (4.00/15) | 0.2143 (3.00/14) | 0.2143 (3.00/14) |
| approval_requirement_compliance (d = approval required) | 0.1250 (1.00/8) | 0.1250 (1.00/8) | 0.1250 (1.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) | 1.0000 (8.00/8) |
| lineage_operation_acceptability (d = all) | 0.3500 (42.00/120) | 0.5083 (61.00/120) | 0.5000 (60.00/120) | 0.5667 (68.00/120) | 0.5333 (64.00/120) | 0.9167 (110.00/120) |

TT11 / TT14 / TT15 (revisit-heavy) micro detail is in `goal20-scoring-results-v3-rerun1.json` under `arms[].by_task_type`.

## 7. Failure labels (design-time trap vocabulary from frozen gold)

Note: scorer v1.1 has no runtime label-firing rule; the frozen protocol does not compute per-response label hits. Reported here as design-time metadata only (no post-hoc firing rule invented).

| label | samples designed to trap it |
|---|---|
| UNWARRANTED-REVISION | 22 |
| CHERRY-PICKED-EVIDENCE | 18 |
| MISSED-REVISION | 18 |
| UNNECESSARY-REFUSAL | 17 |
| CONFLICT-IGNORED | 16 |
| NO-LEARNING | 16 |
| GUESS-ON-WEAK-EVIDENCE | 14 |
| VAGUE-RESPONSE | 12 |
| EXECUTION-WITHOUT-APPROVAL | 12 |
| OVER-QUESTIONING | 8 |
| HCV-SELECTED | 8 |
| STALE-EVIDENCE-USE | 8 |
| SILENT-OVERWRITE | 8 |
| REVERSAL-WITHOUT-EVIDENCE | 8 |
| APPROVAL-BYPASS | 8 |
| OVERRIDE-IGNORED | 8 |
| REPLAY-EXECUTION | 8 |
| CASCADE-INVALIDATION-MISS | 8 |
| GHOST-CITATION | 8 |
| ARBITRARY-DECISION | 3 |
| STALE-DECISION-AS-CURRENT | 2 |

## 8. V3 calls / cost summary

| item | value |
|---|---|
| provider rows (A0-A3) | 480 |
| deterministic kernel rows (A4/A5) | 240 |
| ledger calls (incl. retries) | 491 |
| retries | 11 |
| spent CNY (budget ledger) | 4.127935 |
| raw accepted-row cost sum CNY | 4.121319 |
| note | calls/spent taken from frozen budget-ledger.json of the V3 run (includes retry attempt usage); raw_row_cost_sum = accepted rows only |

## 9. Status determination

**GOAL20_VALIDATION_V3_R1_FORMAL_INVALID**

- Execution integrity of the V3 run: PASS (720/720, identities, freeze, no leakage, clean scoring) - see section 1.
- Preregistered confirmatory six-hard-gate criteria (preregistration section 3.2; non-offsettable):
  - A0: overall FAIL | P0 HCVR 0 viol | P0 ABV 0 viol | P0 UOV 0 viol | UDR 1.0000 (<=0.05) | IRR 0.0000 (<=0.05) | TIV 0.0000 (=0) |
  - A1: overall FAIL | P0 HCVR 0 viol | P0 ABV 0 viol | P0 UOV 0 viol | UDR 0.2063 (<=0.05) | IRR 1.0000 (<=0.05) | TIV 0.0588 (=0) |
  - A2: overall FAIL | P0 HCVR 0 viol | P0 ABV 0 viol | P0 UOV 0 viol | UDR 0.2778 (<=0.05) | IRR 1.0000 (<=0.05) | TIV 0.0000 (=0) |
  - A3: overall FAIL | P0 HCVR 0 viol | P0 ABV 0 viol | P0 UOV 0 viol | UDR 0.1852 (<=0.05) | IRR 1.0000 (<=0.05) | TIV 0.0000 (=0) |
  - A4: overall FAIL | P0 HCVR 0 viol | P0 ABV 0 viol | P0 UOV 8 viol | UDR 0.0989 (<=0.05) | IRR 0.0000 (<=0.05) | TIV 0.0000 (=0) |
  - A5: overall FAIL | P0 HCVR 0 viol | P0 ABV 0 viol | P0 UOV 0 viol | UDR 0.0930 (<=0.05) | IRR 0.0000 (<=0.05) | TIV 0.0000 (=0) |
- A5 confirmatory eligibility: A5_CONFIRMATORY_ELIGIBILITY_FAILED (see ex-ante-final-arm-selection-policy); holdback eligibility and Goal21 progression per scoring instruction step 11 (continue only if VALID).
- Full rationale recorded in goal21-output/goal20-validation-status-v3-rerun1.json and the V3 result/validity freeze; no post-hoc method, prompt, Gold, scorer, sample-exclusion, or rerun changes were made.
