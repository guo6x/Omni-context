# Figure and Table Specification — Silent Omission Paper

**Source of truth:** `research/evidence-surface-v1/p2/out/p2-results.json`  
**Rule:** figures may transform presentation only; they may not select, smooth, omit, or alter frozen outcomes.

## Figure 1 — Detectable gap vs silent omission

**Type:** conceptual mechanism diagram  
**No empirical data.**

Required flow:

```text
Underlying world / source truth
          |
          v
Evidence acquisition / retrieval
          |
          v
Decision-visible evidence surface
          |
          +-------------------------------+
          |                               |
    required gap visible             gap leaves no trace
          |                               |
          v                               v
CLARIFY / DEFER / APPROVAL       old/local state still actionable
          |                               |
          v                               v
      safe fallback                unsupported-decision risk
                                          |
                                          v
                              + coverage_complete signal
                                          |
                                          v
                                    safe fallback
```

Caption:

> **Figure 1: Missing evidence is not a single failure mode.** A downstream policy can react safely when the delivered surface contains a visible cue that an obligation is uncovered. A silent omission removes both the required evidence and the cue that it is missing. C5 tests a separate obligation-completeness signal without revealing the omitted content.

Do not depict C5 as a learned model or as a deployment-ready oracle.

---

## Figure 2 — Primary paired intervention

**Type:** two-bar or paired proportion plot

Data:

| Condition | Unsupported | Total | UDR |
|---|---:|---:|---:|
| C0 FULL | 0 | 180 | 0.0000 |
| C1 HIDDEN | 30 | 180 | 0.1667 |

Annotation:

- paired risk difference: **+16.67 pp**
- paired bootstrap 95% CI: **[11.67, 22.22] pp**
- exact two-sided McNemar: **p = 1.8626451492309587e-9**

Caption:

> **Figure 2: Paired evidence-visibility intervention.** Holding world truth and the downstream policy fixed, hiding one preregistered mandatory evidence item raises UDR from 0/180 to 30/180. The aggregate effect is not homogeneous across families; Figure 3 shows that all direct C1 failures occur in F6.

Visual requirement:

- show exact numerator/denominator directly on bars;
- do not use a truncated y-axis that exaggerates 0 → 16.67%.

---

## Figure 3 — Direct-treatment heterogeneity

**Type:** grouped bar chart by family

Data:

| Family | C0 UDR | C1 UDR |
|---|---:|---:|
| F1 constraint | 0% | 0% |
| F2 authority | 0% | 0% |
| F3 temporal | 0% | 0% |
| F4 conflict | 0% | 0% |
| F5 outcome/revision | 0% | 0% |
| F6 override/invalidation | 0% | 100% |

Caption:

> **Figure 3: The direct treatment effect is concentrated in silent override/invalidation omissions.** F1–F5 retain a visible gap cue after the single designated item is hidden and therefore trigger the frozen conservative fallback. In F6, the later override/invalidation disappears completely and the older instruction remains locally actionable.

Mandatory note in main text:

> This 100% F6 rate is a mechanism result under the frozen policy–benchmark pair, not a prevalence estimate for deployed agents.

---

## Figure 4 — Retrieval recall is not a strict safety surrogate

**Type:** scatter plot

x-axis: aggregate mandatory-fact recall  
y-axis: UDR

Points:

| Condition | Recall | UDR |
|---|---:|---:|
| C3 Hash-dense | 57.22% | 33.89% |
| C4 Hybrid | 60.00% | 29.44% |
| C2 Lexical | 63.06% | 31.11% |

Caption:

> **Figure 4: Aggregate recall and UDR are not strictly monotonic across frozen retrievers.** Hash-dense has the lowest recall and highest UDR, but lexical has higher recall than hybrid while also having 1.67 pp higher UDR. The preregistered directional gate passes within its 2 pp tolerance; the data do not support a universal monotonic law.

Do not draw a fitted regression line from three points.

---

## Figure 5 — Same-surface coverage-aware mitigation

**Type:** paired C4/C5 bar chart

Primary panel:

| Condition | UDR | Decisive rate | Safe-decisive rate | Fallback rate |
|---|---:|---:|---:|---:|
| C4 Hybrid | 29.44% | 81.11% | 51.67% | 18.89% |
| C5 Coverage-aware | 0% | 51.67% | 51.67% | 48.33% |

