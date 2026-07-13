# 11 — Held-out authorization wiring report

Status: **FIXED**

No Conversation 2–10 content was read, parsed, ingested, or run while implementing or verifying this gate.

Held-out mode now requires an explicit `--authorization-manifest <path>` whose strict authorization string is exactly:

```text
Omni-Context Evaluation Freeze v1
```

The manifest freezes and verifies the 40-character Git commit plus SHA-256 hashes for benchmark config, answer prompt, judge prompt, and dataset. The runner persists the verified authorization metadata in its run manifest. Resume and retry recheck dataset, config, answer-prompt, and judge-prompt hashes and reuse the persisted authorization gate.

Six synthetic-only wiring tests cover the accepted manifest, missing authorization, and mismatch rejection for commit, config, answer prompt, and judge prompt. The test dataset contains only a synthetic marker and no LoCoMo held-out conversation.

Evidence: `evidence/07-11-benchmark-contract-tests.log`.
