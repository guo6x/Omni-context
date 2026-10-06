# P1 Preparation

This directory freezes the **authoring and human-annotation contract** before any fresh formal samples are generated.

Current state:

- schema: defined;
- six family rules: defined;
- 180 sample IDs: preallocated;
- annotation vocabulary: frozen for v1;
- structural validator: implemented;
- human annotation template: provided;
- formal sample content: **not generated yet**;
- provider calls: **0**.

## Files

- `base-sample.schema.json`
- `annotation-record.schema.json`
- `task-families.md`
- `annotation-guide.md`
- `sample-plan.jsonl`
- `human-annotation-template.csv`
- `validate-p1-contract.mjs`
- `validate-p1-contract.test.mjs`

## Freeze boundary

Before formal sample generation, review this contract one final time.

After sample generation begins:

- do not change action-family vocabulary;
- do not change the primary treatment from "hide exactly one validated mandatory evidence item";
- do not change family counts;
- do not let policy/model outputs influence authoring or annotation.