Fixed shared surface:

- mandatory-fact recall: **60.00%** in both C4 and C5;
- complete coverage: **93/180 = 51.67%** in both.

Caption:

> **Figure 5: Coverage awareness changes policy behavior without changing the retrieved evidence.** C5 uses the identical frozen C4 hybrid surface and adds only the boolean `coverage_complete`. UDR falls from 53/180 to 0/180 while all 93 complete-coverage cases remain decisive. The experiment establishes sufficiency of completeness information under the formal benchmark; it does not establish that a reliable completeness signal is available in open-world deployment.

---

## Table 1 — Benchmark families

Use the existing six-family table.

Add columns:

- obligation type;
- canonical visible-gap cue;
- canonical silent-failure possibility.

Suggested content:

| Family | Obligation | Visible-gap cue under C1 | Silent-failure route |
|---|---|---|---|
| F1 | hard constraint / feasibility | constraint remains but feasibility support missing | top-k may remove both feasibility and cue-bearing context |
| F2 | current authority / approval | authority requirement remains without grant | top-k may surface action support without the requirement |
| F3 | current state vs stale state | stale marker remains without current state | not observed under frozen retrievers |
| F4 | conflict resolution | conflicting claims remain without resolution | top-k may drop one side / resolution structure |
| F5 | outcome / revision | prior conditional decision remains without change evidence | not observed under frozen retrievers |
| F6 | override / invalidation | none when later override is removed | older instruction remains locally actionable |

This table must be described as policy-relative.

---

## Table 2 — Frozen experimental conditions

Required columns:

- condition;
- evidence surface;
- policy;
- extra coverage input;
- purpose.

Key invariant:

> C4 and C5 must be visibly marked as sharing the same retrieval surface.

---

## Table 3 — Aggregate P2 results

Use exact frozen values:

| Condition | Required-fact recall | Complete coverage | UDR | Decisive | Safe decisive |
|---|---:|---:|---:|---:|---:|
| C0 FULL | 100.00% | 100.00% | 0.00% | 100.00% | 100.00% |
| C1 HIDDEN | 16.67% | 0.00% | 16.67% | 16.67% | 0.00% |
| C2 Lexical | 63.06% | 53.33% | 31.11% | 84.44% | 53.33% |
| C3 Hash-dense | 57.22% | 47.78% | 33.89% | 81.67% | 47.78% |
| C4 Hybrid | 60.00% | 51.67% | 29.44% | 81.11% | 51.67% |
| C5 Coverage-aware | 60.00% | 51.67% | 0.00% | 51.67% | 51.67% |

Note: C1 required-fact recall mean is 16.67% because coverage is defined over all required facts while exactly one designated mandatory evidence target and its direct copies are removed; do not confuse this field with “16.67% of samples covered,” which is false—complete coverage is 0/180.

---

## Table 4 — Family-level retrieval UDR

| Family | Lexical | Hash-dense | Hybrid | Coverage-aware |
|---|---:|---:|---:|---:|
| F1 | 66.67% | 86.67% | 70.00% | 0% |
| F2 | 40.00% | 26.67% | 6.67% | 0% |
| F3 | 0% | 0% | 0% | 0% |
| F4 | 20.00% | 13.33% | 20.00% | 0% |
| F5 | 0% | 0% | 0% | 0% |
| F6 | 60.00% | 76.67% | 80.00% | 0% |

Interpretation:

> Top-k retrieval can create silent surfaces outside F6, which is why the paper should define silentness by the delivered surface relative to policy checks rather than by family label.

---

## Table 5 — Nearest-work boundary

Use the manuscript's current comparison table:

- SURE-RAG;
- STALE;
- Revoked but Still Authoritative;
- this work.

Purpose:

Prevent the reviewer from collapsing “silent omission” into either evidence-sufficiency calibration, stale-memory revision, or revocation enforcement.

---

## Figure-generation integrity rules

1. Every empirical number must be read from frozen `p2-results.json`.
2. No cherry-picking families or retrieval conditions.
3. No smoothing.
4. No fitted relation from three retrieval points.
5. No y-axis truncation that visually inflates differences.
6. C4/C5 figures must explicitly state “identical retrieval surface.”
7. C1/F6 figure must explicitly state “mechanism result, not prevalence.”
8. Source code for figures should record the input file SHA or hash in generated metadata.
