# Round 2 Q2 acceptable_actions Corrigendum

**Status:** INVALID_DUE_TO_REPRESENTATION_MISMATCH

**Formal construct agreement:** MUST_NOT_BE_USED_AS_FORMAL_CONSTRUCT_AGREEMENT

## Frozen gold definition

`acceptable_actions` = the complete full-credit action set; `preferred_action ∈ acceptable_actions`; disjoint from `prohibited_actions` (G:39-60; B:870, GOLD-C2/C3).

## Human UI semantics

Q2 asked: 除了首选处理方式，还有哪些方式也能接受？ (multi-select, no upper limit, explicitly **different from the Q1 preferred action**).

The export wrote `acceptable_actions = Q2 selections` directly, so the human raw set is NOT the complete full-credit set required by the gold contract.

## Ruling

- The formal human–gold agreement on `acceptable_actions` is **invalid due to representation mismatch**.
- Round 2 raw acceptable-set metrics (exact 1/45, Jaccard mean 0.0556, median 0.0) are retained only as **historical pipeline output**.
- Original `human-review-raw-round2.jsonl`, `human-review-round2-agreement.json`, and `human-review-round2-agreement-report.md` are preserved byte-identical.

## Diagnostic-only reconstruction

`HR1 reconstructed full acceptable set = {Q1 preferred} ∪ {Q2 selections}`

- exact-set: 3/45 = 6.67%
- Jaccard mean: 0.2444
- Jaccard median: 0.0000
- Flags: DIAGNOSTIC_ONLY / POST_HOC_REPRESENTATION_RECONSTRUCTION / NOT_PREREGISTERED_FORMAL_METRIC

This reconstruction is diagnostic only and must not replace the raw measurement or be reported as formal human–gold agreement.
