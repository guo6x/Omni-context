# P2 Deterministic Causal Study — Results

**Status:** COMPLETE  
**Samples:** 180  
**Evaluations:** 1,080  
**Cash cost:** CNY 0  
**Provider/model calls:** 0  
**Required preregistered gates:** PASS

## Primary causal comparison

C0 FULL produced **0/180 unsupported decisions (0%)**.

C1 HIDDEN produced **30/180 unsupported decisions (16.67%)**.

Paired risk difference:

**+16.67 percentage points**

95% paired bootstrap CI:

**[11.67, 22.22] percentage points**

Exact two-sided McNemar:

**p = 1.8626451492309587e-9**

G1 and G2 pass.

## Important heterogeneity

The direct C1 effect is **not uniform across task families**.

| Family | C0 UDR | C1 UDR | Difference |
|---|---:|---:|---:|
| F1 | 0.0% | 0.0% | 0.0 pp |
| F2 | 0.0% | 0.0% | 0.0 pp |
| F3 | 0.0% | 0.0% | 0.0 pp |
| F4 | 0.0% | 0.0% | 0.0 pp |
| F5 | 0.0% | 0.0% | 0.0 pp |
| F6 | 0.0% | 100.0% | 100.0 pp |

All 30 direct-treatment failures occur in **F6 override/invalidation**.

This is scientifically important. F1–F5 expose visible clues when their treatment evidence disappears, so the frozen policy falls back to clarify/defer/request approval. F6 removes a later override completely; the remaining older instruction plus readiness evidence still looks actionable to a coverage-blind policy.

The more precise finding is therefore:

> **Silent omission of superseding/override evidence can defeat an otherwise conservative visible-gap policy.**

Do not describe C1 as showing that every missing mandatory fact produces an unsafe decision.

## Retrieval conditions

| Condition | Required-fact recall | Complete coverage | UDR | Decisive | Safe decisive |
|---|---:|---:|---:|---:|---:|
| C2_LEXICAL | 63.1% | 53.3% | 31.1% | 84.4% | 53.3% |
| C3_HASH_DENSE | 57.2% | 47.8% | 33.9% | 81.7% | 47.8% |
| C4_HYBRID | 60.0% | 51.7% | 29.4% | 81.1% | 51.7% |
| C5_COVERAGE_AWARE | 60.0% | 51.7% | 0.0% | 51.7% | 51.7% |

C2–C4 are broadly directionally consistent with the preregistered recall/UDR gate, but **strict monotonicity does not hold**: lexical recall is slightly higher than hybrid recall while lexical UDR is 1.67 points higher. G4 still passes the preregistered 2-point tolerance. This result should be described as qualified support, not a universal monotonic law.

## Coverage-aware mitigation

C4 HYBRID:

- UDR: **29.44%**
- safe decisive rate: **51.67%**

C5 uses the **identical C4 retrieval surface** and adds only the boolean `coverage_complete` signal:

- UDR: **0/180 = 0%**
- safe decisive rate: **93/180 = 51.67%**
- fallback rate: **87/180 = 48.33%**

Therefore C5 does not obtain zero UDR by refusing every case. It still makes a decisive action on all 93 cases where formal coverage is complete.

G5 passes.

## Gate table

| Gate | Result |
|---|---|
| G0-FORMAL | PASS |
| G1 C0 UDR ≤ 5% | PASS |
| G2 C1 causal effect ≥10 pp + McNemar p<.05 | PASS |
| G3 cross-family non-negative direction sanity | PASS |
| G4 retrieval recall/UDR directional gate | PASS |
| G5 coverage-aware mitigation | PASS |

## Claim boundary after P2

Supported:

> In this formally specified synthetic benchmark, hiding a required fact increased unsupported decisive behavior overall, with the direct effect concentrated in silent override/invalidation omissions. Under practical retrieval loss, an explicit coverage-completeness signal removed unsupported decisive behavior on the frozen hybrid surface while retaining decisive behavior whenever formal coverage was complete.

Not supported:

- all missing evidence causes unsafe decisions;
- retrieval recall and UDR follow a strict universal monotonic law;
- human-preference or real-world decision validity;
- deployment safety;
- a universal theorem about all agents.

## Next scientific decision

P2 passes all frozen gates, but the heterogeneity changes the paper's strongest story.

The next manuscript should emphasize **silent omissions / superseding evidence** and **coverage completeness as a safety contract**, not generic "more retrieval recall always means safer decisions."

Optional P3 remains zero-cash only. It should not run unless a reproducible free/local model runtime is available and its model choices are frozen before any P3 output is observed.
