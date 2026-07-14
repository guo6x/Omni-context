# Known Product Limitations

The static pipeline audit preserves the following product-level findings without changing the frozen product:

- Exact values can be lost during extraction for at least five required-fact traces.
- Logged matching entity candidates can fail to reach final context.
- Full Assertion ANN, RRF, and reranker rankings were not archived for these Development scenario runs, leaving 48 required-fact loss points unresolved.
- Cross-Agent provenance is not reliably preserved in visible context or structured answers.
- Invalidated-fact rejection and temporal-transition representation remain weak in existing Development metrics.
- Retrieval-Only remains stronger overall, although Full Omni is stronger on the fixed Hard subset.

These are P1 product or evidence-archival limitations when the Dataset is valid. They must not be reclassified as Scoring Defects. The systematic Cross-Agent structured data inconsistency is separate: it is a Dataset P0, not a product limitation.
