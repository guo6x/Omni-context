# Omni-Context Decision Benchmark v1

Deterministic benchmark for the decision capability of Omni-Context. Built in
this round; **no formal model evaluation is run** (see
`decision-benchmark-v1.md` §2).

## Contents

| Artifact | Description |
|---|---|
| `decision-benchmark-v1.md` | specification (task types, protocol, scoring) |
| `decision-benchmark-schema.json` | JSON Schema for samples |
| `development-fixtures.jsonl` | 34 samples, all 15 task types |
| `regression-fixtures.jsonl` | 15 samples, disjoint from development |
| `metric-definitions.md` | the 14 metrics + formulas |
| `failure-taxonomy.md` | the 9 failure classes + classification |
| `holdback-construction-plan.md` | holdback/dev/reg construction & anti-leakage |
| `benchmark-integrity-tests/` | deterministic integrity + reference scorer tests |

## Run integrity tests

```bash
cd benchmark-integrity-tests
npm test        # 25 tests: schema, coverage, scorer, taxonomy, leakage
```
