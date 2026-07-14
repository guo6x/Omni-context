# Candidate v2 readiness

## Admission decision

Candidate v2 is eligible for tagging only after the pushed HEAD has remote CI 9/9 and a clean worktree. The implementation and experiment gates are satisfied:

1. Candidate v1 still resolves to commit `3bdb6e106832854a9bc94672fc74fafa8f7e221f`.
2. Only Conversation 1 was used; Conversations 2-10 were not accessed.
3. Usage profile `e5-large-v1`, query/passage prefixes, pinned revision and 1024 dimensions passed real preflight.
4. Entity and active Assertion coverage are 375/375 and 396/396; zero, NaN, wrong-dimension, orphan, and stale scans are all zero.
5. No hash fallback exists in the accepted run.
6. Assertions are independently embedded and semantically retrieved, then fused with entity/FTS/graph paths.
7. Answer evidence is readable and strict Evidence ID validation remains enforced.
8. Offline Final Context Recall is 0.6800, +0.1970 against the task's Candidate v1 proxy, exceeding the +0.08 admission threshold.
9. The fixed 53-question answer sample improved binary accuracy, answerable accuracy, Evidence Precision, Final Context Recall, and gold-evidence-present accuracy.
10. The formal run completed 199/199 with errors=0, missing=0, duplicate completed=0; retry, interruption/resume, recomputation, archival, and the 15-question Agent-based independent review passed. The run-time worktree was not globally clean because unrelated audit documentation was untracked.
11. Formal Binary Accuracy, Answerable Accuracy, Single-hop, Temporal, Evidence Precision, conservative Final Context Recall, and same-method gold-evidence-present accuracy improved. Multi-hop was unchanged; open-domain regressed and remains P1.
12. The accepted `brain.db`, candidate pools, final contexts, raw results, and manifests are preserved, and the verified installers have immutable hashes.

Unresolved P0 is zero. The remaining ranking, open-domain, dependency-maintenance, latency, and footprint items are explicitly retained as P1 and do not invalidate the evidence-layer correction.
