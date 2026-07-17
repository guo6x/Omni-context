# Final product fix

## What failed

The initial frozen product executed the selector but allowed selected graph/support noise to displace query-bearing facts. Machine diagnosis classified this as `PRODUCT_RETRIEVAL_DEFECT / SELECTOR_EXECUTED_BUT_SELECTED_GRAPH_NOISE`. Initial retrieval preflight Top-10 slot coverage was 20/38 (failed); after one product fix round it was 37/38 (passed).

## Verified diff

From 2e300acad083626285ff43b650717e66a04671dd to 17dc1d0107b0474de84058205a91b302ba290a74:

```text
brain-server/src/api/handlers/mcp.ts            |  11 ++-
 brain-server/src/retrieval/evidence-selector.ts | 126 +++++++++++++++++-------
 brain-server/src/retrieval/fusion.ts            |   1 +
 brain-server/tests/api.smoke.test.ts            |   5 +-
 brain-server/tests/evidence-selector.test.ts    |  61 +++++++++++-
 5 files changed, 163 insertions(+), 41 deletions(-)
```

Changed production files: `brain-server/src/api/handlers/mcp.ts`, `brain-server/src/retrieval/evidence-selector.ts`, and `brain-server/src/retrieval/fusion.ts`. Regression coverage was added in `brain-server/tests/api.smoke.test.ts` and `brain-server/tests/evidence-selector.test.ts`. The changes generalize query-aware grouping/selection and source-aware fusion; inspection found no Scenario-ID hard-coding and no Gold-answer reads in the product diff. Product tests passed 329/329.

## Before/after evidence

- Preflight: 20/38 to 37/38 Top-10 slots.
- The preserved earlier Targeted infrastructure failure was 0/7 and was not counted as a product validation opportunity. The fresh, preflight-gated Targeted-7 completed 7/7 at 0.840868, with Candidate Pool, Final-20, and Answer Top-10 each 28/30.

This is a factual internal-benchmark improvement, not an external generalization claim.
