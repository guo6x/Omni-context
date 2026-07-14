# Held-out Authorization Gate

Conversation 2–10 access is denied unless every freeze binding succeeds before the dataset file is read. The gate requires the exact authorization `Omni-Context Evaluation Freeze v1`, annotated tag `omni-context-evaluation-freeze-v1`, HEAD equal to the peeled tag commit, the Manifest hash recorded in that tag, the frozen config and prompt hashes, the frozen Embedding Profile and model configuration, the Candidate v2 sealed Manifest hash, and a clean working tree.

The CLI no longer hashes or reads the held-out dataset as part of authorization. Dataset verification happens only after the full gate returns a verified authorization. Held-out resume and retry paths also require a currently verified authorization before dataset hashing or question access; an authorization copied from an earlier run Manifest is insufficient.

The Synthetic suite passed 13/13 cases: the twelve required rejection/allow scenarios plus an additional changed-model rejection. No held-out fixture was created, Answer and Judge were not called, and Conversations 2–10 were not loaded. Machine evidence: `evidence/heldout-gate-synthetic.json`, SHA-256 `cf4a1d4e3c56228777fb710e8abe7f1ca11ac2e406dd70faf9e9e6708af73cb0`.

Passing the gate authorizes access; it does not itself load or run held-out data.
