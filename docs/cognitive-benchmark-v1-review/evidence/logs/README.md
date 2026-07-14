# Runtime log index

Benchmark stdout was observed live and machine status was written incrementally to the JSONL results, checkpoints, and manifests in the parent evidence directory.

Isolated Full Omni Brain Server logs and databases remain on D: under `D:\OmniContext-cognitive-v1\preflight` and `D:\OmniContext-cognitive-v1\development`; they are intentionally excluded from Git because they contain large per-scenario runtime databases. No API key is written to those logs. The committed evidence contains raw Answer/Judge responses, structured responses, usage, latency, retry state, hashes, and failure reasons.

Formal and Comparison logs do not exist because those runs were not started.
