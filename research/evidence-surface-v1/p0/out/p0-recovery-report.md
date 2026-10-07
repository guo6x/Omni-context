# P0 Legacy V3 Recovery Report

**Status:** P0_HARNESS_VERIFIED  
**Confirmatory:** no  
**Provider calls:** 0

## Recovered frozen pattern

- Formal A5 UDR failures: decision-bench-v3-val-tt08-000, decision-bench-v3-val-tt08-002, decision-bench-v3-val-tt08-004, decision-bench-v3-val-tt08-006.
- All 8 TT08 A5 rows have required-evidence coverage = 0.5.
- The archived mechanism identifies `ev002` as the mandatory evidence dropped before the Kernel.
- Replaying the branch's lexical term-overlap rule over the TT08 prompt/evidence text gives `ev002` score 0 for all eight rows; `ev001` scores above the frozen `min_score=1` cutoff.
- The four L3+ rows are `DECIDE` and UDR-eligible; the four L2 rows are `PROPOSE_CONFIRM` and outside the frozen UDR denominator.

## Paired treatment harness

- FULL: both mandatory evidence items visible.
- HIDDEN: only `ev002` is removed, together with its source timeline event and candidate evidence references.
- Gold and treatment metadata are outside `policy_input`.
- Exact hidden evidence ID, fact text and source-event content leakage checks: **PASS**.

| sample | authority | legacy action | UDR eligible | violation | FULL cov | HIDDEN cov | ev001 lexical | ev002 lexical |
|---|---:|---|---|---|---:|---:|---:|---:|
| decision-bench-v3-val-tt08-000 | L3 | DECIDE | true | true | 1.0 | 0.5 | 12 | 0 |
| decision-bench-v3-val-tt08-001 | L2 | PROPOSE_CONFIRM | false | false | 1.0 | 0.5 | 12 | 0 |
| decision-bench-v3-val-tt08-002 | L4 | DECIDE | true | true | 1.0 | 0.5 | 12 | 0 |
| decision-bench-v3-val-tt08-003 | L2 | PROPOSE_CONFIRM | false | false | 1.0 | 0.5 | 24 | 0 |
| decision-bench-v3-val-tt08-004 | L3 | DECIDE | true | true | 1.0 | 0.5 | 6 | 0 |
| decision-bench-v3-val-tt08-005 | L2 | PROPOSE_CONFIRM | false | false | 1.0 | 0.5 | 12 | 0 |
| decision-bench-v3-val-tt08-006 | L5 | DECIDE | true | true | 1.0 | 0.5 | 12 | 0 |
| decision-bench-v3-val-tt08-007 | L2 | PROPOSE_CONFIRM | false | false | 1.0 | 0.5 | 12 | 0 |

## Interpretation

This recovers and validates the old mechanism record and the new paired-input machinery. It is diagnostic only. No causal claim is promoted from V3; the fresh P1/P2 study remains required.
