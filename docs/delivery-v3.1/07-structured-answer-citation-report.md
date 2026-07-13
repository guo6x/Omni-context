# 07 — Structured answer and citation report

Status: **FIXED**

## Contract

Answer generation now returns and persists a strict object:

```json
{
  "answer": "concise answer",
  "claims": [{ "text": "factual claim", "evidence_ids": ["assertion-id"] }],
  "abstained": false,
  "abstention_reason": null
}
```

The schema rejects extra keys, invented evidence IDs, non-abstaining answers without claims, and factual claims without citations. A legal abstention requires a reason and may contain no claims.

## Evidence envelope

`unified_memory_search` now returns claim-level assertion evidence first. Entity evidence is used only if no assertion exists. Each evidence object exposes:

- `id`, `type`, and `source_span`;
- `temporal_status`, `valid_from`, `valid_until`, and `invalidated_at`;
- `provenance`.

The raw provider answer and parsed structured object are both stored in each result record. Invalid JSON, schema violations, and invalid citations are recorded as answer errors and enter the normal retry/error flow; they cannot be scored as completed answers.

## Verification

- structured answer validation: 10 cases;
- benchmark suite: 224/224 passed;
- focused Brain Server API/extraction suite: 36/36 passed;
- full Brain Server suite: 235/235 passed.

Evidence: `evidence/07-11-benchmark-contract-tests.log`, `evidence/07-structured-evidence-brain-tests.log`.
