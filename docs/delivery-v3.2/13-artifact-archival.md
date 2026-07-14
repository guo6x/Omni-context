# Artifact archival

The accepted run is preserved both in its immutable D-drive working location and under `docs/delivery-v3.2/evidence/run` for Git delivery. The database is 26,140,672 bytes, below GitHub's ordinary per-file limit, so no temporary CI artifact is used as the sole archive.

```text
brain.db SHA-256:
898b4ce0d10c0c7972c3518371a9ca4358a7306bb70f29b2a479d3745cf8331e
```

Archived items include `brain.db`, its hash, Entity/Assertion manifests, vector coverage, 199 Candidate Pool snapshots, 199 Final Context snapshots, extraction diagnostics, redacted server log, raw results, formal metrics, recomputed metrics, formal retrieval analysis, and manual Judge review.

Archive validation reports 199 completed, 0 errors, 14 retries, 0 duplicate completed, 100% vector coverage, metric consistency, and passed secret scan. The database, JSONL, manifest, and log were also scanned for key-like material before repository copy.

Original D-drive location: `D:\OmniContext-evaluation-v3.2\runs\2026-07-14T07-34-44-390Z-daef50a5`.

The two large Windows installers are stored outside C: at `E:\OmniContext-artifacts-v3.2\installers`. Their byte sizes and SHA-256 values are in `evidence/installer-manifest.json`. Once the immutable Candidate v2 tag is created, the same files are published as GitHub Release assets at:

- `https://github.com/guo6x/Omni-context/releases/download/evaluation-freeze-candidate-v2/Omni-Context_0.1.1_x64_en-US.msi`
- `https://github.com/guo6x/Omni-context/releases/download/evaluation-freeze-candidate-v2/Omni-Context_0.1.1_x64-setup.exe`

This repository copy is the durable archive for the 26 MB database and run evidence; the Release is the durable archive for files over GitHub's ordinary per-file limit.
