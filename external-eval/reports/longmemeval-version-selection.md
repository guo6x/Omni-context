# LongMemEval variant selection

Selection was made from public documentation before viewing any record.

| Variant | Retrieval realism | Scale / cost | Use |
|---|---|---|---|
| LongMemEval-S cleaned | Non-Oracle, up to roughly 80 sessions and a bounded history length | Lowest formal cost of the non-Oracle cleaned variants | **Primary recommendation** |
| LongMemEval-M cleaned | Non-Oracle, up to roughly 500 sessions | Stronger scale stress; materially higher ingestion, embedding, and provider cost | Secondary scale experiment after S |
| LongMemEval Oracle | Evidence-focused small history | Useful adapter and reader sanity check but bypasses much of realistic retrieval | Diagnostic only |

The primary preregistration therefore fixes `longmemeval_s_cleaned`. This is a methodological choice, not a result.
