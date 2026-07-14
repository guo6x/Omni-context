# Formal Manifest Reconciliation

The original manifest is retained byte-for-byte at `evidence/formal-run-manifest.original.json`, SHA-256 `b714e82c6827b0f3f552bdb2ddd96781ee57303229415d88c0ca43a9d6005457`.

The sealed manifest is at `evidence/formal-run-manifest.sealed.json`, SHA-256 `a5275d5df71e0c00d071a817b2028c45d7220c3cb87f0234bbb0c8d873ded46f`. It keeps `status: completed`, changes final `failure` to `null`, and preserves the earlier embedding-preflight incident under `historical_failures` with `resolved: true` and its original error body.

The reconciliation adds proven Benchmark, Brain Server, and Candidate v2 commits; source-tree provenance; Answer and Judge prompt hashes; unified config hash; embedding profile/model hashes; serialization versions; and weighted-RRF settings. It does not alter the database, results, metrics, or recomputed metrics. Their hashes remain recorded in `evidence/artifact-integrity.json`.
