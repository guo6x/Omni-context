# Formal Run Configuration Freeze

The redacted, read-only configuration snapshot is `evidence/formal-run-config.json`. Its unified config SHA-256 is `1247f36d330bf5b172aa1db208ca492417f820a187b896057b834b5bcba6331e`, calculated from stable JSON with the hash field omitted.

The snapshot distinguishes declared Benchmark defaults from effective Brain Server retrieval behavior. Effective retrieval used top-k 10, candidate pool 40, graph depth 2, `rrfK` 60, and weights 0.8 Entity vector, 1.4 Assertion vector, 0.7 Entity FTS, 1.1 Assertion FTS, 0.4 graph, and 0.2 subject attachment. It also records reranker, temporal, Answer, Judge, extraction, and embedding settings.

Every relevant environment variable is represented by name with either its non-secret effective value or a redacted state. No API key, local API token, Authorization header, or device token is stored.
