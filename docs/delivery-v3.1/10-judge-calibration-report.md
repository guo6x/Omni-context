# 10 — Judge input and calibration report

Status: **PARTIALLY_FIXED**

## Fixed

The judge now receives the complete scoring material instead of only an evidence count:

- question and reference answer;
- structured candidate answer and claim citations;
- concrete evidence objects and source spans;
- LoCoMo reference evidence identifiers when present;
- validity fields and parsed temporal mode / as-of time;
- answerable, adversarial, and subset flags.

Judge responsibility is limited to semantic quality scores and pair-level support/adoption classification. `evidence_precision` and `stale_memory_leakage` are rejected as extra judge output fields and are computed downstream.

A frozen 50-sample schema/rubric calibration set covers valid and invalid binary scores, missing fields, extra deterministic metrics, invalid verdicts, claim indexes, partial semantic scores, temporal scores, abstention scores, and support/adoption classifications. All cases pass their expected accept/reject outcome.

## Remaining blocker

The task also requires manual review of 10–20 official Conversation 1 results. That cannot be performed because the provider-backed complete run is blocked by missing model and embedding configuration. Synthetic fixtures are not substituted for manual official-result calibration.

Evidence: `evidence/07-11-benchmark-contract-tests.log`.
