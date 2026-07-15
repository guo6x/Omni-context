# Targeted Cross-Agent Rerun

Only affected scenarios were rerun with the frozen product, Answer Schema v2, and Deterministic Scoring v3:

- Smoke Full Omni: 3/3
- Development Full Omni: 5/5
- Development No Memory: 3/3
- Development Retrieval-Only: 3/3

All final manifests report zero errors. The initial Smoke preflight failure caused by a missing model path is preserved separately; the successful rerun used the already archived D-drive model with the required SHA-256 and a new run root.

Old results were reused only when the old and v2.1.1 Scenario Hashes were identical. Every changed Cross-Agent result came from the new run.
