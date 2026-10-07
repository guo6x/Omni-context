# P2 Deterministic Causal Study

P2 executes the six preregistered conditions over the frozen 180-sample P1 dataset.

Conditions:

- C0 FULL
- C1 HIDDEN
- C2 LEXICAL
- C3 HASH-DENSE
- C4 HYBRID
- C5 COVERAGE-AWARE on the identical C4 surface

The downstream policy is frozen in `policy.mjs`. It does not receive `world_spec`, constructor fields, Gold, or treatment labels.

The scorer may use the frozen `world_spec` only to determine formal obligation coverage and unsupported-decision status.

No model/API call is used.

Run:

```bash
node research/evidence-surface-v1/p2/run-p2.mjs \
  research/evidence-surface-v1/p1/formal \
  research/evidence-surface-v1/p2/out
```
