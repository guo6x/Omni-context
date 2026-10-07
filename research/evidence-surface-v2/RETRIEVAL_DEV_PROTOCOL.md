# V2 Development Retrieval Baselines

**Status:** DEVELOPMENT ONLY. Confirmatory retrieval remains forbidden.

## Lexical baseline

- Algorithm: BM25 Okapi
- Package: `rank-bm25==0.2.2`
- Tokenization: lowercase ASCII alphanumeric tokens using `[a-z0-9]+`
- Stable tie-break: document ID ascending
- Budgets: `k ∈ {2,4,6}`

## Semantic baseline

- Model: `BAAI/bge-small-en-v1.5`
- Frozen model revision: `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a`
- Library target: `sentence-transformers==6.1.0`
- Query instruction: `Represent this sentence for searching relevant passages: `
- Document embeddings: raw document text without the query prefix
- Embeddings normalized
- Ranking score: cosine similarity implemented as dot product of normalized embeddings
- Device: CPU
- Stable tie-break: document ID ascending
- Budgets: `k ∈ {2,4,6}`

The semantic model/revision and library version are selected before any confirmatory retrieval outcomes.

The development workflow will record the exact resolved Python package environment. A lock file must be committed before confirmatory retrieval is authorized.
