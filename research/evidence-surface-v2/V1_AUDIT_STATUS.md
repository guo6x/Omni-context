# V1 Forensic Audit Status

**Status:** PASS  
**Workflow run:** 37593164936  
**Validated commit:** cfac6f6376123591c1355759578a6b6339f6b57a  
**Artifact:** evidence-surface-v2-v1-forensic-audit  
**Artifact id:** 11469014274  
**Artifact digest:** sha256:3a773d9be8e2046e2e9055ea27d736750417a9d64183d19fd808ed98dbf641ec

## Locked findings

| Condition | UDR | WAVR | FEDD | decisive FEDD | unsupported but C0-match |
|---|---:|---:|---:|---:|---:|
| C0 FULL | 0 | 0 | 0 | 0 | 0 |
| C1 HIDDEN | 30 | 30 | 180 | 30 | 0 |
| C2 Lexical | 56 | 18 | 46 | 18 | 38 |
| C3 Hash-dense | 61 | 23 | 56 | 23 | 38 |
| C4 Hybrid | 53 | 24 | 58 | 24 | 29 |
| C5 Coverage-aware | 0 | 0 | 87 | 0 | 0 |

Definitions:

- UDR: decisive action while required-fact coverage is incomplete.
- WAVR: decisive action family is not allowed by the frozen full-world decision contract.
- FEDD: any output pair (action family, selected candidate) differs from C0 FULL.
- decisive FEDD: a decisive output differs from C0 FULL; conservative fallback-only changes are excluded.

Additional locked findings:

- all 30 F6 C1 surfaces retain visible currentness=superseded metadata;
- C1 recall 16.67% is exactly explained by F1/F2 recall 0.5 and F3-F6 recall 0;
- C5 contains 87 incomplete cases and zero decisive outputs among those cases;
- the frozen bootstrap interval is a sample-mixture resampling result, not cross-policy or real-world uncertainty.

## Interpretation

V1 is retained as a controlled mechanism baseline.

It does not support a cue-free indistinguishability claim. V2 must test that stronger claim with paired worlds whose downstream policy inputs are exactly equal while their valid decisive actions differ.
