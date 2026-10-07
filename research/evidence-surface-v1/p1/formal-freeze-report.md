# P1 Formal Dataset Freeze Report

**Status:** PASS / FROZEN_READY_FOR_P2  
**Freeze commit:** `fd0e67b12338ee7742a61f396d9c63496e61389e`  
**Formal samples:** 180  
**Families:** 6 × 30  
**Domains:** 12  
**Cash cost:** CNY 0  
**Provider/model calls:** 0

## Validation results

| Gate | Result |
|---|---:|
| Base schema failures | 0 |
| Dual formal-validator failures | 0 |
| Renderer/world-spec consistency failures | 0 |
| Dataset audit errors | 0 |
| Near-duplicate warnings | 0 |
| Prompt-template concentration | 0.56% max |
| Allowed prompt-template concentration | ≤10% |

Near-duplicate detection is frozen as **word-trigram Jaccard ≥ 0.70**. An earlier development-only character-8-gram threshold of 0.50 over-flagged shared benchmark boilerplate before formal freeze; the formal audit metric was replaced before the dataset was frozen. No P2 output had been observed.

## Formal files

- `formal/f1.jsonl` — 30
- `formal/f2.jsonl` — 30
- `formal/f3.jsonl` — 30
- `formal/f4.jsonl` — 30
- `formal/f5.jsonl` — 30
- `formal/f6.jsonl` — 30

Exact file blob SHAs, generator/validator SHAs, claim boundaries and treatment contract are frozen in:

`formal-freeze-manifest.json`

## Scientific boundary

This dataset is a **formally specified synthetic safety benchmark**.

It is not human-preference Gold and must not be presented as evidence that the decisions are preferred by humans or representative of real-world decision quality.

The formal construct is:

> whether a consequential decisive action is issued while a frozen evidence obligation required by the source-truth safety contract is uncovered.

## Treatment freeze

- C0 FULL keeps all formal evidence visible.
- C1 HIDDEN removes exactly one formally mandatory evidence item and its direct source/reference copies.
- The underlying world truth does not change between C0 and C1.
- Every sample passed a mandatory positive control.
- Every sample has a non-mandatory negative-control evidence item whose removal preserves complete obligation coverage.

## Next phase

P2 may begin.

From this point forward:

- the 180 frozen samples must not be repaired based on P2 results;
- the old V3 set remains mechanism-discovery evidence only;
- the old Holdback remains unopened;
- no paid annotation or paid model/API call is authorized.
