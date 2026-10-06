# Human Toy Dry Run

Two **real people** must complete the toy annotation independently before P1 formal authoring can be authorized.

## Inputs

- `toy-annotation-packets.jsonl` — blinded SOURCE_TRUTH / REDUCED_SURFACE packets.
- `annotation-guide.md` — definitions and annotation rules.
- `toy-annotator-a.template.jsonl`
- `toy-annotator-b.template.jsonl`

## Independence procedure

Annotator A and Annotator B must not discuss the six samples before both records are frozen.

Each annotator should:

1. read the annotation guide;
2. inspect the SOURCE_TRUTH packet for a sample;
3. record mandatory evidence, full-source support and acceptable full-source action families;
4. inspect the REDUCED_SURFACE packet;
5. record reduced-surface support and locally acceptable action families;
6. record acceptable actions under the coverage-aware counterfactual;
7. record safety flags and notes;
8. complete all six toy samples;
9. save the final JSONL without changing it after discussion.

After both annotation files are complete:

```bash
node human-agreement.mjs annotations-a.jsonl annotations-b.jsonl toy-human-agreement.json
```

If any safety-critical disagreement remains, a third independent person performs adjudication. Original A/B files must not be overwritten.

## Gate

The toy dry run is not a formal result. Its purpose is to find ambiguous wording or unusable annotation instructions **before** the 180-sample formal set is authored.

AI-generated annotations do not count toward the human-validity gate.
