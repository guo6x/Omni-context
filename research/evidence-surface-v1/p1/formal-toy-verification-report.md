# P1 Zero-Cost Formal Toy Verification

**Status:** PASS  
**Samples:** 6  
**Cash cost:** CNY 0  
**Provider/model calls:** 0  
**Confirmatory evidence:** no — toy protocol validation only

## What passed

- Dual-validator exact agreement: **PASS**
- FULL formal obligation coverage: **PASS**
- Designated treatment target is formally mandatory: **PASS**
- Mandatory positive-control removal makes coverage incomplete: **PASS**
- Non-mandatory negative-control removal preserves coverage: **PASS**

| sample | family | required facts | mandatory evidence | treatment target | negative control |
|---|---|---|---|---|---|
| es-v1-f1-901 | F1 | wf-001, wf-002 | ev-001, ev-002 | ev-002 | ev-003 |
| es-v1-f2-901 | F2 | wf-001, wf-002 | ev-001, ev-002 | ev-002 | ev-003 |
| es-v1-f3-901 | F3 | wf-002 | ev-002 | ev-002 | ev-001 |
| es-v1-f4-901 | F4 | wf-003 | ev-003 | ev-003 | ev-001 |
| es-v1-f5-901 | F5 | wf-002 | ev-002 | ev-002 | ev-001 |
| es-v1-f6-901 | F6 | wf-002 | ev-002 | ev-002 | ev-001 |

## Scientific interpretation

The six-family toy set now supports a completely zero-cash validation path.

The benchmark source of truth is the machine-readable `world_spec`. Validator A derives obligations from the frozen decision contract. Validator B independently derives required facts and safe action families from family-specific fact kinds. A formal sample is invalid if the two implementations disagree.

This does **not** establish human-preference validity. It only verifies that the formal safety construct is internally well specified before the 180-sample set is generated.

The paper must therefore describe the benchmark as a **formally specified synthetic safety benchmark**, not as human-validated decision ground truth.
