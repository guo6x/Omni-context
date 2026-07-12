# Benchmark Rebuild Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Reproducibility Artifacts

| Item | Status | Detail |
|------|--------|--------|
| Dataset source | FIXED | https://github.com/snap-research/locomo (SNAP Research, ACL 2024) |
| Dataset SHA-256 | FIXED | 553CD5A15E25F2CECCC6ED185221EBA645080C93E5B91087560A91AA5961F365 |
| Source commit | FIXED | 3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376 |
| benchmark commit | FIXED | Tracked in git (benchmark/ package) |
| dataset_manifest.json | FIXED | Official provenance recorded |
| config hash | FIXED | sha256(stableStringify(config)) in integrity.mjs |
| prompt hash | FIXED | sha256(prompt text) in integrity.mjs |

## 2. Splits

| Split | Conversations | Access |
|-------|--------------|--------|
| Development | [1] | Open access |
| Held-out | [2,3,4,5,6,7,8,9,10] | Locked until "Omni-Context Evaluation Freeze v1" |
| Policy | FIXED | splits.mjs: assertConversationAllowed enforces with runtime checks |

## 3. Run Infrastructure

| Item | Status | Detail |
|------|--------|--------|
| Per-question JSONL | FIXED | appendQuestionRecord writes results.jsonl atomically |
| Checkpoint/resume | FIXED | completedQuestionIds skips completed questions |
| No overwrite | FIXED | Refuses to overwrite completed question |
| errors/retries saved | FIXED | status: error or retry, with retry_count |
| Raw judge output | FIXED | raw_judge_output field |
| Independent recompute | FIXED | src/recompute-metrics.mjs (standalone script) |
| Historical runs preserved | FIXED | Each run in unique timestamped directory |

## 4. Metrics

| Metric | Status |
|--------|--------|
| Omni Composite Score | FIXED (factual+temporal+contextual+abstention+evidence+(1-stale))/6 |
| binary_accuracy | FIXED |
| factual_score | FIXED |
| temporal_score | FIXED |
| contextual_score | FIXED |
| abstention_accuracy | FIXED |
| evidence_precision | FIXED |
| stale_memory_leakage | FIXED |
| answerable_only | FIXED |
| adversarial_only | FIXED |
| failures | FIXED |
| retries | FIXED |
| Not disguised as J Score | FIXED (explicitly named Omni Composite Score) |

## 5. Evaluation Safety

| Rule | Status |
|------|--------|
| Hash-fallback fail-fast | FIXED (assertEvaluationEmbeddingMode throws) |
| Model config anomaly fail-fast | FIXED |
| No held-out tuning | FIXED (enforced by splits.mjs) |
| No hardcoded answers | FIXED |

## 6. Tests

| Test | Count |
|------|-------|
| benchmark/tests/harness.test.mjs | 4 |
