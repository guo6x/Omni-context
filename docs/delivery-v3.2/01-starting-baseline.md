# Starting baseline

- Branch was created from `evaluation-freeze-candidate-v1^{commit}` exactly: `3bdb6e106832854a9bc94672fc74fafa8f7e221f`.
- Candidate v1 annotated tag object: `581889b14234a7105ee206c18b43cd090d9c2c6a`; local and origin resolve to the same object and commit.
- `origin/pre-evaluation-hardening-v3.1` also resolved to the Candidate v1 commit at start. No v3.2 remote branch existed.
- Working branch: `pre-evaluation-hardening-v3.2`.
- The audit report is preserved under `docs/embedding-audit-v1`, but no audit claim was accepted without production-code or machine verification.
- Difference from the audit narrative: a Candidate v1 Conversation 1 database was found locally at `D:\OmniContext-evaluation-v3.1\runs\2026-07-13T16-54-49-815Z-1b9d6c9a\conversation-1\brain.db`, SHA-256 `13766bb6afba62a272ff4a5f61753a4b78e73e48fc4b06c2ac596adf317b08d7`.
- Development loading uses the streaming `loadLoCoMoConversation` path and stops after Conversation 1. Development mode does not hash the whole dataset because doing so would read Conversations 2-10.

Candidate v1 was not moved, overwritten, deleted, or used as a mutable database.
