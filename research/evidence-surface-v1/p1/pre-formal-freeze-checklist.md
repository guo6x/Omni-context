# P1 Pre-Formal Freeze Checklist

**Current status:** FROZEN_READY_FOR_P2

Formal sample authoring must not start until this checklist is reviewed.

## Protocol

- [x] Research question frozen.
- [x] Primary endpoint frozen.
- [x] Exact McNemar primary test frozen.
- [x] 180-sample total and 6×30 family allocation frozen.
- [x] C1 treatment narrowed to exactly one formally required evidence item.
- [x] Old V3 / old Holdback excluded from confirmation.
- [x] P3 remains gated behind offline G0–G5.

## Authoring contract

- [x] Base sample schema defined.
- [x] Six family rules defined.
- [x] 180 sample IDs preallocated before policy outputs.
- [x] Domain/template/risk planning slots preallocated.
- [x] Constructor proposal separated from runtime policy input.
- [x] No real personal data permitted.

## Formal validity

- [x] Human preference / crowd annotation removed from the confirmatory gate.
- [x] Claim narrowed to formal safety-contract compliance.
- [x] World-spec source-of-truth design documented.
- [x] Base-sample schema carries `world_spec`.
- [x] Evidence items map to world-fact IDs.
- [x] Declarative obligation evaluator implemented.
- [x] Independent family-checklist evaluator implemented.
- [x] Exact dual-validator agreement required.
- [x] Mandatory positive-control metamorphic test implemented.
- [x] Non-mandatory negative-control metamorphic test implemented where applicable.
- [x] Renderer/world-spec consistency check implemented.
- [x] Six toy samples rebuilt and passed under the formal validators.

## Leakage

- [x] Treatment target ID is not exposed as a condition label.
- [x] Reduced-surface packet removes direct source event.
- [x] Candidate direct evidence references are removed where present.
- [x] Leakage / near-duplicate checker implemented and passed on the six-family toy batch.
- [x] Formal leakage checker passed against all 180 frozen samples.
- [x] Near-duplicate check passed across all 180 frozen samples.
- [x] Prompt/template fingerprint distribution audit passed.

## Execution readiness

- [x] P0 artifact reconstruction completed with zero provider calls.
- [x] P0 FULL/HIDDEN treatment machinery constructed.
- [x] Statistical helper implemented.
- [ ] Repository-local Node tests executed in a checked-out runtime. (Artifact-level validators were independently executed against the frozen GitHub files.)
- [x] P1 authoring/tooling run on a six-family non-formal toy batch.
- [x] Paid human recruitment removed from the required path.
- [x] Zero-cost dual formal validation passes on all six toy samples.
- [x] Final protocol review completed; user authorized continuation and P1 formal generation was frozen.

## Authorization boundary

The formal dataset has now been frozen. The remaining unchecked repository-local Node runtime item is an execution-environment verification task and does not permit changing frozen sample content after P2 begins.