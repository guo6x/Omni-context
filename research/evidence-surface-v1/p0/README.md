# P0 — Legacy V3 Evidence-Surface Harness

This directory is **diagnostic only**.

It reconstructs the already-published V3 TT08 evidence-surface failure and creates a clean paired FULL/HIDDEN policy-input harness without making any provider call.

It does **not**:

- change frozen V3 Gold;
- reopen the old Holdback;
- create new confirmatory evidence;
- claim that the old 4/43 UDR result is a causal experiment.

## What P0 checks

The frozen manuscript reported that TT08-000/002/004/006 failed UDR because mandatory evidence `ev002` was omitted by lexical retrieval before the Decision Kernel.

P0 verifies from repository artifacts that:

1. the four frozen formal A5 UDR failures are exactly TT08-000/002/004/006;
2. all eight TT08 A5 rows have required-evidence coverage 0.5;
3. the four L3+ TT08 rows are DECIDE and UDR-eligible;
4. the four L2 TT08 rows are PROPOSE_CONFIRM and therefore outside the frozen UDR denominator;
5. the paired harness can expose all required evidence in FULL and remove only `ev002` plus its source event in HIDDEN;
6. treatment metadata, Gold, hidden evidence IDs and hidden source content do not enter `policy_input`.

## Run

```bash
node research/evidence-surface-v1/p0/build-pairs.mjs
node research/evidence-surface-v1/p0/verify-p0.mjs
node --test research/evidence-surface-v1/p0/*.test.mjs
```

Generated files are written to:

```text
research/evidence-surface-v1/p0/out/
  p0-pairs.jsonl
  p0-recovery-report.json
  p0-recovery-report.md
```

The generated output is diagnostic and may be regenerated deterministically from the frozen V3 fixture, Gold and scoring result.
