# benchmark-integrity-tests

Deterministic integrity tests for Omni-Context Decision Benchmark v1.
No model evaluation is performed; these tests validate the benchmark itself.

Run:

```bash
node --test tests/
```

## Coverage

- `tests/schema.test.mjs` — every fixture line validates against the field
  rules (mirrors `decision-benchmark-schema.json`), plus negative controls.
- `tests/coverage.test.mjs` — dev pool covers all 15 task types (≥2 each);
  regression pool covers every type; ids unique; required anatomy present.
- `tests/scorer.test.mjs` — reference judge metric formulas on handcrafted
  micro-cases (accuracy, HC violation, decisiveness, abstention,
  clarification, revision P/R, stability, outcome adaptation, approval
  boundary, actionability, traceability, aggregation).
- `tests/taxonomy.test.mjs` — all 9 failure classes classified correctly.
- `tests/leakage.test.mjs` — dev/reg pools disjoint (ids, entities, decisions,
  8-gram narrative guard) per `holdback-construction-plan.md`.

## Libraries

- `lib/validate-sample.mjs` — field validator + fixture loader.
- `lib/reference-scorer.mjs` — deterministic judge (scoreSample, aggregateScores,
  outcomeDerivedAction, taxonomy class).
