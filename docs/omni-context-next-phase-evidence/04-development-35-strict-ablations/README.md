# Development-35 strict ablations

Internal results from the completed 35-by-4 interleaved run (development35-strict-20260717-r3, seed=2026071701).
A partial attempt invalidated by runtime HEAD attestation is retained separately and never pooled with the completed run.

## Files

- `ablation-status.json` -- overall completion status (140/140, 0 errors)
- `strict-ablation-statistics.json` -- aggregated comparison table and paired statistics
- `call-budget.json` -- API call budget tracking
- `run-manifest.json` -- run attestation (commits, hashes, seed)
- `condition-summaries/` -- per-condition metrics (4 files)
- `paired-statistics/` -- per-comparison paired tests (3 files + overview)
- `paired-scenario-scores.csv` -- desensitized per-scenario scores for all 4 conditions
- `progress.json` / `run-order.json` -- execution trace

## retry_records semantics

The `retry_records = 872` field counts runner-level status records written to `results.jsonl`
with `status = "retry"`. These are NOT Provider API retries. Each retry record represents a
runner-level rescheduling event (e.g., transient infrastructure issues, schema normalization
retries, or checkpoint resume markers). The actual physical Provider call counts are tracked
separately in `call-budget.json`:
- `extraction` calls: 364
- `reranker` calls: 140
- `answer_physical_proxy` calls: 147
- `kimi_physical` attempts: 40
- Total DeepSeek logical calls: 651 (within budget limit of 741)

Do not describe the 872 retry_records as 872 Provider retries in the paper.

## Paired statistics

Delta = control - ablated (positive = Full Omni higher).
Bootstrap: 10,000 iterations, seed = 2026071702, percentile method.
Wilcoxon: signed-rank normal approximation with tie correction.

All three paired comparisons have paired_n = 35.

## Scope

Internal Development-35 only. Not external generalization evidence.
External LongMemEval and LoCoMo formal evaluations remain NOT RUN.
