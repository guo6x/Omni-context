# Generator Repair Regression Tests (Goal 18H-E)

Run from this directory:

```
node --test generator-repair-regression.test.mjs
```

or:

```
node --test
```

Requirements: Node.js 20+ (tested with Node 22). The suite regenerates
Validation V2 with the repaired generator into `../work/regression-tests-run`
and runs the full contract audit into `../work/regression-tests-audit`.

Coverage:
- TT03 L0/L1 authority/action repair (REJECT path only, never DECIDE)
- TT15 delete-source propagation repair (qualified ev001 sources e004, supports=[])
- approval gate / confirmation gate / lineage / source_ref lifecycle via the
  full contract audit (ERROR=0 across all 120 x 9 dimensions)
- deterministic regeneration vs committed Validation V2 artifacts
- no HR1 answer / no model output dependence in the repair
