# 10 — Judge input and calibration report

Status: **FIXED**

The production Judge receives the question, reference answer, structured candidate answer, claims, concrete evidence and source spans, evidence validity fields, reference evidence IDs when present, temporal mode/as-of time, and answerable/adversarial labels. Deterministic fields cannot be overwritten by Judge output.

The frozen 50-sample schema/rubric calibration set passes all expected accept/reject outcomes. The current full Benchmark suite passes 227/227 tests, including the deterministic citation and stale-memory cases.

## Official manual calibration

A stratified sample of 15 final Conversation 1 states covers three temporal, multi-hop, single-hop, open-domain, and adversarial questions each.

- Binary agreement: 12/15 (80%).
- Binary disagreement: 3/15, all disclosed: `conv1-q2`, `conv1-q14`, and `conv1-q22`.
- One additional structured/rationale inconsistency: `conv1-q153` has `abstained=false`, while the rationale describes it as an abstention; the human and Judge binary outcome still agree.

The three disagreements show that the same-model Judge can over-credit abstentions or unsupported multi-hop inferences. They are retained as a P1 calibration risk; no result was edited and no held-out data was accessed. Answer and Judge both used `deepseek-v4-flash` with thinking disabled, which is explicitly not independent model validation.

Evidence: `evidence/benchmark-conv1/judge-manual-review.json`, `evidence/benchmark-conv1/results.jsonl`, and `evidence/07-11-benchmark-contract-tests.log`.
