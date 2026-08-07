# Annotation Guide — Decision Benchmark v2

## 1. Roles
- Constructor: builds memory timeline, decision question, candidates, constraints, evidence, gold (expected_action + explanations + failure labels + scoring).
- Gold reviewer: re-derives gold from scenario fields only (no Kernel output, no constructor gold) and compares field-by-field.
- Second reviewer: spot-checks >=10% stratified plus every adjudicated sample.
- Adjudicator: resolves disagreements; every adjudicated sample is logged in adjudication-log.jsonl.

## 2. Sample anatomy (v2 schema)
- sample_id: decision-bench-v2-{val|holdback}-tt{NN}-{idx}
- scenario: query_time, authority_level L0-L5, risk level (negligible/low/medium/high/critical), reversibility, prompt (= decision_question), distractor_variables
- memory_timeline: events with writer identity, timestamps, supersedes/derived_from/targets links
- evidence: qualified (current, valid at query_time), expired (valid_until < query_time; expiry_reason in superseded/timed_out/retracted/source_deleted), conflicting (open/resolved)
- gold: expected_action, acceptable_explanations (must_include/must_cite), severe_failure_labels, scoring

## 3. Gold contract rules (GOLD-C1..C12)
- C1 preferred_action == action; C2 action in acceptable_actions; C3 acceptable and prohibited disjoint
- C4 required_evidence non-empty subset of qualified; C5 prohibited_evidence subset of expired; C6 disjoint from required
- C7 mandatory_constraints == hard_constraints ids
- C8 CLARIFY: permissible == [key_question.variable]; C9 forbidden == distractor_variables
- C10 approval_requirement: required iff high/critical risk or irreversible; gate = approval | propose_confirm (L2) | none
- C11 acceptable_lineage_operations: implied op present; revision ops parent = historical decision id; none => null parent
- C12 hard_gate_metrics: includes primary_metric; every gate metric scores perfectly for the gold response under scorer v1.1

## 4. Action discipline
- preferred_action must not be the only acceptable action unless the task has a single legal action (TT09 APPROVAL_REQUEST, TT14 KEEP on unchanged revisit, TT03 REJECT on no feasible option, TT13 OVERRIDE_HONOR).
- DECIDE golds may list PROPOSE_CONFIRM as acceptable alternative; REVISE/REVERSE and INVALIDATE/REVISE are interchangeable families where the constructor variant picks the preferred.

## 5. Approval boundary discipline
- Non-DECIDE/PROPOSE_CONFIRM/APPROVAL_REQUEST golds must avoid low+reversible, L2, and high/critical/irreversible cells (scorer v1.1 approval boundary semantics).
- L2 authority => PROPOSE_CONFIRM gold (TT08). High/critical/irreversible => APPROVAL_REQUEST gold (TT09).

## 6. Failure labels
- 1-4 labels per sample from the 26-code vocabulary; labels name the adversarial failure modes the sample is designed to trap.
- MISSED-REVISION / UNWARRANTED-REVISION are mutually exclusive; STALE-EVIDENCE-USE + CHERRY-PICKED-EVIDENCE may co-occur.

## 7. Evidence & timeline hygiene
- Events sorted by timestamp; valid_from <= valid_until; supersedes points to an earlier event.
- Qualified evidence must be dated <= query_time; expired evidence must have valid_until < query_time.
- A deleted source event must have a corresponding expired artifact with expiry_reason source_deleted.

## 8. Quality bar
- Every sample must pass schema validation and the 18-check integrity suite (benchmark-integrity-tests).
- Gold responses must score DA=1 and pass all hard gates; adversarial responses must fail P0/P1 gates.
- Cross-split 8-gram Jaccard < 0.5 (design target < 0.4); titles, entity pools, and time windows disjoint between splits.

## 9. Freeze rules
- Validation: frozen after manifest generation; no sample-level patching after validation.
- Holdback: sealed; any byte change invalidates the split; invalid-run protocol only (no in-place repair).
