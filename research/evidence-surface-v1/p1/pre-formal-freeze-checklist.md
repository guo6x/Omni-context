# P1 Pre-Formal Freeze Checklist

**Current status:** PREPARED_NOT_AUTHORIZED

Formal sample authoring must not start until this checklist is reviewed.

## Protocol

- [x] Research question frozen.
- [x] Primary endpoint frozen.
- [x] Exact McNemar primary test frozen.
- [x] 180-sample total and 6×30 family allocation frozen.
- [x] C1 treatment narrowed to exactly one independently validated mandatory evidence item.
- [x] Old V3 / old Holdback excluded from confirmation.
- [x] P3 remains gated behind offline G0–G5.

## Authoring contract

- [x] Base sample schema defined.
- [x] Six family rules defined.
- [x] 180 sample IDs preallocated before policy outputs.
- [x] Domain/template/risk planning slots preallocated.
- [x] Constructor proposal separated from runtime policy input.
- [x] No real personal data permitted.

## Human validation

- [x] Coarse action-family vocabulary defined.
- [x] Human annotation schema defined.
- [x] Constructor proposal hidden from annotators.
- [x] SOURCE_TRUTH and REDUCED_SURFACE packet builder defined.
- [x] Two independent annotators required.
- [x] Third-party adjudication required for disagreements.
- [x] Full-source safety, reduced-surface plausibility, and coverage-aware mitigation are separated.
- [x] Agreement gates frozen.
- [x] Agreement calculator implemented.

## Leakage

- [x] Treatment target ID is not exposed as a condition label.
- [x] Reduced-surface packet removes direct source event.
- [x] Candidate direct evidence references are removed where present.
- [ ] Formal leakage checker against authored P1 samples.
- [ ] Near-duplicate check across the 180 authored samples.
- [ ] Prompt/template fingerprint distribution audit.

## Execution readiness

- [x] P0 artifact reconstruction completed with zero provider calls.
- [x] P0 FULL/HIDDEN treatment machinery constructed.
- [x] Statistical helper implemented.
- [ ] Repository-local Node tests executed in a checked-out runtime.
- [ ] P1 authoring tooling run on a non-formal toy batch.
- [ ] Human annotation dry run on at least 6 toy samples, one per family.
- [ ] Final human review of protocol before formal authoring authorization.

## Authorization boundary

Until every unchecked item above that precedes formal authoring is resolved:

> **P1 formal generation is NOT AUTHORIZED.**

No provider call is needed to resolve the remaining items.