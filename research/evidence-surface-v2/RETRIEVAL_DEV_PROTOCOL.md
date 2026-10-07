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

## Truth firewall and matched-slot controls

The development retrieval bundle is split physically into:

- `retriever-input.jsonl` — the only file supplied to BM25/BGE;
- `scoring-truth.jsonl` — joined only after ranking for evaluation.

Retriever-visible case/document/source IDs are deterministic opaque hashes. They do not encode pair member, target/hidden/visible/distractor labels, transition family, or correctness.

For each A/B pair:

- document count is identical;
- ordered document IDs are identical;
- all non-transition-slot documents are identical;
- a single shared opaque slot contains either a decision-irrelevant matched control (A) or the real hidden transition (B);
- the A/B slot texts have equal tokenizer length under `[a-z0-9]+`.

This removes corpus-size and obvious identifier/tie-break leakage while preserving the intended semantic retrieval contrast.

## Reproducibility lock

The exact successful Python environment is committed in:

`requirements-retrieval-v2.lock.txt`

Pinned interpreter: Python `3.11.16`.

The final development reproduction gate must install from that lock and exactly reproduce the frozen development artifact hashes before confirmatory retrieval is authorized.
