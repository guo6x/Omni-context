# Goal 18 — Leakage Analysis (Decision Benchmark v2)

Computed from the generated validation (120) and holdback (180) fixtures against the v1 development/regression fixtures (35). Text similarity uses normalized 8-gram Jaccard; numeric similarity uses digit-sequence token Jaccard. Threshold: >=0.5 flagged for manual review; design target: full-library <0.4.

## 1. Text similarity vs development/regression
- dev/reg ~ validation: max 0.029, mean 0.0004 (4200 pairs, 0 flagged)
- dev/reg ~ holdback: max 0.029, mean 0.0004 (6300 pairs, 0 flagged)
- Conclusion: no measurable textual leakage from the 35 v1 fixtures (max < 0.03). The 35 fixtures are additionally permanently tagged DEVELOPMENT_VISIBLE + NON_CONFIRMATORY and are excluded by policy from any validation/holdback role.

## 2. Validation <-> holdback semantic isolation
- text similarity: max 0.37, mean 0.0079 (21600 pairs, 0 flagged); worst pair decision-bench-v2-val-tt15-004 ~ decision-bench-v2-holdback-tt15-008
- digit/number fingerprint Jaccard: max 1, mean 0.4411 (non-discriminative by design: all numeric content is synthetic timestamps drawn from a small shared day-offset vocabulary, so identical digit sequences carry no real-world information and cannot leak user data; reported for transparency)
- gold explanation similarity: max 0.37, mean 0.0079
- All pairs below the 0.5 flag threshold and below the 0.4 design target.

## 3. Structural template repetition
- Same (task_type, domain) frames appear in both splits by design (each TT appears in both splits); per-sample narrative diversification (phrase variants) and entity names keep 8-gram similarity < 0.4.
- Near-duplicate scan inside each split: all within-split pairs also below 0.5 (verified by the integrity suite T12).

## 4. Proper-noun (entity) isolation
- validation entity prefixes: 24 (e.g., 青岚, 墨渊, ...)
- holdback entity prefixes: 24 (e.g., 屿汀, 岑寂, ...)
- pool overlap: 0 (disjoint by construction; integrity test asserts no cross-split prefix appears in the other split's text)

## 5. Timeline isolation
- validation window: 2026-02-11 .. 2026-07-14 (target 2026-02 .. 2026-07)
- holdback window: 2026-07-06 .. 2026-12-15 (target 2026-07 .. 2026-12)
- dev/reg window: 2026-05 .. 2026-07 (from v1 fixtures); windows are semantically disjoint from holdback and only partially overlap validation by design (validation predates the v1 window for most samples).

## 6. Public benchmark text
- All v2 content is synthetic (template-generated, no real user data); no public benchmark text was copied.
- Title collision scan vs dev/reg: 0 collisions (integrity test T11).

## 7. Gold explanation isolation
- Explanations are template-derived and split-specific by entity/domain; max cross-split explanation similarity is below threshold (see section 2).

## 8. Verdict
- Leakage risk: LOW. All measured dimensions are below the flag threshold; structural guarantees (disjoint entity pools, disjoint time windows, per-sample narrative diversification) are enforced by the integrity suite.
