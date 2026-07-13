# 09 — Deterministic stale-memory leakage report

Status: **FIXED**

## Definition

The LLM judge no longer emits `stale_memory_leakage`. It only marks whether a cited memory was actually adopted by the answer. The deterministic layer evaluates the cited evidence against `valid_from`, `valid_until`, `invalidated_at`, and the query's `current` or `as_of` time point.

```text
stale_memory_leakage = stale_used_claims / memory_grounded_claims
```

Retrieved-but-uncited stale evidence does not count. Cited stale evidence that the answer explicitly rejects does not count. A historical assertion that was valid at an `as_of` time is not treated as stale merely because it expired later. Per-question numerator and denominator are persisted.

## Verification

The 24-case suite covers current, expired, future, invalidated, as-of-valid, as-of-invalid, retrieved-only stale evidence, rejected stale evidence, adopted stale evidence, and mixed new/old claims. The complete benchmark suite passed 224/224.

Evidence: `evidence/07-11-benchmark-contract-tests.log`.
