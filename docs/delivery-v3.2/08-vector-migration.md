# Vector migration

Entity and Assertion indexes have separate manifests. Querying refuses model, revision, dimension, profile, serialization, or active-status mismatch. Production queries never drop or resize tables.

`embeddings:rebuild` uses resumable shadow tables, records progress, validates content and dimensions, and atomically switches both indexes only after completion. Interrupted state remains explicit and can resume. Index metadata history is retained for rollback/audit.

The migration supports 384-dimensional small-model rollback and 1024-dimensional Candidate v2 without mixing vectors. Export/import marks incompatible vectors for rebuild. Merge, invalidation, delete, and text updates synchronize active vectors. Real rebuilds proved 100% coverage and zero anomaly counts.
