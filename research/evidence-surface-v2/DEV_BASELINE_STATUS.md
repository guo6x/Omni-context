# Evidence Surface V2 — Development Baseline Status

**Status:** PASS / development only  
**Validated head:** `ee67b5b80597298d9cb5ac637357d85d65cfb196`  
**GitHub Actions run:** `37630971665`  
**Artifact:** `evidence-surface-v2-v1-forensic-audit`  
**Artifact digest:** `sha256:0df31fafb15dfe5bb5a30e70dacc2971b1a18cc11c80971cf6fe959f8e39b208`

These results are development diagnostics. They must not be reported as confirmatory paper evidence.

## Construct gates

Generated development corpus:

- 50 paired-world cases / 100 worlds;
- 5 transition families, 10 pairs per family;
- 10 domains, 5 pairs per domain;
- all visible evidence marked `current`;
- exact policy-input equality within every pair;
- disjoint valid decisive-action sets within every pair;
- dual independent validators PASS;
- cross-pair exact policy-surface duplicates: 0;
- template concentration: 4%;
- word-trigram Jaccard >= 0.90 near duplicates: 0;
- maximum observed cross-case word-trigram Jaccard: 0.507246.

## Surface-only information boundary

On all 50 generated development pairs:

- `SURFACE_VOTE`: identical outputs on 50/50 pairs; at least one world-action violation on 50/50 pairs.
- `CURRENTNESS_FIRST`: identical outputs on 50/50 pairs; at least one world-action violation on 50/50 pairs.

This is a development sanity check of the formal paired-world property, not a prevalence estimate.

## Monitor development behavior

On the clean-ledger generated stratum:

| Condition | Decisive / 100 | WAVR / 100 | False complete | False incomplete |
|---|---:|---:|---:|---:|
| M0 no monitor | 100 | 50 | n/a | n/a |
| M1 always defer | 0 | 0 | 0 | 50 |
| M2 surface-only heuristic | 100 | 50 | 50 | 0 |
| M3 acquisition ledger | 50 | 0 | 0 | 0 |
| M4 oracle | 50 | 0 | 0 | 0 |

This clean stratum intentionally tests whether the implementation can use acquisition-side information. It is not sufficient evidence that M3 is reliable.

Independent 7-case monitor stress corpus:

- correct classifications: 4/7;
- false complete: 2/7;
- false incomplete: 1/7.

Known failure classes include stale source-head metadata, an untracked relevant channel, and benign source advancement.

## V1 diagnostic carry-forward

Frozen V1 remains immutable.

Important audit result:

- F6 C1 retains a visible `currentness=superseded` cue in 30/30 cases.
- The independent `CURRENTNESS_FIRST` policy falls back on all 30 F6 C1 cases, giving 0 F6 WAVR.
- Therefore V1 F6 is a policy-relative gap-detection failure, not a cue-free information-boundary result.

V2 paired worlds remove this weakness by requiring clean-current, exactly identical policy surfaces.

## Next gate

Before any confirmatory policy or model output:

1. generate a separate confirmatory corpus from a non-dev lexical/domain bank;
2. validate exact-surface and disjoint-truth contracts with both validators;
3. audit cross-split lexical leakage and duplicates;
4. balance ledger fidelity profiles so M3 is not structurally perfect;
5. freeze the generated-corpus digest and generator digest;
6. freeze final policy/model conditions and primary comparison;
7. only then permit confirmatory execution.
