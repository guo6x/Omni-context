# Formal Artifact Integrity

The original D-drive run archive and the Candidate v2-tagged repository copies are identical for all 18 archived formal-run files. `brain.db` SHA-256 is `898b4ce0d10c0c7972c3518371a9ca4358a7306bb70f29b2a479d3745cf8331e`; `results.jsonl` is `42e21caea53aed39df2ad3c89cd0ede1e92a1244171792a8900433d8ceeca605`; `metrics.json` is `b42fc252cc2a59372b7061bb7703dac1f128e0c3d5eabd9cb5579aa4f3dd893d`.

Final latest-per-question state is 199 completed, 0 unresolved errors, 0 missing, and 0 duplicate completed. The append-only file contains 14 retry records and two preserved, resolved historical error records. Candidate and Final Context snapshots are both 199.

Entity coverage is 375/375 and Assertion coverage is 396/396. Zero, NaN, wrong-dimension, orphan, stale, and fallback counts are all zero. Metrics and recomputed metrics are semantically equal; only their timestamp field names differ.

Twenty formal-run files were scanned with zero API-key, Authorization-header, API-assignment, device-token-assignment, or GitHub-token matches; the database has zero device-token rows. Full hashes, sizes, counters, and scan evidence are in `evidence/artifact-integrity.json`.
