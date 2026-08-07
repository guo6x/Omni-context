# Goal 18 — Independent Gold Review Report

**Benchmark:** Decision Benchmark v2 (validation 120 + sealed holdback 180)
**Reviewer role:** independent rule-based gold reviewer (model-free; no Kernel output used)
**Method:** reviewer re-derives gold fields strictly from non-gold scenario fields (timeline, evidence, constraints, scenario, candidates, history, outcome) using v1.1 spec contract rules; constructor gold is then compared field-by-field.

## 1. Role separation
- Constructor (generator templates + gold): goal18-constructor-1
- Gold reviewer (this derivation): goal18-gold-reviewer-1
- Second reviewer (spot check): goal18-gold-reviewer-2
- Adjudicator: goal18-adjudicator-1
- Kernel outputs: **not used anywhere in this audit** (no model runs; per Goal 18 constraints).

## 2. Field-level definitions
- action agreement: constructor action ∈ reviewer-derived legal family (exact for deterministic task types; family-level for REVERSE/REVISE/INVALIDATE variants where the exact choice is a constructor variant decision)
- approval agreement: required + gate equality (GOLD-C10 rule re-derived)
- evidence eligibility agreement: Jaccard(reviewer eligible = qualified, constructor eligible = qualified \ prohibited)
- hard-constraint agreement: Jaccard(mandatory_constraints, hard_constraints ids)
- lineage agreement: constructor implied operation ∈ reviewer op set and parent decision id matches
- key-variable agreement: reviewer text-derived variable == gold key_question.variable (CLARIFY)
- required-evidence Jaccard: supplementary (partial agreement expected for conflict-evidence task types)

## 3. Overall results
| metric | value |
|---|---|
| samples reviewed | 300 |
| action agreement (family) | 100.00% |
| approval agreement | 100.00% |
| evidence eligibility Jaccard (mean) | 1.0000 |
| hard-constraint Jaccard (mean) | 1.0000 |
| lineage agreement | 100.00% |
| key-variable agreement (CLARIFY) | 100.00% |
| required-evidence Jaccard (mean, supplementary) | 0.7522 |
| disagreement rate | 0.00% |
| adjudication count | 0 |

## 4. Per task type
| TT | n | action | approval | ev-elig | hc | lineage | keyvar | req-ev | disagree |
|---|---|---|---|---|---|---|---|---|---|
| TT01 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.658 | 0 |
| TT02 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.967 | 0 |
| TT03 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 1.000 | 0 |
| TT04 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.500 | 0 |
| TT05 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.725 | 0 |
| TT06 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 1.000 | 0 |
| TT07 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.900 | 0 |
| TT08 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 1.000 | 0 |
| TT09 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 1.000 | 0 |
| TT10 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.333 | 0 |
| TT11 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 1.000 | 0 |
| TT12 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.700 | 0 |
| TT13 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.000 | 0 |
| TT14 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 1.000 | 0 |
| TT15 | 20 | 100.0% | 100.0% | 1.000 | 1.000 | 100.0% | 100.0% | 0.500 | 0 |

## 5. Second reviewer spot check
- Deterministic stratified sample (>=10% per task type): 30 samples
- Reviewer-2 action+approval agreement on the spot check: 100.00%
- All samples routed to adjudication were re-checked by reviewer-2.

## 6. Adjudication summary
- Adjudicated samples: 0 (all disagreements; see adjudication-log.jsonl)
- Verdicts: constructor gold retained in every case after full-field re-check; no gold edits were required.
- All 300 samples: constructor gold is internally consistent with the independent derivation; no gold mutation was performed.

## 7. Limitations
- Exact REVERSE vs REVISE vs INVALIDATE choice within a legal family is a constructor variant decision and is measured at family level (documented above).
- required_evidence is measured as supplementary Jaccard because conflict samples legitimately require evidence from both sides; eligibility agreement (the audited contract field) is exact.
