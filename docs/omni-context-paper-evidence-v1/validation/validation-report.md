# Evidence validation report

Status: **PASS**

- PASS: commit-format — Product and benchmark commits are full hexadecimal SHAs.
- PASS: freeze-tag-target — tag target=17dc1d0107b0474de84058205a91b302ba290a74
- PASS: freeze-manifest-hash — sha256=88744914a97c2bb2c665a7fd8353aad09e7cd368be2ed28f4159a0efdf7f5ca8
- PASS: summary-counts — Targeted 7/7; Formal 248 completed, 2 errors, 0 missing.
- PASS: overall-aggregates — Category macro aggregates match machine summaries.
- PASS: category-rows — Formal category CSV contains header plus seven categories; values were emitted by the extraction script from terminal records.
- PASS: comparison-counts — Comparison mode terminal counts are 70/70, 69/70, and 70/70.
- PASS: retry-total — Retry records=34.
- PASS: deterministic-rescore — 105 deterministic records; 0 differences; 0 scoring defects.
- PASS: csv-json-consistency — Main CSV agrees with summary JSON.
- PASS: unknown-reasons — Every exact UNKNOWN JSON value has a sibling unknown_reason.
- PASS: api-key-scan — No API-key or JWT-shaped value found.
- PASS: authorization-header — No Authorization Bearer header found.
- PASS: absolute-path-redaction — Only portable placeholders are present.
- PASS: locomo-status — LoCoMo is NOT RUN; Conversation 2–10 accessed=false.
- PASS: formal-not-overstated — Formal is not represented as 250/250.
- PASS: retrieval-only-not-overstated — Comparison Retrieval-only is not represented as 70/70.
- PASS: call-totals — Call totals match stage terminal records and usage manifests.
- PASS: test-gates — Recorded tests/build/typecheck/secret scan gates pass.
- PASS: no-heavy-artifacts — No database/model/archive is present and every package file is below 5 MiB.

The extraction recomputation confirmed category-macro scoring. A scenario-weighted mean would differ for unequal category counts, so the package uses the benchmark's category-macro definition.
