# P1 Toy Dry-Run Report

**Status:** PASS  
**Confirmatory:** no  
**Provider calls:** 0  
**Toy samples:** 6  
**Annotation packets:** 12

## Tooling checks

- Structural validation errors: **0**
- Near-duplicate pairs at Jaccard >= 0.50: **0**
- Reduced-surface direct leakage failures: **0**
- Constructor proposal/provenance visible to annotation packets: **no**

## Per-family treatment target

| sample | family | target | source event | leakage |
|---|---|---|---|---|
| es-v1-f1-901 | F1 | ev-002 | src-002 | PASS |
| es-v1-f2-901 | F2 | ev-002 | src-002 | PASS |
| es-v1-f3-901 | F3 | ev-002 | src-002 | PASS |
| es-v1-f4-901 | F4 | ev-003 | src-003 | PASS |
| es-v1-f5-901 | F5 | ev-002 | src-002 | PASS |
| es-v1-f6-901 | F6 | ev-002 | src-002 | PASS |

## Human-validation status

**NOT RUN.**

The next gate requires two real independent human annotators. AI-generated annotations may be used only to debug forms and must never be counted toward G0.

The two annotators must:

1. work independently;
2. not see constructor proposals or policy/model outputs;
3. annotate all six toy samples;
4. freeze their records before discussion;
5. use the agreement calculator only after both files are complete.

If the toy human dry run exposes ambiguity, repair the annotation protocol before formal 180-sample authoring.
