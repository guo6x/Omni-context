# 08 — Deterministic evidence precision report

Status: **FIXED**

## Definition

The LLM judge no longer emits `evidence_precision`. It classifies each actual claim/citation pair as `supports`, `irrelevant`, or `contradicts`. The runner validates that every cited pair is classified exactly once and that no uncited pair is introduced.

The deterministic layer computes:

```text
evidence_precision = supporting_citations / total_citations
```

No citations yields 0, including a legal abstention. An invalid evidence ID is an answer-validation error before judging, rather than a silently ignored citation. Per-question records persist total, existing, supporting, irrelevant, and contradictory citation counts.

## Verification

The 24-case suite covers all-support, all-irrelevant, contradictions, mixed ratios, zero-citation abstention, omitted judge pairs, uncited judge pairs, and duplicate pairs. The complete benchmark suite passed 224/224.

Evidence: `evidence/07-11-benchmark-contract-tests.log`.
