# Cost and latency

For the completed Targeted rerun:

- Total latency P50: 138,762 ms.
- Total latency P95: 266,835.3 ms.
- Retrieval latency P50/P95: 2,579 / 2,740.8 ms.
- Answer tokens: 17,162 input and 4,702 output.
- Judge tokens: 6,041 input and 463 output.
- Extraction calls: 19; reranker calls: 7.
- Preserved database artifacts: 9 attempts, 163,037,184 bytes total.
- Pinned ONNX artifact: 561,768,762 bytes.

The provider did not expose an authoritative billed currency amount, so no estimated cost is substituted. Peak memory was not captured and remains an explicit risk.

See `evidence/cost-and-latency.json`.
